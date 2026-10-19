/**
 * ApiKeyService —— Key 签发 / 吊销 / 鉴权 / 签名验签 / 三级限流 / 幂等键（FR-API-01~10）
 *
 * 铁律：
 *  - API Key **仅存哈希**（sha256），创建接口返回的 `plaintext` 仅此一次；
 *  - 签名与时间戳窗口 **5 分钟**，超窗 `401 TIMESTAMP_EXPIRED`；
 *  - 三级限流（Key / 租户 / 模型），超限 `429 RATE_LIMITED` + `Retry-After`；
 *  - 对外出网域名白名单，未白名单 `403 DOMAIN_NOT_ALLOWED`；
 *  - 写操作幂等键：重复请求返回首次结果（不回放副作用）。
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  ApiKeyStatus,
  DOMAIN_ALLOWLIST,
  ErrCode,
  MetricEvent,
  RATE_LIMITS,
  SIGNATURE_WINDOW_MS,
  type ApiKey,
  type ApiKeyRecord,
  type CreateKeyReq,
  type IssuedKeyResp,
} from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { AuditService } from '../core/audit';
import { AppError } from '../core/errors';
import { metrics } from '../core/metrics';
import { NotificationService } from './notification.service';
import { getDb, isoNow, parseJsonArray, toBool, type Db } from '../db/client';

const DEFAULT_WORKSPACE = 'ws-huan-0001';

/** sha256 十六进制 */
export function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * 签名算法（对外文档公开）：
 *   signature = HMAC-SHA256(secret = 明文 API Key,
 *                           message = `${x-timestamp}.${METHOD}.${path}.${sha256(原始请求体)}`) 的 hex
 */
