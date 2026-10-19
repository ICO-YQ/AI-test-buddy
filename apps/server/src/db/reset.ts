/**
 * 重置数据库：删除全部表 → 重新迁移 → 重新种子。
 * 用法：pnpm --filter @huanbuddy/server reset:db
 */

import { getDb } from './client';
import { dropAll, migrate } from './migrate';
import { seed } from './seed';

export function resetDatabase(): void {
  const db = getDb();
  dropAll(db);
  const result = migrate(db);
  console.log(`[reset] 已重建 ${result.tables.length} 张表 (driver=${result.driver})`);
  const summary = seed(db);
  console.log(`[reset] 种子完成: ${JSON.stringify(summary)}`);
}

resetDatabase();
