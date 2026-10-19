/**
 * KbService —— 知识空间 / 文档 / 版本 / 检索 / 反馈 / AI 润色（FR-KB-01~09 / FR-KM-01~09）
 *
 * 铁律：
 *  - 检索**先按 ACL 过滤再召回**（非生成后过滤），无权限内容不进入候选集；
 *  - 无命中 → `insufficient: true`，前端显式提示「依据不足」；
 *  - `polish` 保留事实/数字与术语白名单，标记 `polishMeta` 支持一键还原；失败保留原文；
 *  - 文档软删后 `kb_chunk` 同步失效，检索不再返回。
 */

import {
  ErrCode,
  Feedback,
  KbDocFormat,
  MetricEvent,
  NotificationKind,
  SyncStatus,
  type Citation,
  type CreateDocReq,
  type CreateSpaceReq,
  type CreateSourceReq,
  type KbDocVersion,
  type KbDocument,
  type KbSpace,
  type KbSyncSource,
  type PolishAction,
  type PolishMeta,
  type PolishResult,
  type PolishScope,
  type QueryResult,
  type UpdateDocReq,
} from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { mockModelGateway, type ModelGateway } from '../ai/model-gateway';
import { mockRetriever, type Retriever, type RetrievedChunk } from '../ai/retriever';
import { AuditService } from '../core/audit';
import { AppError } from '../core/errors';
import { metrics } from '../core/metrics';
import { PermissionService } from '../core/permission';
import { trace } from '../core/trace';
import {
  getDb,
  isoNow,
  parseJsonArray,
  parseJsonObject,
  toBool,
  type Db,
} from '../db/client';
import { NotificationService } from './notification.service';

const DEFAULT_WORKSPACE = 'ws-huan-0001';
const DEFAULT_ASKER = 'm-human-zhangwei';

/* ═══════════════ 行结构 ═══════════════ */

interface SpaceRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  acl: string;
  doc_count: number;
  created_at: string;
}

interface DocRow {
  id: string;
  space_id: string;
  title: string;
  content: string;
  format: string;
  tags: string;
  source: string;
  remote_id: string | null;
  current_version: number;
  acl: string;
  deleted: number;
  created_at: string;
  updated_at: string;
}

interface DocVersionRow {
  id: string;
  doc_id: string;
  version: number;
  content: string;
  diff: string | null;
  polish_meta: string;
  edited_by: string | null;
  note: string | null;
  created_at: string;
}

interface SourceRow {
  id: string;
  space_id: string;
  source_type: string;
  target: string;
  acl_map: string;
  interval_min: number;
  last_sync_at: string | null;
  last_status: string | null;
  failed_count: number;
  mirror_only: number;
  created_at: string;
}

export interface ListDocFilters {
  spaceId?: string;
  q?: string;
}

export interface KbQueryInput {
  query: string;
  scope: string;
  topK?: number;
  askerId?: string;
}

/* ═══════════════ 服务 ═══════════════ */

