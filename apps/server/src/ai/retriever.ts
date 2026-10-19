/**
 * 知识检索（Retriever）
 *
 * 铁律（§4.7）：**先按 ACL 过滤再召回**（非生成后过滤）——
 * 无权限内容不进入候选集，`allowedSpaceIds` 由 PermissionService 预先解析。
 *
 * REPLACE_POINT: 当前为 `MockRetriever` —— 关键词打分 + 标题/小标题加权 + 简单重排。
 * 未来替换点：接入向量库（embedding + ANN 召回）+ rerank 模型；`kb_chunk.embedding` 为预留字段。
 *
 * 接口签名稳定：`search(input) → RetrievedChunk[]`
 */

import { getDb, type Db } from '../db/client';

export interface RetrieveInput {
  query: string;
  /** 已按 ACL 解析出的**可读**空间集合（空数组 → 直接返回空结果） */
  allowedSpaceIds: string[];
  topK?: number;
  /** 可选：限制在单个文档内检索 */
  docId?: string;
}

export interface RetrievedChunk {
  chunkId: string;
  docId: string;
  docTitle: string;
  spaceId: string;
  spaceName: string;
  heading?: string;
  version: number;
  content: string;
  score: number;
}

export interface Retriever {
  search(input: RetrieveInput): RetrievedChunk[];
}

interface ChunkRow {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  space_id: string;
  space_name: string;
  heading: string | null;
  version: number;
  content: string;
}

/** 把查询切成检索词：整串 + 空白分词 + 中文 2-gram */
export function tokenize(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const terms = new Set<string>();
  terms.add(normalized);
  for (const part of normalized.split(/[\s,，。；;、/|]+/)) {
    if (part.length >= 2) terms.add(part);
  }
  const cjk = normalized.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i + 2 <= cjk.length; i += 1) {
    terms.add(cjk.slice(i, i + 2));
  }
  return Array.from(terms).filter((t) => t.length >= 2);
}

export class MockRetriever implements Retriever {
  private readonly db: Db;

  constructor(db: Db = getDb()) {
    this.db = db;
  }

  search(input: RetrieveInput): RetrievedChunk[] {
    const topK = Math.max(1, input.topK ?? 5);
    if (input.allowedSpaceIds.length === 0) return [];

    // ── 第一步：ACL 预过滤（SQL 层，无权限内容不进入候选集） ──
    const placeholders = input.allowedSpaceIds.map(() => '?').join(', ');
    const params: unknown[] = [...input.allowedSpaceIds];
    let sql = `
      SELECT c.id AS chunk_id, c.doc_id, d.title AS doc_title, c.space_id, s.name AS space_name,
             c.heading, c.version, c.content
      FROM kb_chunk c
      JOIN kb_document d ON d.id = c.doc_id
      JOIN kb_space s ON s.id = c.space_id
      WHERE c.space_id IN (${placeholders})
        AND d.deleted = 0
        AND d.current_version = c.version
    `;
    if (input.docId) {
      sql += ' AND c.doc_id = ?';
      params.push(input.docId);
    }

    const rows = this.db.all<ChunkRow>(sql, params);
    if (rows.length === 0) return [];

    // ── 第二步：关键词打分 + 重排 ──
    const terms = tokenize(input.query);
    const scored = rows.map((row) => {
      const haystack = `${row.doc_title}\n${row.heading ?? ''}\n${row.content}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) {
          // 标题命中权重更高
          const boost = row.doc_title.toLowerCase().includes(term)
            ? 3
            : (row.heading ?? '').toLowerCase().includes(term)
              ? 2
              : 1;
          score += boost;
        }
      }
      return {
        chunkId: row.chunk_id,
        docId: row.doc_id,
        docTitle: row.doc_title,
        spaceId: row.space_id,
        spaceName: row.space_name,
        heading: row.heading ?? undefined,
        version: Number(row.version),
        content: row.content,
        score,
      } satisfies RetrievedChunk;
    });

    return scored
      .filter((c) => c.score > 0)
      .sort((a, b) => (b.score === a.score ? a.chunkId.localeCompare(b.chunkId) : b.score - a.score))
      .slice(0, topK);
  }
}

export const mockRetriever = new MockRetriever();
