/**
 * 测试前置：内存库 + 迁移 + 种子
 *
 * vitest.config.ts 已将 DB_PATH 设为 `:memory:`，因此每个测试文件（每个 worker）
 * 都获得独立的 SQLite 内存库，且 `getDb()` 单例与之保持一致。
 */

import { getDb } from '../db/client';
import { migrate } from '../db/migrate';
import { seed } from '../db/seed';

const db = getDb();
const migration = migrate(db);

if (migration.missing.length > 0) {
  throw new Error(`[test-setup] 迁移缺失表：${migration.missing.join(', ')}`);
}

export const seedSummary = seed(db);
