/**
 * ChatService —— 会话 / 消息 / 模型切换 / 工具调用（FR-GOV-06）
 *
 * 会话持有 model / agent / kbSpace / skills 绑定；发消息时：
 *   1) ACL 过滤知识空间 → 检索 → 生成引用
 *   2) 场景路由调用模型（会话指定模型优先，不可用则降级）
 *   3) 记录 tool_call / citation 富块，写用量与审计
 */

import {
  ErrCode,
  MemberType,
  MessageBlockKind,
  MetricEvent,
  SessionRole,
  type Citation,
  type CreateSessionReq,
  type Message,
  type MessageBlock,
  type Scene,
  type Session,
} from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { mockModelGateway, type ModelGateway } from '../ai/model-gateway';
import { mockRetriever, type Retriever } from '../ai/retriever';
import { AuditService } from '../core/audit';
import { AppError } from '../core/errors';
import { metrics } from '../core/metrics';
import { PermissionService } from '../core/permission';
import { trace } from '../core/trace';
import {
  getDb,
  isoNow,
  parseJsonArray,
  parseJsonArrayOf,
  toBool,
  type Db,
} from '../db/client';

const DEFAULT_WORKSPACE = 'ws-huan-0001';
const DEFAULT_OWNER = 'm-human-zhangwei';
const DEFAULT_AGENT = 'm-ai-analyst';

interface SessionRow {
  id: string;
  workspace_id: string;
  title: string;
  owner_id: string;
  agent_id: string | null;
  model_id: string | null;
  kb_space_id: string | null;
  skill_ids: string;
  perm_scope: string | null;
  related_task_ids: string;
  archived: number;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  author_id: string | null;
  content: string | null;
  blocks: string;
  citations: string;
  model_id: string | null;
  token_in: number | null;
  token_out: number | null;
  cost: number | null;
  duration_ms: number | null;
  created_at: string;
}

