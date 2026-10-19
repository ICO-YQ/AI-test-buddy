/**
 * 数据库驱动适配器（对应 architecture.md §1.4）
 *
 * 驱动差异**只**隔离在本文件内，上层（migrate/seed/services）只依赖 `Db` 接口。
 *
 * 驱动选择（环境变量 `DB_DRIVER`）：
 *   - `node`（**默认**）：Node 22 内置 `node:sqlite`（DatabaseSync / StatementSync）
 *       无需预编译二进制下载、无需 `--experimental-sqlite` flag（仅打印 ExperimentalWarning）
 *   - `better`：`better-sqlite3`，若安装/加载失败会自动回退到 `node` 并打印告警
 *
 * 两个驱动的 SQL 方言一致（同为 SQLite），`schema.sql` 无需改动。
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

/* ═══════════════ 对外接口（上层唯一依赖） ═══════════════ */

export interface Db {
  /** 查询多行 */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  /** 查询单行 */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  /** 执行写入，返回受影响行数 */
  run(sql: string, params?: unknown[]): { changes: number };
  /** 执行多语句脚本（DDL 等） */
  exec(sql: string): void;
  /**
   * 事务包装 —— 审计与业务写操作**必须**同事务，审计失败即整体回滚。
   * 支持嵌套（内层使用 SAVEPOINT）。
   */
  tx<T>(fn: () => T): T;
  /** 当前使用的驱动名 */
  readonly driver: DbDriverName;
  /** 底层数据库文件路径（`:memory:` 表示内存库） */
  readonly file: string;
  /** 关闭连接 */
  close(): void;
  /** 底层原生句柄（仅迁移/诊断使用，业务层禁止直接访问） */
  readonly raw: RawDb;
}

export type DbDriverName = 'node' | 'better';

/* ═══════════════ 原生驱动抽象 ═══════════════ */

interface RawStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface RawDb {
  exec(sql: string): void;
  prepare(sql: string): RawStatement;
  close(): void;
}

interface StatementCtor {
  new (db: unknown, sql: string): RawStatement;
}

/* ═══════════════ 参数归一化 ═══════════════ */

/**
 * SQLite 绑定参数归一化：
 *  - `undefined` → `null`（node:sqlite 不接受 undefined）
 *  - `boolean` → `0/1`
 *  - `Date` → ISO 字符串
 *  - 对象/数组 → JSON 字符串
 */
export function normalizeParams(params?: unknown[]): unknown[] {
  if (!params || params.length === 0) return [];
  return params.map((p) => normalizeParam(p));
}

function normalizeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  const t = typeof value;
  if (t === 'boolean') return value ? 1 : 0;
  if (t === 'number' || t === 'string' || t === 'bigint') return value;
  if (value instanceof Date) return value.toISOString();
  if (t === 'object') return JSON.stringify(value);
  return String(value);
}

/** 把 bigint 结果统一转为 number（避免 JSON 序列化报错） */
function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  return Number(value ?? 0);
}

/* ═══════════════ 驱动加载 ═══════════════ */

interface LoadedDriver {
  name: DbDriverName;
  create(file: string): RawDb;
}

/** Node 22 内置 node:sqlite */
function loadNodeSqlite(): LoadedDriver {
  const mod = require('node:sqlite') as {
    DatabaseSync: new (file: string) => {
      exec(sql: string): void;
      prepare(sql: string): RawStatement;
      close(): void;
    };
  };
  const { DatabaseSync } = mod;
  if (typeof DatabaseSync !== 'function') {
    throw new Error('node:sqlite 未提供 DatabaseSync');
  }
  return {
    name: 'node',
    create(file: string): RawDb {
      const db = new DatabaseSync(file);
      return {
        exec: (sql: string) => db.exec(sql),
        prepare: (sql: string) => db.prepare(sql),
        close: () => db.close(),
      };
    },
  };
}

/** better-sqlite3（可选分支） */
function loadBetterSqlite3(): LoadedDriver {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Better = require('better-sqlite3') as new (file: string) => any;
  return {
    name: 'better',
    create(file: string): RawDb {
      const db = new Better(file);
      return {
        exec: (sql: string) => db.exec(sql),
        prepare: (sql: string) => db.prepare(sql),
        close: () => db.close(),
      };
    },
  };
}

let cachedDriver: LoadedDriver | null = null;

/**
 * 解析驱动：读 `DB_DRIVER`，默认 `node`。
 * 若指定 `better` 但加载失败 → 自动回退 `node` 并打印告警（不阻塞启动）。
 */
export function resolveDriver(): LoadedDriver {
  if (cachedDriver) return cachedDriver;
  const want = (process.env.DB_DRIVER ?? 'node').trim().toLowerCase();

  if (want === 'better') {
    try {
      cachedDriver = loadBetterSqlite3();
      return cachedDriver;
    } catch (err) {
      // 自动降级路径（§1.4）
      console.warn(
        `[db] better-sqlite3 加载失败，已自动降级到 node:sqlite。原因: ${(err as Error).message}`,
      );
      cachedDriver = loadNodeSqlite();
      return cachedDriver;
    }
  }

  try {
    cachedDriver = loadNodeSqlite();
    return cachedDriver;
  } catch (err) {
    // node:sqlite 不可用时最后尝试 better-sqlite3
    try {
      cachedDriver = loadBetterSqlite3();
      return cachedDriver;
    } catch {
      throw new Error(
        `[db] 无可用 SQLite 驱动：node:sqlite 与 better-sqlite3 均加载失败。node:sqlite 错误: ${
          (err as Error).message
        }`,
      );
    }
  }
}

