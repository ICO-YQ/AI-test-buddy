import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 测试统一使用内存库 + node:sqlite 驱动，避免污染开发数据库
    env: {
      DB_PATH: ':memory:',
      DB_DRIVER: 'node',
      LOG_REQUESTS: '0',
      LOG_PRETTY: '0',
      AUTO_MIGRATE: '0',
      AUTO_SEED: '0',
    },
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