export class ChatService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly permissions: PermissionService;
  private readonly retriever: Retriever;
  private readonly gateway: ModelGateway;

  constructor(db: Db = getDb(), deps: { retriever?: Retriever; gateway?: ModelGateway } = {}) {
    this.db = db;
    this.audit = new AuditService(db);
    this.permissions = new PermissionService(db);
    this.retriever = deps.retriever ?? mockRetriever;
    this.gateway = deps.gateway ?? mockModelGateway;
  }

  /* ═══════ 映射 ═══════ */

  private toSession(row: SessionRow): Session {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      ownerId: row.owner_id,
      agentId: row.agent_id ?? undefined,
      modelId: row.model_id ?? undefined,
      kbSpaceId: row.kb_space_id ?? undefined,
      skillIds: parseJsonArray(row.skill_ids),
      permScope: row.perm_scope ?? undefined,
      relatedTaskIds: parseJsonArray(row.related_task_ids),
      archived: toBool(row.archived),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toMessage(row: MessageRow): Message {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role as SessionRole,
      authorId: row.author_id ?? undefined,
      content: row.content ?? undefined,
      blocks: parseJsonArrayOf<MessageBlock>(row.blocks),
      citations: parseJsonArrayOf<Citation>(row.citations),
      modelId: row.model_id ?? undefined,
      tokenIn: Number(row.token_in ?? 0),
      tokenOut: Number(row.token_out ?? 0),
      cost: Number(row.cost ?? 0),
      durationMs: row.duration_ms ?? undefined,
      createdAt: row.created_at,
    };
  }

  private sessionOrThrow(id: string): SessionRow {
    const row = this.db.get<SessionRow>('SELECT * FROM session WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `会话不存在：${id}`);
    return row;
  }

  /* ═══════ 会话 ═══════ */

  listSessions(workspaceId: string = DEFAULT_WORKSPACE): Session[] {
    return this.db
      .all<SessionRow>(
        'SELECT * FROM session WHERE workspace_id = ? AND archived = 0 ORDER BY updated_at DESC',
        [workspaceId],
      )
      .map((row) => this.toSession(row));
  }

  createSession(req: CreateSessionReq): Session {
    if (!req.title) throw new AppError(ErrCode.BAD_REQUEST, '会话标题不能为空');
    const id = `ses-${nanoid(10)}`;
    const now = isoNow();

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO session (
           id, workspace_id, title, owner_id, agent_id, model_id, kb_space_id, skill_ids,
           perm_scope, related_task_ids, archived, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          id,
          DEFAULT_WORKSPACE,
          req.title,
          req.ownerId ?? DEFAULT_OWNER,
          req.agentId ?? null,
          req.modelId ?? null,
          req.kbSpaceId ?? null,
          JSON.stringify(req.skillIds ?? []),
          req.permScope ?? null,
          JSON.stringify(req.relatedTaskIds ?? []),
          now,
          now,
        ],
      );
      this.audit.write({
        action: 'session_created',
        actorId: req.ownerId ?? DEFAULT_OWNER,
        actorType: MemberType.HUMAN,
        initiatorId: req.ownerId ?? DEFAULT_OWNER,
        resourceType: 'session',
        resourceId: id,
        resourceName: req.title,
        detail: { agentId: req.agentId ?? null, modelId: req.modelId ?? null },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    metrics.emit(MetricEvent.SESSION_CREATED, { sessionId: id });
    return this.toSession(this.sessionOrThrow(id));
  }

  getSession(id: string): Session & { messages: Message[] } {
    const session = this.toSession(this.sessionOrThrow(id));
    return { ...session, messages: this.messages(id) };
  }

  removeSession(id: string): { id: string } {
    const row = this.sessionOrThrow(id);
    this.db.tx(() => {
      this.db.run('DELETE FROM message WHERE session_id = ?', [id]);
      this.db.run('UPDATE skill_execution SET session_id = NULL WHERE session_id = ?', [id]);
      this.db.run('DELETE FROM session WHERE id = ?', [id]);
      this.audit.write({
        action: 'session_deleted',
        resourceType: 'session',
        resourceId: id,
        resourceName: row.title,
        workspaceId: row.workspace_id,
      });
    });
    return { id };
  }

  /** 模型切换：会话级生效（校验模型存在且启用） */
  switchModel(sessionId: string, modelId: string): Session {
    this.sessionOrThrow(sessionId);
    const model = this.db.get<{ id: string; name: string; enabled: number }>(
      'SELECT id, name, enabled FROM model_config WHERE id = ?',
      [modelId],
    );
    if (!model) throw new AppError(ErrCode.NOT_FOUND, `模型不存在：${modelId}`);
    if (!toBool(model.enabled)) {
      throw new AppError(ErrCode.MODEL_UNAVAILABLE, `模型已停用：${model.name}`, { modelId });
    }

    const now = isoNow();
    this.db.tx(() => {
      this.db.run('UPDATE session SET model_id = ?, updated_at = ? WHERE id = ?', [modelId, now, sessionId]);
      this.audit.write({
        action: 'session_model_switched',
        resourceType: 'session',
        resourceId: sessionId,
        resourceName: model.name,
        detail: { modelId },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return this.toSession(this.sessionOrThrow(sessionId));
  }

  /* ═══════ 消息 ═══════ */

  messages(sessionId: string): Message[] {
    this.sessionOrThrow(sessionId);
    return this.db
      .all<MessageRow>('SELECT * FROM message WHERE session_id = ? ORDER BY created_at ASC, rowid ASC', [
        sessionId,
      ])
      .map((row) => this.toMessage(row));
  }

  /** 发送消息：落用户消息 + 生成助手消息（检索引用 + 工具调用块） */
  sendMessage(
    sessionId: string,
    input: { content: string; mentions?: string[] },
    ownerId?: string,
  ): { userMessage: Message; assistantMessage: Message } {
    const session = this.sessionOrThrow(sessionId);
    if (!input.content || input.content.trim() === '') {
      throw new AppError(ErrCode.BAD_REQUEST, '消息内容不能为空');
    }

    const now = isoNow();
    const actorId = ownerId ?? session.owner_id;
    const userMessageId = `msg-${nanoid(10)}`;
    const assistantMessageId = `msg-${nanoid(10)}`;
    const traceId = trace.current();

    // 1) 检索：ACL 过滤 → 召回
    const allowedSpaceIds = session.kb_space_id
      ? [session.kb_space_id].filter((s) => this.permissions.resolveReadableSpaces(actorId).includes(s))
      : this.permissions.resolveReadableSpaces(actorId);

    const chunks = this.retriever.search({
      query: input.content,
      allowedSpaceIds,
      topK: 4,
    });
    const citations: Citation[] = chunks.map((c) => ({
      docId: c.docId,
      spaceName: c.spaceName,
      heading: c.heading,
      version: c.version,
      snippet: c.content.slice(0, 120),
    }));

    // 2) 场景路由
    const scene: Scene = session.perm_scope?.includes('敏感') ? 'sensitive' : chunks.length > 0 ? 'reasoning' : 'daily';
    const modelResult = this.gateway.complete({
      prompt: input.content,
      scene,
      context: chunks.map((c) => c.content).join('\n'),
      agentId: session.agent_id ?? undefined,
      preferredModelId: session.model_id ?? undefined,
    });

    // 3) 富块：有技能绑定则产生工具调用块
    const blocks: MessageBlock[] = [];
    const skillIds = parseJsonArray(session.skill_ids);
    if (skillIds.length > 0) {
      const firstSkill = this.db.get<{ id: string; name: string; current_version: string | null }>(
        'SELECT id, name, current_version FROM skill WHERE id = ?',
        [skillIds[0]],
      );
      if (firstSkill) {
        blocks.push({
          kind: MessageBlockKind.TOOL_CALL,
          data: {
            skillId: firstSkill.id,
            skillName: firstSkill.name,
            version: firstSkill.current_version,
            sandboxId: `sbx-${nanoid(6)}`,
            localFiles: 0,
            input: { query: input.content },
            status: 'success',
          },
        });
      }
    }
    for (const citation of citations) {
      blocks.push({
        kind: MessageBlockKind.CITATION,
        data: { docId: citation.docId, heading: citation.heading ?? null, version: citation.version },
      });
    }

    const assistantContent = citations.length > 0
      ? `${modelResult.text}\n\n引用依据：\n${citations
          .map((c, i) => `[${i + 1}] 《${c.spaceName}》${c.heading ? ` · ${c.heading}` : ''}（v${c.version}）`)
          .join('\n')}`
      : `${modelResult.text}\n\n（本次未命中可引用依据，结论仅供参考）`;

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO message (
           id, session_id, role, author_id, content, blocks, citations, model_id,
           token_in, token_out, cost, duration_ms, created_at
         ) VALUES (?, ?, 'user', ?, ?, '[]', '[]', NULL, 0, 0, 0, NULL, ?)`,
        [userMessageId, sessionId, actorId, input.content, now],
      );

      this.db.run(
        `INSERT INTO message (
           id, session_id, role, author_id, content, blocks, citations, model_id,
           token_in, token_out, cost, duration_ms, created_at
         ) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assistantMessageId,
          sessionId,
          session.agent_id ?? null,
          assistantContent,
          JSON.stringify(blocks),
          JSON.stringify(citations),
          modelResult.modelId,
          modelResult.tokenIn,
          modelResult.tokenOut,
          modelResult.cost,
          modelResult.durationMs,
          isoNow(),
        ],
      );

      this.db.run('UPDATE session SET updated_at = ? WHERE id = ?', [isoNow(), sessionId]);

      metrics.recordUsage(
        {
          workspaceId: session.workspace_id,
          category: 'model',
          modelId: modelResult.modelId,
          agentId: session.agent_id ?? null,
          tokenIn: modelResult.tokenIn,
          tokenOut: modelResult.tokenOut,
          cost: modelResult.cost,
          traceId,
        },
        this.db,
      );

      if (session.agent_id) {
        this.db.run('UPDATE agent_config SET quota_used = quota_used + ? WHERE member_id = ?', [
          modelResult.cost,
          session.agent_id,
        ]);
      }

      this.audit.write({
        action: 'message_sent',
        traceId,
        actorId,
        actorType: MemberType.HUMAN,
        initiatorId: actorId,
        resourceType: 'session',
        resourceId: sessionId,
        resourceName: session.title,
        durationMs: modelResult.durationMs,
        tokenUsed: modelResult.tokenIn + modelResult.tokenOut,
        detail: { modelId: modelResult.modelId, citationCount: citations.length, scene },
        workspaceId: session.workspace_id,
      });
    });

    metrics.emit(MetricEvent.MESSAGE_SENT, { sessionId, citationCount: citations.length }, actorId);

    const userMessage = this.db.get<MessageRow>('SELECT * FROM message WHERE id = ?', [userMessageId]);
    const assistantMessage = this.db.get<MessageRow>('SELECT * FROM message WHERE id = ?', [
      assistantMessageId,
    ]);
    return {
      userMessage: this.toMessage(userMessage as MessageRow),
      assistantMessage: this.toMessage(assistantMessage as MessageRow),
    };
  }

  editMessage(id: string, content: string): Message {
    const row = this.db.get<MessageRow>('SELECT * FROM message WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `消息不存在：${id}`);
    if (content.trim() === '') throw new AppError(ErrCode.BAD_REQUEST, '消息内容不能为空');

    this.db.tx(() => {
      this.db.run('UPDATE message SET content = ? WHERE id = ?', [content, id]);
      this.audit.write({
        action: 'message_edited',
        resourceType: 'message',
        resourceId: id,
        resourceName: row.session_id,
        detail: { before: (row.content ?? '').slice(0, 120), after: content.slice(0, 120) },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    const updated = this.db.get<MessageRow>('SELECT * FROM message WHERE id = ?', [id]);
    return this.toMessage(updated as MessageRow);
  }

  deleteMessage(id: string): { id: string } {
    const row = this.db.get<MessageRow>('SELECT * FROM message WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `消息不存在：${id}`);

    this.db.tx(() => {
      this.db.run('DELETE FROM message WHERE id = ?', [id]);
      this.audit.write({
        action: 'message_deleted',
        resourceType: 'message',
        resourceId: id,
        resourceName: row.session_id,
        detail: { role: row.role },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return { id };
  }
}

export const chatService = new ChatService();