export function resetDriverCache(): void {
  cachedDriver = null;
}

/* ═══════════════ Db 实现 ═══════════════ */

class SqliteDb implements Db {
  readonly driver: DbDriverName;
  readonly file: string;
  readonly raw: RawDb;

  /** 事务嵌套深度 */
  private depth = 0;

  constructor(driver: LoadedDriver, file: string) {
    this.driver = driver.name;
    this.file = file;
    this.raw = driver.create(file);
    this.applyPragmas();
  }

  /** 外键约束 + WAL（§3.1 约定） */
  private applyPragmas(): void {
    try {
      this.raw.exec('PRAGMA foreign_keys = ON;');
      if (this.file !== ':memory:') {
        this.raw.exec('PRAGMA journal_mode = WAL;');
      }
      this.raw.exec('PRAGMA busy_timeout = 5000;');
      this.raw.exec('PRAGMA synchronous = NORMAL;');
    } catch (err) {
      console.warn(`[db] PRAGMA 设置失败（可忽略于内存库）: ${(err as Error).message}`);
    }
  }

  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    const stmt = this.raw.prepare(sql);
    return stmt.all(...normalizeParams(params)) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined {
    const stmt = this.raw.prepare(sql);
    const row = stmt.get(...normalizeParams(params));
    return (row ?? undefined) as T | undefined;
  }

  run(sql: string, params?: unknown[]): { changes: number } {
    const stmt = this.raw.prepare(sql);
    const res = stmt.run(...normalizeParams(params));
    return { changes: toNumber(res?.changes ?? 0) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  tx<T>(fn: () => T): T {
    const isOuter = this.depth === 0;
    const savepoint = `sp_${this.depth}`;

    if (isOuter) {
      this.raw.exec('BEGIN');
    } else {
      this.raw.exec(`SAVEPOINT ${savepoint}`);
    }
    this.depth += 1;

    try {
      const result = fn();
      this.depth -= 1;
      if (isOuter) {
        this.raw.exec('COMMIT');
      } else {
        this.raw.exec(`RELEASE ${savepoint}`);
      }
      return result;
    } catch (err) {
      this.depth -= 1;
      try {
        if (isOuter) {
          this.raw.exec('ROLLBACK');
        } else {
          this.raw.exec(`ROLLBACK TO ${savepoint}`);
          this.raw.exec(`RELEASE ${savepoint}`);
        }
      } catch {
        /* 回滚失败时保留原始错误 */
      }
      throw err;
    }
  }

  close(): void {
    try {
      this.raw.close();
    } catch {
      /* 已关闭 */
    }
  }
}

/* ═══════════════ 单例管理 ═══════════════ */

let instance: Db | null = null;

/** 解析数据库文件路径（默认 apps/server/data/huanbuddy.db） */
export function resolveDbPath(): string {
  const configured = process.env.DB_PATH?.trim();
  if (configured === ':memory:') return ':memory:';
  const target = configured && configured.length > 0 ? configured : path.join('data', 'huanbuddy.db');
  const absolute = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
  if (absolute !== ':memory:') {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
  }
  return absolute;
}

/** 打开（或复用）数据库连接 */
export function openDb(file?: string): Db {
  if (instance) return instance;
  const driver = resolveDriver();
  const target = file ?? resolveDbPath();
  instance = new SqliteDb(driver, target);
  return instance;
}

/** 获取全局连接（惰性打开） */
export function getDb(): Db {
  return instance ?? openDb();
}

/** 关闭全局连接（测试/退出用） */
export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/** 注入外部连接（单元测试使用内存库） */
export function setDb(db: Db | null): void {
  instance = db;
}

/* ═══════════════ 行数据解析工具（snake_case → 业务结构） ═══════════════ */

/** 当前时间（ISO 8601 UTC，秒级，含 Z） */
export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Date → ISO 8601 UTC 字符串 */
export function isoOf(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 解析 TEXT 中的 JSON 数组（容错：非法内容返回 []） */
export function parseJsonArray(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

/** 解析 TEXT 中的 JSON 对象（容错：非法内容返回 {}） */
export function parseJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(
  raw: unknown,
): T {
  if (raw === null || raw === undefined) return {} as T;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as T;
  if (typeof raw !== 'string' || raw.trim() === '') return {} as T;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

/** 解析 TEXT 中的 JSON 数组（元素为对象，容错） */
export function parseJsonArrayOf<T>(raw: unknown): T[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** SQLite INTEGER(0/1) → boolean */
export function toBool(value: unknown): boolean {
  return Number(value) === 1;
}


/** 创建独立的内存库（单元测试） */
export function createMemoryDb(): Db {
  const driver = resolveDriver();
  return new SqliteDb(driver, ':memory:');
}

export { SqliteDb };
