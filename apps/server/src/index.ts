/**
 * 进程入口：加载 env → 迁移 → 种子（可选） → listen
 *
 * 环境变量：
 *   PORT        监听端口，默认 3001
 *   HOST        监听地址，默认 0.0.0.0
 *   DB_DRIVER   node（默认）| better
 *   DB_PATH     数据库文件路径，默认 apps/server/data/huanbuddy.db
 *   AUTO_MIGRATE 启动时自动迁移，默认 1
 *   AUTO_SEED    库为空时自动灌入种子数据，默认 1
 *   LOG_PRETTY  控制台美化日志，默认 0（关闭）。设为 1 时若 pino-pretty 不可加载会自动回退 JSON
 */

import { buildApp, SERVER_VERSION } from './app';
import { closeDb, getDb } from './db/client';
import { migrate } from './db/migrate';
import { seed } from './db/seed';

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function tableCount(): number {
  const db = getDb();
  const row = db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  return row ? Number(row.c) : 0;
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '0.0.0.0';

  // ── 迁移（幂等） ──
  if (envFlag('AUTO_MIGRATE', true)) {
    const result = migrate();
    console.log(
      `[boot] 迁移完成 driver=${result.driver} tables=${result.tables.length}/${result.expected} file=${result.file}`,
    );
    if (result.missing.length > 0) {
      console.warn(`[boot] 缺失表: ${result.missing.join(', ')}`);
    }
  }

  // ── 种子（库为空时） ──
  if (envFlag('AUTO_SEED', true)) {
    const db = getDb();
    const taskCount = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM task');
    const empty = !taskCount || Number(taskCount.c) === 0;
    if (empty) {
      const summary = seed(db);
      console.log(`[boot] 种子数据写入完成（表数=${tableCount()}）：${JSON.stringify(summary)}`);
    } else {
      console.log('[boot] 已存在业务数据，跳过种子写入（如需重置：pnpm --filter @huanbuddy/server reset:db）');
    }
  }

  // ── 启动 HTTP 服务 ──
  const app = await buildApp();
  await app.listen({ port, host });

  console.log(`[boot] huanbuddy server v${SERVER_VERSION} 已启动: http://localhost:${port}`);
  console.log(`[boot] 健康检查: GET http://localhost:${port}/health`);
  console.log(`[boot] 内部接口: /api/* ｜ 对外能力: /v1/*`);

  // ── 优雅退出 ──
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[boot] 收到 ${signal}，正在关闭…`);
    try {
      await app.close();
      closeDb();
      console.log('[boot] 已安全退出');
      process.exit(0);
    } catch (error) {
      console.error('[boot] 关闭异常:', (error as Error).message);
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

main().catch((error) => {
  console.error('[boot] 启动失败:', error);
  process.exit(1);
});