export function computeSignature(input: {
  plaintextKey: string;
  method: string;
  path: string;
  timestamp: string;
  rawBody?: string;
}): string {
  const bodyHash = createHash('sha256')
    .update(input.rawBody ?? '')
    .digest('hex');
  const message = `${input.timestamp}.${input.method.toUpperCase()}.${input.path}.${bodyHash}`;
  return createHmac('sha256', input.plaintextKey).update(message).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/* ═══════════════ 进程内运行时状态（不落表） ═══════════════ */

interface IdempotencyRecord {
  statusCode: number;
  body: unknown;
  createdAt: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
const RATE_WINDOW_MS = 60_000;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  /** 被限流的层级 */
  scope?: 'key' | 'tenant' | 'model';
}

export class ApiKeyService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly notifications: NotificationService;

  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly rateBuckets = new Map<string, RateBucket>();

  constructor(db: Db = getDb()) {
    this.db = db;
    this.audit = new AuditService(db);
    this.notifications = new NotificationService(db);
  }

  /* ═══════ 映射 ═══════ */

  private toRecord(row: Record<string, unknown>): ApiKeyRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      keyHash: String(row.key_hash),
      keyPrefix: String(row.key_prefix),
      scopes: parseJsonArray(row.scopes),
      rateLimitPerMin: Number(row.rate_limit_per_min),
      ownerId: String(row.owner_id),
      lastUsedAt: row.last_used_at ? String(row.last_used_at) : undefined,
      status: String(row.status) as ApiKeyStatus,
      createdAt: String(row.created_at),
    };
  }

  /** 剔除 key_hash 后对外返回 */
  private toView(record: ApiKeyRecord): ApiKey {
    const { keyHash: _keyHash, ...view } = record;
    void _keyHash;
    return view;
  }

  /* ═══════ 查询 ═══════ */

  list(workspaceId?: string): ApiKey[] {
    const rows = workspaceId
      ? this.db.all<Record<string, unknown>>(
          'SELECT * FROM api_key WHERE workspace_id = ? ORDER BY created_at DESC',
          [workspaceId],
        )
      : this.db.all<Record<string, unknown>>('SELECT * FROM api_key ORDER BY created_at DESC');
    return rows.map((row) => this.toView(this.toRecord(row)));
  }

  private rawOrThrow(id: string): ApiKeyRecord {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM api_key WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `API Key 不存在：${id}`);
    return this.toRecord(row);
  }

  /* ═══════ 签发 / 吊销 ═══════ */

  /** 签发：明文仅此一次返回；库内只存哈希 */
  issue(req: CreateKeyReq): IssuedKeyResp {
    if (!req.name) throw new AppError(ErrCode.BAD_REQUEST, 'Key 名称不能为空');

    const owner = this.db.get<{ id: string }>('SELECT id FROM member WHERE id = ?', [req.ownerId]);
    if (!owner) throw new AppError(ErrCode.NOT_FOUND, `持有人不存在：${req.ownerId}`);

    const id = `apk-${nanoid(10)}`;
    const plaintext = this.generatePlaintext();
    const keyHash = hashKey(plaintext);
    const keyPrefix = `${plaintext.slice(0, 9)}…`;
    const now = isoNow();

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO api_key (
           id, workspace_id, name, key_hash, key_prefix, scopes, rate_limit_per_min,
           owner_id, last_used_at, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?)`,
        [
          id,
          req.workspaceId ?? DEFAULT_WORKSPACE,
          req.name,
          keyHash,
          keyPrefix,
          JSON.stringify(req.scopes ?? []),
          req.rateLimitPerMin ?? RATE_LIMITS.perKey,
          req.ownerId,
          now,
        ],
      );

      // 审计仅记录前缀与哈希指纹（不落明文）
      this.audit.write({
        action: 'api_key_issued',
        actorId: req.ownerId,
        actorType: 'human',
        initiatorId: req.ownerId,
        resourceType: 'apikey',
        resourceId: id,
        resourceName: req.name,
        detail: {
          scopes: req.scopes ?? [],
          rateLimitPerMin: req.rateLimitPerMin ?? RATE_LIMITS.perKey,
          keyPrefix,
          keyFingerprint: keyHash.slice(0, 12),
        },
        workspaceId: req.workspaceId ?? DEFAULT_WORKSPACE,
      });
    });

    metrics.emit(MetricEvent.API_KEY_ISSUED, { keyId: id, name: req.name }, req.ownerId);

    return { key: this.toView(this.rawOrThrow(id)), plaintext };
  }

  private generatePlaintext(): string {
    return `hb_live_${randomBytes(18).toString('base64url')}`;
  }

  revoke(id: string, actor: string): ApiKey {
    const row = this.rawOrThrow(id);
    if (row.status === ApiKeyStatus.REVOKED) return this.toView(row);

    this.db.tx(() => {
      this.db.run("UPDATE api_key SET status = 'revoked' WHERE id = ?", [id]);
      this.audit.write({
        action: 'api_key_revoked',
        // 双主体留痕：吊销密钥是敏感操作，必须记录操作者
        actorId: actor,
        actorType: 'human',
        initiatorId: actor,
        resourceType: 'apikey',
        resourceId: id,
        resourceName: row.name,
        detail: { keyPrefix: row.keyPrefix, previousStatus: row.status },
        workspaceId: row.workspaceId,
      });
    });

    metrics.emit(MetricEvent.API_KEY_REVOKED, { keyId: id });
    return this.toView(this.rawOrThrow(id));
  }

  /* ═══════ 鉴权 / 验签 ═══════ */

  /** 按明文 Key 查找记录（仅比对哈希） */
  findByPlaintext(plaintext: string): ApiKeyRecord | undefined {
    if (!plaintext) return undefined;
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM api_key WHERE key_hash = ?', [
      hashKey(plaintext),
    ]);
    return row ? this.toRecord(row) : undefined;
  }

  /**
   * 完整校验：Key 鉴权 + 时间戳窗口 + 签名。
   * @throws 1002 未认证 / 1015 时间戳超窗 / 1013 签名失败
   */
  verifySignature(input: {
    plaintextKey?: string;
    method: string;
    path: string;
    timestamp?: string;
    signature?: string;
    rawBody?: string;
  }): ApiKeyRecord {
    if (!input.plaintextKey) {
      throw new AppError(ErrCode.UNAUTHORIZED, '缺少 x-api-key');
    }

    const record = this.findByPlaintext(input.plaintextKey);
    if (!record) throw new AppError(ErrCode.UNAUTHORIZED, 'API Key 无效');
    if (record.status !== ApiKeyStatus.ACTIVE) {
      throw new AppError(ErrCode.UNAUTHORIZED, 'API Key 已吊销');
    }

    if (!input.timestamp) throw new AppError(ErrCode.BAD_REQUEST, '缺少 x-timestamp');
    const ts = Number(input.timestamp);
    if (!Number.isFinite(ts)) {
      throw new AppError(ErrCode.BAD_REQUEST, 'x-timestamp 必须为毫秒时间戳');
    }
    const drift = Math.abs(Date.now() - ts);
    if (drift > SIGNATURE_WINDOW_MS) {
      throw new AppError(
        ErrCode.TIMESTAMP_EXPIRED,
        `请求已过期（时间戳窗口 ${SIGNATURE_WINDOW_MS / 60000} 分钟）`,
        { driftMs: drift, windowMs: SIGNATURE_WINDOW_MS },
      );
    }

    if (!input.signature) throw new AppError(ErrCode.BAD_REQUEST, '缺少 x-signature');
    const expected = computeSignature({
      plaintextKey: input.plaintextKey,
      method: input.method,
      path: input.path,
      timestamp: input.timestamp,
      rawBody: input.rawBody,
    });
    if (!safeEqual(expected, input.signature)) {
      throw new AppError(ErrCode.SIGNATURE_INVALID, '签名校验失败', {
        expectedPrefix: expected.slice(0, 12),
        receivedPrefix: input.signature.slice(0, 12),
      });
    }

    this.db.run('UPDATE api_key SET last_used_at = ? WHERE id = ?', [isoNow(), record.id]);
    return record;
  }

  /** scope 校验 */
  requireScope(record: ApiKeyRecord, scope: string): void {
    if (record.scopes.includes('*') || record.scopes.includes(scope)) return;
    throw new AppError(ErrCode.FORBIDDEN, `API Key「${record.name}」缺少 ${scope} 权限`, {
      required: scope,
      granted: record.scopes,
    });
  }

  /** 出网域名白名单校验 */
  assertDomainAllowed(domain: string): void {
    const normalized = domain.trim().toLowerCase();
    const allowed = DOMAIN_ALLOWLIST.some(
      (item) => normalized === item || normalized.endsWith(`.${item}`),
    );
    if (!allowed) {
      throw new AppError(ErrCode.DOMAIN_NOT_ALLOWED, `目标域名不在白名单：${domain}`, {
        domain,
        allowlist: DOMAIN_ALLOWLIST,
      });
    }
  }

  /* ═══════ 三级限流 ═══════ */

  private tick(bucket: string, windowKey: string, limit: number): RateLimitResult {
    const mapKey = `${bucket}:${windowKey}`;
    const now = Date.now();
    const existing = this.rateBuckets.get(mapKey);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + RATE_WINDOW_MS;
      this.rateBuckets.set(mapKey, { count: 1, resetAt });
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - 1),
        resetAt: new Date(resetAt).toISOString(),
        scope: bucket as RateLimitResult['scope'],
      };
    }

    existing.count += 1;
    const allowed = existing.count <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - existing.count),
      resetAt: new Date(existing.resetAt).toISOString(),
      scope: bucket as RateLimitResult['scope'],
    };
  }

  /**
   * 三级限流：Key → 租户 → 模型。
   * 任一层级超限 → 429 RATE_LIMITED（details.retryAfterSec 用于 Retry-After 头）
   */
  checkRateLimit(input: {
    keyId: string;
    tenantId: string;
    modelId?: string;
    keyLimit?: number;
    tenantLimit?: number;
    modelLimit?: number;
  }): RateLimitResult {
    const levels: { bucket: 'key' | 'tenant' | 'model'; windowKey: string; limit: number }[] = [
      { bucket: 'key', windowKey: input.keyId, limit: input.keyLimit ?? RATE_LIMITS.perKey },
      {
        bucket: 'tenant',
        windowKey: input.tenantId,
        limit: input.tenantLimit ?? RATE_LIMITS.perTenant,
      },
    ];
    if (input.modelId) {
      levels.push({
        bucket: 'model',
        windowKey: input.modelId,
        limit: input.modelLimit ?? RATE_LIMITS.perModel,
      });
    }

    let last: RateLimitResult | undefined;
    for (const level of levels) {
      const result = this.tick(level.bucket, level.windowKey, level.limit);
      last = result;
      if (!result.allowed) {
        throw new AppError(ErrCode.RATE_LIMITED, `触发限流（${level.bucket} 层级）`, {
          scope: level.bucket,
          limit: result.limit,
          resetAt: result.resetAt,
          retryAfterSec: Math.max(1, Math.ceil((new Date(result.resetAt).getTime() - Date.now()) / 1000)),
        });
      }
    }

    return (
      last ?? {
        allowed: true,
        limit: RATE_LIMITS.perKey,
        remaining: RATE_LIMITS.perKey,
        resetAt: new Date().toISOString(),
      }
    );
  }

  /** 供 UI 展示当前窗口用量 */
  rateLimitSnapshot(keyId: string): { bucket: string; used: number; limit: number; resetAt: string }[] {
    const out: { bucket: string; used: number; limit: number; resetAt: string }[] = [];
    for (const [mapKey, value] of this.rateBuckets.entries()) {
      const [bucket, windowKey] = mapKey.split(':');
      if (windowKey !== keyId) continue;
      out.push({
        bucket,
        used: value.count,
        limit: bucket === 'key' ? RATE_LIMITS.perKey : RATE_LIMITS.perTenant,
        resetAt: new Date(value.resetAt).toISOString(),
      });
    }
    return out;
  }

  /* ═══════ 幂等键 ═══════ */

  /** 读取已完成的幂等结果（未过期） */
  idempotencyGet(key: string): IdempotencyRecord | undefined {
    const record = this.idempotency.get(key);
    if (!record) return undefined;
    if (Date.now() - record.createdAt > IDEMPOTENCY_TTL_MS) {
      this.idempotency.delete(key);
      return undefined;
    }
    return record;
  }

  /** 保存幂等结果 */
  idempotencySet(key: string, statusCode: number, body: unknown): void {
    this.idempotency.set(key, { statusCode, body, createdAt: Date.now() });
    // 简单的容量保护
    if (this.idempotency.size > 5000) {
      const oldest = Array.from(this.idempotency.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      )[0];
      if (oldest) this.idempotency.delete(oldest[0]);
    }
  }

  /** 清理过期运行时状态（测试/定时任务用） */
  resetRuntimeState(): void {
    this.idempotency.clear();
    this.rateBuckets.clear();
  }

  /** 令牌指纹（用于审计留痕，不含明文） */
  fingerprint(plaintext: string): string {
    return hashKey(plaintext).slice(0, 12);
  }

  /** 可用能力清单（API 页面展示） */
  capabilities(record?: ApiKeyRecord): { scope: string; label: string; granted: boolean }[] {
    const granted = record?.scopes ?? [];
    const all = [
      { scope: 'workflow:run', label: '运行工作流' },
      { scope: 'agent:invoke', label: '调用 Agent' },
      { scope: 'skill:execute', label: '执行技能' },
      { scope: 'kb:query', label: '知识库检索' },
    ];
    return all.map((item) => ({ ...item, granted: granted.includes(item.scope) || granted.includes('*') }));
  }

  /** 按 Key id 查询能力清单 */
  capabilitiesOf(keyId: string): { scope: string; label: string; granted: boolean }[] {
    const record = this.db.get<Record<string, unknown>>('SELECT * FROM api_key WHERE id = ?', [keyId]);
    return this.capabilities(record ? this.toRecord(record) : undefined);
  }

  /** 安全事件通知（供路由层在拦截时调用） */
  notifyBlocked(title: string, refId?: string): void {
    this.notifications.notifySecurity({
      workspaceId: DEFAULT_WORKSPACE,
      recipientId: 'm-human-zhangwei',
      title,
      refType: 'apikey',
      refId,
    });
  }

  /** 状态判断辅助 */
  isActive(id: string): boolean {
    return toBool(this.rawOrThrow(id).status === ApiKeyStatus.ACTIVE ? 1 : 0);
  }
}

export const apiKeyService = new ApiKeyService();
