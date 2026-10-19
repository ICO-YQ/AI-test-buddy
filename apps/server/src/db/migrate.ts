/**
 * 迁移：执行 `schema.sql`（幂等，可重复运行）
 * 同时开启外键约束与 WAL（由 db/client.ts 的 PRAGMA 负责）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openDb, type Db } from './client';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(HERE, 'schema.sql');

/** architecture.md §3.1 定义的业务表（28 张） */
export const EXPECTED_TABLES: string[] = [
  'agent_config',
  'api_key',
  'artifact',
  'audit_log',
  'board_column',
  'hub_repo',
  'hub_skill',
  'kb_chunk',
  'kb_doc_version',
  'kb_document',
  'kb_query_log',
  'kb_space',
  'kb_sync_source',
  'member',
  'message',
  'model_config',
  'model_degradation_log',
  'notification',
  'scene_route',
  'session',
  'skill',
  'skill_execution',
  'skill_permission',
  'skill_version',
  'task',
  'task_activity',
  'usage_record',
  'workspace',
];

export interface MigrateResult {
  tables: string[];
  expected: number;
  missing: string[];
  driver: string;
  file: string;
}

/** 读取 schema.sql 全文 */
export function readSchema(): string {
  return fs.readFileSync(SCHEMA_PATH, 'utf8');
}

/** 列出当前库中的业务表 */
export function listTables(db: Db): string[] {
  return db
    .all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .map((r) => r.name);
}

/** 执行迁移（幂等） */
export function migrate(db: Db = openDb()): MigrateResult {
  db.exec(readSchema());
  const tables = listTables(db);
  const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
  return {
    tables,
    expected: EXPECTED_TABLES.length,
    missing,
    driver: db.driver,
    file: db.file,
  };
}

/** 重建数据库（删除文件后重新迁移）—— 仅开发演示使用 */
export function dropAll(db: Db = openDb()): void {
  const tables = listTables(db);
  db.exec('PRAGMA foreign_keys = OFF;');
  db.tx(() => {
    for (const t of tables) {
      db.exec(`DROP TABLE IF EXISTS "${t}";`);
    }
  });
  db.exec('PRAGMA foreign_keys = ON;');
}

/* ═══════════════ CLI ═══════════════ */

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const result = migrate();
  console.log(
    `[migrate] driver=${result.driver} file=${result.file} tables=${result.tables.length}/${result.expected}`,
  );
  if (result.missing.length > 0) {
    console.error(`[migrate] 缺失表: ${result.missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('[migrate] 迁移完成（幂等）');
  }
}