export class KbService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly permissions: PermissionService;
  private readonly retriever: Retriever;
  private readonly gateway: ModelGateway;
  private readonly notifications: NotificationService;

  constructor(db: Db = getDb(), deps: { retriever?: Retriever; gateway?: ModelGateway } = {}) {
    this.db = db;
    this.audit = new AuditService(db);
    this.permissions = new PermissionService(db);
    this.retriever = deps.retriever ?? mockRetriever;
    this.gateway = deps.gateway ?? mockModelGateway;
    this.notifications = new NotificationService(db);
  }

  /* ═══════ 映射 ═══════ */

  private toSpace(row: SpaceRow): KbSpace {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description ?? undefined,
      acl: parseJsonArray(row.acl),
      docCount: Number(row.doc_count),
      createdAt: row.created_at,
    };
  }

  private toDocument(row: DocRow): KbDocument {
    return {
      id: row.id,
      spaceId: row.space_id,
      title: row.title,
      content: row.content,
      format: row.format as KbDocFormat,
      tags: parseJsonArray(row.tags),
      source: row.source,
      remoteId: row.remote_id ?? undefined,
      currentVersion: Number(row.current_version),
      acl: parseJsonArray(row.acl),
      deleted: toBool(row.deleted),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toVersion(row: DocVersionRow): KbDocVersion {
    const meta = parseJsonObject<{ originalIndexes?: number[]; preserved?: string[] }>(row.polish_meta);
    return {
      id: row.id,
      docId: row.doc_id,
      version: Number(row.version),
      content: row.content,
      diff: row.diff ?? undefined,
      polishMeta: {
        originalIndexes: meta.originalIndexes ?? [],
        preserved: meta.preserved,
      },
      editedBy: row.edited_by ?? undefined,
      note: row.note ?? undefined,
      createdAt: row.created_at,
    };
  }

  private toSource(row: SourceRow): KbSyncSource {
    return {
      id: row.id,
      spaceId: row.space_id,
      sourceType: row.source_type as KbSyncSource['sourceType'],
      target: row.target,
      aclMap: parseJsonObject<Record<string, string>>(row.acl_map),
      intervalMin: Number(row.interval_min),
      lastSyncAt: row.last_sync_at ?? undefined,
      lastStatus: (row.last_status as SyncStatus | null) ?? undefined,
      failedCount: Number(row.failed_count),
      mirrorOnly: toBool(row.mirror_only),
      createdAt: row.created_at,
    };
  }

  private spaceOrThrow(id: string): SpaceRow {
    const row = this.db.get<SpaceRow>('SELECT * FROM kb_space WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `知识空间不存在：${id}`);
    return row;
  }

  private docOrThrow(id: string): DocRow {
    const row = this.db.get<DocRow>('SELECT * FROM kb_document WHERE id = ? AND deleted = 0', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `文档不存在或已删除：${id}`);
    return row;
  }

  private refreshDocCount(spaceId: string): void {
    this.db.run(
      'UPDATE kb_space SET doc_count = (SELECT COUNT(*) FROM kb_document WHERE space_id = ? AND deleted = 0) WHERE id = ?',
      [spaceId, spaceId],
    );
  }

  /* ═══════ 空间 ═══════ */

  listSpaces(): KbSpace[] {
    return this.db
      .all<SpaceRow>('SELECT * FROM kb_space ORDER BY created_at ASC, rowid ASC')
      .map((row) => this.toSpace(row));
  }

  createSpace(req: CreateSpaceReq): KbSpace {
    if (!req.name) throw new AppError(ErrCode.BAD_REQUEST, '空间名称不能为空');
    const id = `kbs-${nanoid(10)}`;
    const now = isoNow();

    this.db.tx(() => {
      this.db.run(
        'INSERT INTO kb_space (id, workspace_id, name, description, acl, doc_count, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [id, DEFAULT_WORKSPACE, req.name, req.description ?? null, JSON.stringify(req.acl ?? []), now],
      );
      this.audit.write({
        action: 'kb_space_created',
        resourceType: 'kb_space',
        resourceId: id,
        resourceName: req.name,
        detail: { acl: req.acl ?? [] },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return this.toSpace(this.spaceOrThrow(id));
  }

  getSpace(id: string): KbSpace & { documents: KbDocument[] } {
    const space = this.toSpace(this.spaceOrThrow(id));
    return { ...space, documents: this.listDocuments({ spaceId: id }) };
  }

  removeSpace(id: string): { id: string } {
    const row = this.spaceOrThrow(id);
    const docCount = this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM kb_document WHERE space_id = ? AND deleted = 0',
      [id],
    );
    if (docCount && Number(docCount.c) > 0) {
      throw new AppError(ErrCode.CONFLICT, `空间下仍有 ${docCount.c} 篇文档，请先删除文档`, {
        spaceId: id,
        docCount: Number(docCount.c),
      });
    }

    this.db.tx(() => {
      this.db.run('DELETE FROM kb_chunk WHERE space_id = ?', [id]);
      this.db.run('DELETE FROM kb_sync_source WHERE space_id = ?', [id]);
      this.db.run('DELETE FROM kb_document WHERE space_id = ?', [id]);
      this.db.run('DELETE FROM kb_space WHERE id = ?', [id]);
      this.audit.write({
        action: 'kb_space_deleted',
        resourceType: 'kb_space',
        resourceId: id,
        resourceName: row.name,
        workspaceId: row.workspace_id,
      });
    });

    return { id };
  }

  /* ═══════ 文档 ═══════ */

  listDocuments(filters: ListDocFilters = {}): KbDocument[] {
    const where = ['deleted = 0'];
    const params: unknown[] = [];
    if (filters.spaceId) {
      where.push('space_id = ?');
      params.push(filters.spaceId);
    }
    if (filters.q) {
      where.push('(title LIKE ? OR content LIKE ?)');
      const like = `%${filters.q}%`;
      params.push(like, like);
    }
    return this.db
      .all<DocRow>(
        `SELECT * FROM kb_document WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, rowid ASC`,
        params,
      )
      .map((row) => this.toDocument(row));
  }

  createDoc(req: CreateDocReq): KbDocument {
    if (!req.spaceId || !req.title) {
      throw new AppError(ErrCode.BAD_REQUEST, 'spaceId 与 title 为必填');
    }
    this.spaceOrThrow(req.spaceId);

    const id = `kbd-${nanoid(10)}`;
    const now = isoNow();
    const content = req.content ?? '';

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO kb_document (
           id, space_id, title, content, format, tags, source, remote_id,
           current_version, acl, deleted, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'local', NULL, 1, ?, 0, ?, ?)`,
        [
          id,
          req.spaceId,
          req.title,
          content,
          req.format ?? KbDocFormat.MARKDOWN,
          JSON.stringify(req.tags ?? []),
          JSON.stringify(req.acl ?? []),
          now,
          now,
        ],
      );

      this.db.run(
        `INSERT INTO kb_doc_version (id, doc_id, version, content, diff, polish_meta, edited_by, note, created_at)
         VALUES (?, ?, 1, ?, NULL, '{}', NULL, '创建文档', ?)`,
        [`kbv-${nanoid(10)}`, id, content, now],
      );

      this.reindex(id, req.spaceId, 1, req.title, content, now);
      this.refreshDocCount(req.spaceId);

      this.audit.write({
        action: 'doc_created',
        resourceType: 'kb_document',
        resourceId: id,
        resourceName: req.title,
        detail: { spaceId: req.spaceId },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return this.toDocument(this.docOrThrow(id));
  }

  getDoc(id: string): KbDocument & { versions: KbDocVersion[] } {
    const doc = this.toDocument(this.docOrThrow(id));
    return { ...doc, versions: this.versions(id) };
  }

  versions(id: string): KbDocVersion[] {
    this.docOrThrow(id);
    return this.db
      .all<DocVersionRow>(
        'SELECT * FROM kb_doc_version WHERE doc_id = ? ORDER BY version DESC',
        [id],
      )
      .map((row) => this.toVersion(row));
  }

  /** 保存即生成新版本（含 AI 润色标记透传） */
  saveDoc(id: string, req: UpdateDocReq): KbDocument {
    const row = this.docOrThrow(id);
    const now = isoNow();
    const nextVersion = Number(row.current_version) + 1;
    const content = req.content ?? row.content;

    // 简单 diff 描述（替换为真实 diff 算法时保持字段语义）
    const diff =
      content === row.content
        ? null
        : `- ${row.content.split('\n').length} 行\n+ ${content.split('\n').length} 行`;

    this.db.tx(() => {
      this.db.run(
        'UPDATE kb_document SET title = ?, content = ?, tags = ?, acl = ?, current_version = ?, updated_at = ? WHERE id = ?',
        [
          req.title ?? row.title,
          content,
          JSON.stringify(req.tags ?? parseJsonArray(row.tags)),
          JSON.stringify(req.acl ?? parseJsonArray(row.acl)),
          nextVersion,
          now,
          id,
        ],
      );

      this.db.run(
        `INSERT INTO kb_doc_version (id, doc_id, version, content, diff, polish_meta, edited_by, note, created_at)
         VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
        [
          `kbv-${nanoid(10)}`,
          id,
          nextVersion,
          content,
          diff,
          req.editedBy ?? null,
          req.note ?? `保存为 v${nextVersion}`,
          now,
        ],
      );

      this.reindex(id, row.space_id, nextVersion, req.title ?? row.title, content, now);

      this.audit.write({
        action: 'doc_saved',
        actorId: req.editedBy ?? null,
        actorType: 'human',
        resourceType: 'kb_document',
        resourceId: id,
        resourceName: req.title ?? row.title,
        detail: { version: nextVersion },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    metrics.emit(MetricEvent.DOC_SAVED, { docId: id, version: nextVersion });
    return this.toDocument(this.docOrThrow(id));
  }

  /** 回滚：以目标版本内容生成**新版本**并置为当前版本 */
  rollbackDoc(id: string, version: number): KbDocument {
    const row = this.docOrThrow(id);
    const target = this.db.get<DocVersionRow>(
      'SELECT * FROM kb_doc_version WHERE doc_id = ? AND version = ?',
      [id, version],
    );
    if (!target) throw new AppError(ErrCode.NOT_FOUND, `文档版本不存在：v${version}`);

    const now = isoNow();
    const nextVersion = Number(row.current_version) + 1;

    this.db.tx(() => {
      this.db.run(
        'UPDATE kb_document SET content = ?, current_version = ?, updated_at = ? WHERE id = ?',
        [target.content, nextVersion, now, id],
      );
      this.db.run(
        `INSERT INTO kb_doc_version (id, doc_id, version, content, diff, polish_meta, edited_by, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          `kbv-${nanoid(10)}`,
          id,
          nextVersion,
          target.content,
          `回滚至 v${version}`,
          target.polish_meta,
          `回滚至 v${version}`,
          now,
        ],
      );
      this.reindex(id, row.space_id, nextVersion, row.title, target.content, now);

      this.audit.write({
        action: 'doc_rolled_back',
        resourceType: 'kb_document',
        resourceId: id,
        resourceName: row.title,
        detail: { from: Number(row.current_version), to: version, newVersion: nextVersion },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return this.toDocument(this.docOrThrow(id));
  }

  /** 软删 + 索引失效（chunk 物理删除，检索不再返回） */
  removeDoc(id: string): { id: string } {
    const row = this.docOrThrow(id);
    const now = isoNow();

    this.db.tx(() => {
      this.db.run('UPDATE kb_document SET deleted = 1, updated_at = ? WHERE id = ?', [now, id]);
      this.db.run('DELETE FROM kb_chunk WHERE doc_id = ?', [id]);
      this.refreshDocCount(row.space_id);

      this.audit.write({
        action: 'doc_deleted',
        resourceType: 'kb_document',
        resourceId: id,
        resourceName: row.title,
        detail: { spaceId: row.space_id, softDelete: true },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return { id };
  }

  /* ═══════ 切块索引 ═══════ */

  /** 按 Markdown 标题切块（保留标题层级） */
  chunkContent(title: string, content: string): { heading: string; content: string }[] {
    const lines = content.split('\n');
    const chunks: { heading: string; content: string }[] = [];
    let heading = title;
    let buffer: string[] = [];

    const flush = (): void => {
      const body = buffer.join('\n').trim();
      if (body.length > 0) chunks.push({ heading, content: body });
      buffer = [];
    };

    for (const line of lines) {
      if (/^#{1,6}\s+/.test(line)) {
        flush();
        heading = line.replace(/^#{1,6}\s+/, '').trim();
        continue;
      }
      buffer.push(line);
    }
    flush();

    if (chunks.length === 0) chunks.push({ heading: title, content: content.trim() || title });
    return chunks;
  }

  private estimateTokens(text: string): number {
    const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    return Math.max(1, Math.round(cjk + (text.length - cjk) / 4));
  }

  private reindex(
    docId: string,
    spaceId: string,
    version: number,
    title: string,
    content: string,
    now: string,
  ): void {
    this.db.run('DELETE FROM kb_chunk WHERE doc_id = ?', [docId]);
    for (const chunk of this.chunkContent(title, content)) {
      this.db.run(
        `INSERT INTO kb_chunk (id, doc_id, space_id, version, heading, content, token_count, embedding, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [
          `kbc-${nanoid(10)}`,
          docId,
          spaceId,
          version,
          chunk.heading,
          chunk.content,
          this.estimateTokens(chunk.content),
          now,
        ],
      );
    }
  }

  /* ═══════ AI 润色 ═══════ */

  /**
   * AI 润色：保留事实/数字与术语，返回可还原标记。
   * REPLACE_POINT: 当前为**确定性文本变换**（结构化/精简/正式化 + 数字保真校验），
   * 未来替换点：调用真实模型并结合术语白名单与事实校验器；失败时保留原文（本实现已保证）。
   */
  polish(
    id: string,
    req: { scope: PolishScope; action: PolishAction; selection?: string },
  ): PolishResult {
    const row = this.docOrThrow(id);
    const source =
      req.scope === 'selection' && req.selection ? req.selection : req.scope === 'paragraph' ? row.content.split('\n\n')[0] ?? row.content : row.content;

    const numbers = source.match(/\d+(?:\.\d+)?%?/g) ?? [];
    const lines = source.split('\n');

    const candidates: string[] = [];

    // 候选 1：结构化（连续正文转编号列表，文字不变）
    candidates.push(
      lines
        .map((line, index) => {
          if (line.trim() === '' || /^#{1,6}\s+/.test(line) || /^[-*\d]/.test(line.trim())) return line;
          return `${index + 1}. ${line.trim()}`;
        })
        .join('\n'),
    );

    // 候选 2：精简（移除冗词，保留全部数字）
    const FILLERS = ['其实', '非常', '十分', '基本上', '总的来说', '需要说明的是', '值得注意的一点是'];
    let concise = source;
    for (const filler of FILLERS) concise = concise.split(filler).join('');
    candidates.push(concise);

    // 候选 3：按动作换风格（保持事实）
    const styleMap: Record<PolishAction, (text: string) => string> = {
      polish: (t) => t.replace(/。\s*/g, '。\n'),
      expand: (t) => t.replace(/。\s*/g, '。（补充说明见引用依据）\n'),
      shorten: (t) => t.split('。').filter((s) => s.trim().length > 0).slice(0, 3).join('。') + '。',
      proofread: (t) => t.replace(/\s{2,}/g, ' ').replace(/,,/g, '，'),
      translate: (t) => `[EN] ${t}`,
      rewrite: (t) => t.replace(/。/g, '；').replace(/；$/, '。'),
      summarize: (t) => t.split('\n').filter((l) => l.trim() !== '').slice(0, 2).join('\n'),
    };
    candidates.push(styleMap[req.action](source));

    // 数字保真校验：任一候选丢失数字则回退原文
    const safeCandidates = candidates.map((candidate) => {
      const lost = numbers.some((n) => !candidate.includes(n));
      return lost ? source : candidate;
    });

    const originalIndexes: number[] = [];
    lines.forEach((line, index) => {
      if (safeCandidates.some((candidate) => candidate.split('\n')[index] !== line)) {
        originalIndexes.push(index);
      }
    });

    const polishMeta: PolishMeta = {
      originalIndexes,
      preserved: Array.from(new Set(numbers)),
    };

    metrics.emit(MetricEvent.DOC_POLISHED, { docId: id, action: req.action, scope: req.scope });

    return { candidates: safeCandidates, polishMeta };
  }

  /* ═══════ 同步源 ═══════ */

  listSources(spaceId?: string): KbSyncSource[] {
    const rows = spaceId
      ? this.db.all<SourceRow>('SELECT * FROM kb_sync_source WHERE space_id = ? ORDER BY created_at ASC', [
          spaceId,
        ])
      : this.db.all<SourceRow>('SELECT * FROM kb_sync_source ORDER BY created_at ASC');
    return rows.map((row) => this.toSource(row));
  }

  createSource(req: CreateSourceReq): KbSyncSource {
    if (!req.spaceId || !req.target) {
      throw new AppError(ErrCode.BAD_REQUEST, 'spaceId 与 target 为必填');
    }
    this.spaceOrThrow(req.spaceId);

    const id = `kbsrc-${nanoid(10)}`;
    const now = isoNow();

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO kb_sync_source (
           id, space_id, source_type, target, acl_map, interval_min, last_sync_at, last_status,
           failed_count, mirror_only, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)`,
        [
          id,
          req.spaceId,
          req.sourceType,
          req.target,
          JSON.stringify(req.aclMap ?? {}),
          req.intervalMin ?? 15,
          req.mirrorOnly === false ? 0 : 1,
          now,
        ],
      );
      this.audit.write({
        action: 'kb_source_created',
        resourceType: 'kb_sync_source',
        resourceId: id,
        resourceName: `${req.sourceType}:${req.target}`,
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    const row = this.db.get<SourceRow>('SELECT * FROM kb_sync_source WHERE id = ?', [id]);
    return this.toSource(row as SourceRow);
  }

  /** 模拟同步：单向镜像，只读远端（不落盘） */
  syncSource(id: string): { docCount: number; failedCount: number; status: SyncStatus } {
    const row = this.db.get<SourceRow>('SELECT * FROM kb_sync_source WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `同步源不存在：${id}`);

    const spaceDocs = this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM kb_document WHERE space_id = ? AND deleted = 0',
      [row.space_id],
    );
    const docCount = spaceDocs ? Number(spaceDocs.c) : 0;
    const now = isoNow();

    this.db.tx(() => {
      this.db.run(
        "UPDATE kb_sync_source SET last_sync_at = ?, last_status = 'success', failed_count = 0 WHERE id = ?",
        [now, id],
      );
      this.audit.write({
        action: 'kb_source_synced',
        resourceType: 'kb_sync_source',
        resourceId: id,
        resourceName: `${row.source_type}:${row.target}`,
        detail: { docCount, failedCount: 0, mirrorOnly: toBool(row.mirror_only) },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return { docCount, failedCount: 0, status: SyncStatus.SUCCESS };
  }

  /* ═══════ 检索问答 ═══════ */

  /** 解析检索范围 → 可读空间集合（ACL 先行） */
  private resolveScope(askerId: string, scope: string): string[] {
    const readable = this.permissions.resolveReadableSpaces(askerId);
    const trimmed = (scope ?? 'all').trim();

    if (trimmed.startsWith('space:')) {
      const spaceId = trimmed.slice('space:'.length);
      this.spaceOrThrow(spaceId);
      if (!readable.includes(spaceId)) {
        throw new AppError(ErrCode.SCOPE_DENIED, `无权检索该知识空间：${spaceId}`, {
          askerId,
          spaceId,
          readable,
        });
      }
      return [spaceId];
    }

    if (trimmed.startsWith('doc:')) {
      const docId = trimmed.slice('doc:'.length);
      const doc = this.docOrThrow(docId);
      if (!readable.includes(doc.space_id)) {
        throw new AppError(ErrCode.SCOPE_DENIED, `无权检索该文档：${docId}`, { askerId, docId });
      }
      return [doc.space_id];
    }

    return readable;
  }

  query(input: KbQueryInput): QueryResult {
    const askerId = input.askerId ?? DEFAULT_ASKER;
    const asker = this.db.get<{ id: string }>('SELECT id FROM member WHERE id = ?', [askerId]);
    if (!asker) throw new AppError(ErrCode.NOT_FOUND, `提问者不存在：${askerId}`);

    const traceId = trace.current();
    const topK = Math.max(1, Number(input.topK ?? 5));

    // 1) ACL 过滤 → 2) 召回打分
    const allowedSpaceIds = this.resolveScope(askerId, input.scope);
    const chunks: RetrievedChunk[] = this.retriever.search({
      query: input.query,
      allowedSpaceIds,
      topK,
    });

    const citations: Citation[] = chunks.map((c) => ({
      docId: c.docId,
      spaceName: c.spaceName,
      heading: c.heading,
      version: c.version,
      snippet: c.content.slice(0, 140),
    }));

    const queryId = `kbq-${nanoid(10)}`;
    const now = isoNow();

    // 3) 无命中 → 依据不足
    if (chunks.length === 0) {
      this.db.tx(() => {
        this.db.run(
          `INSERT INTO kb_query_log (
             id, workspace_id, asker_id, query, scope, top_k, citation_count, answer,
             insufficient, feedback, feedback_by, trace_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 0, '', 1, NULL, NULL, ?, ?)`,
          [queryId, DEFAULT_WORKSPACE, askerId, input.query, input.scope, topK, traceId, now],
        );
        this.audit.write({
          action: 'rag_query',
          traceId,
          actorId: askerId,
          actorType: 'human',
          initiatorId: askerId,
          resourceType: 'kb',
          resourceId: allowedSpaceIds[0] ?? null,
          resourceName: '知识检索',
          result: 'success',
          detail: { query: input.query, citationCount: 0, insufficient: true },
          workspaceId: DEFAULT_WORKSPACE,
        });
      });

      metrics.emit(MetricEvent.KB_QUERY, { queryId, citationCount: 0, insufficient: true }, askerId);

      return {
        queryId,
        answer: '未在知识库中找到依据，暂时无法回答。请补充文档或调整检索范围。',
        insufficient: true,
        citations: [],
        scope: input.scope,
        traceId,
      };
    }

    // 4) 生成带引用的答案
    const context = chunks
      .map((c, i) => `[${i + 1}] 《${c.spaceName}》${c.heading ? ` · ${c.heading}` : ''}（v${c.version}）\n${c.content}`)
      .join('\n\n');

    const modelResult = this.gateway.complete({
      prompt: `请基于以下引用依据回答问题：${input.query}`,
      scene: 'reasoning',
      context,
    });

    const citationText = citations
      .map((c, i) => `[${i + 1}] 《${c.spaceName}》${c.heading ? ` · ${c.heading}` : ''}（v${c.version}）`)
      .join('\n');
    const answer = `${modelResult.text}\n\n引用依据：\n${citationText}`;

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO kb_query_log (
           id, workspace_id, asker_id, query, scope, top_k, citation_count, answer,
           insufficient, feedback, feedback_by, trace_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)`,
        [
          queryId,
          DEFAULT_WORKSPACE,
          askerId,
          input.query,
          input.scope,
          topK,
          citations.length,
          answer,
          traceId,
          now,
        ],
      );

      this.audit.write({
        action: 'rag_query',
        traceId,
        actorId: askerId,
        actorType: 'human',
        initiatorId: askerId,
        resourceType: 'kb',
        resourceId: allowedSpaceIds[0] ?? null,
        resourceName: '知识检索',
        durationMs: modelResult.durationMs,
        tokenUsed: modelResult.tokenIn + modelResult.tokenOut,
        detail: {
          query: input.query,
          citationCount: citations.length,
          insufficient: false,
          modelId: modelResult.modelId,
        },
        workspaceId: DEFAULT_WORKSPACE,
      });

      metrics.recordUsage(
        {
          workspaceId: DEFAULT_WORKSPACE,
          category: 'model',
          modelId: modelResult.modelId,
          agentId: null,
          tokenIn: modelResult.tokenIn,
          tokenOut: modelResult.tokenOut,
          cost: modelResult.cost,
          traceId,
        },
        this.db,
      );
    });

    metrics.emit(MetricEvent.KB_QUERY, { queryId, citationCount: citations.length }, askerId);

    return {
      queryId,
      answer,
      insufficient: false,
      citations,
      scope: input.scope,
      traceId,
    };
  }

  /** 问答反馈：采纳 / 点踩 / 依据不足（点踩 → 进入待优化队列） */
  feedback(queryId: string, feedback: string, feedbackBy: string = DEFAULT_ASKER): { ok: true } {
    const row = this.db.get<{ id: string; asker_id: string; query: string; scope: string | null }>(
      'SELECT id, asker_id, query, scope FROM kb_query_log WHERE id = ?',
      [queryId],
    );
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `问答记录不存在：${queryId}`);

    if (![Feedback.ADOPT, Feedback.REJECT, Feedback.INSUFFICIENT].includes(feedback as Feedback)) {
      throw new AppError(ErrCode.BAD_REQUEST, `非法反馈值：${feedback}`, {
        allowed: [Feedback.ADOPT, Feedback.REJECT, Feedback.INSUFFICIENT],
      });
    }

    const now = isoNow();

    this.db.tx(() => {
      this.db.run('UPDATE kb_query_log SET feedback = ?, feedback_by = ? WHERE id = ?', [
        feedback,
        feedbackBy,
        queryId,
      ]);

      // 点踩 / 依据不足 → 通知空间管理员进入待优化队列
      if (feedback !== Feedback.ADOPT) {
        this.notifications.create({
          workspaceId: DEFAULT_WORKSPACE,
          recipientId: 'm-human-chenjing',
          kind: NotificationKind.KB_FEEDBACK,
          title: `知识问答「${row.query}」被标记为${
            feedback === Feedback.REJECT ? '点踩' : '依据不足'
          }，请补充文档`,
          refType: 'kb',
          refId: queryId,
        });
      }

      this.audit.write({
        action: 'kb_feedback',
        actorId: feedbackBy,
        actorType: 'human',
        // 双主体留痕：反馈质量闭环需要能归因到具体反馈人
        initiatorId: feedbackBy,
        resourceType: 'kb',
        resourceId: queryId,
        resourceName: row.query,
        detail: { feedback },
        workspaceId: DEFAULT_WORKSPACE,
        occurredAt: now,
      });
    });

    metrics.emit(MetricEvent.KB_FEEDBACK, { queryId, feedback }, feedbackBy);

    return { ok: true };
  }

  /** 问答日志（知识库页面「检索反馈表」用） */
  queryLogs(limit = 100): {
    id: string;
    query: string;
    scope?: string;
    citationCount: number;
    insufficient: boolean;
    feedback?: string;
    answer?: string;
    traceId?: string;
    createdAt: string;
  }[] {
    return this.db
      .all<Record<string, unknown>>(
        'SELECT * FROM kb_query_log ORDER BY created_at DESC LIMIT ?',
        [limit],
      )
      .map((row) => ({
        id: String(row.id),
        query: String(row.query),
        scope: row.scope ? String(row.scope) : undefined,
        citationCount: Number(row.citation_count),
        insufficient: Number(row.insufficient) === 1,
        feedback: row.feedback ? String(row.feedback) : undefined,
        answer: row.answer ? String(row.answer) : undefined,
        traceId: row.trace_id ? String(row.trace_id) : undefined,
        createdAt: String(row.created_at),
      }));
  }
}

export const kbService = new KbService();
