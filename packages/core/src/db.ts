import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { HealthOSError } from "./errors.js";
import { ensureDir, PATHS } from "./paths.js";
import { MIGRATIONS } from "./migrations/index.js";
import { nowIso } from "./time.js";

export type SqlValue = string | number | null | Uint8Array | bigint;
export type Row = Record<string, SqlValue>;

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
  checksum: string;
}

function simpleChecksum(sql: string): string {
  let hash = 0;
  for (let i = 0; i < sql.length; i++) {
    hash = (hash * 31 + sql.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface DatabaseOptions {
  /** File path, or ":memory:" for tests. */
  path?: string;
  verbose?: boolean;
  readonly?: boolean;
}

/**
 * Thin, explicit data layer over SQLite.
 *
 * SQL is written in a portable subset (TEXT ids, ISO-8601 timestamps, JSON in
 * TEXT columns, INTEGER/REAL numerics) so the schema can be adopted by
 * PostgreSQL with mechanical type mapping. See docs/architecture.md.
 */
export class Db {
  readonly path: string;
  private readonly handle: Database.Database;

  constructor(options: DatabaseOptions = {}) {
    this.path = options.path ?? PATHS.db;
    if (this.path !== ":memory:") ensureDir(path.dirname(this.path));
    try {
      this.handle = new Database(this.path, {
        verbose: options.verbose ? (msg?: unknown) => console.error(msg) : undefined,
        readonly: options.readonly ?? false,
      });
    } catch (error) {
      throw new HealthOSError(`Cannot open database at ${this.path}`, {
        category: "STORAGE_ERROR",
        cause: error,
        remediation: "Check filesystem permissions or set DATABASE_PATH to a writable location.",
      });
    }
    this.handle.pragma("journal_mode = WAL");
    this.handle.pragma("foreign_keys = ON");
    this.handle.pragma("busy_timeout = 8000");
    this.handle.pragma("synchronous = NORMAL");
  }

  raw(): Database.Database {
    return this.handle;
  }

  all<T = Row>(sql: string, params: SqlValue[] | object = []): T[] {
    return this.handle.prepare(sql).all(...(params as never[])) as T[];
  }

  get<T = Row>(sql: string, params: SqlValue[] | object = []): T | undefined {
    return this.handle.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  run(sql: string, params: SqlValue[] | object = []): Database.RunResult {
    return this.handle.prepare(sql).run(...(params as never[]));
  }

  exec(sql: string): void {
    this.handle.exec(sql);
  }

  pluck<T = SqlValue>(sql: string, params: SqlValue[] | object = []): T | undefined {
    const row = this.get<Row>(sql, params);
    if (!row) return undefined;
    const values = Object.values(row);
    return values[0] as T;
  }

  count(sql: string, params: SqlValue[] | object = []): number {
    return Number(this.pluck<number>(sql, params) ?? 0);
  }

  /** Synchronous transaction. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.handle.inTransaction) return fn();
    return this.handle.transaction(fn)();
  }

  tableExists(name: string): boolean {
    return (
      this.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]) !==
      undefined
    );
  }

  columnNames(table: string): string[] {
    return this.all<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`).map((r) => r.name);
  }

  appliedMigrations(): MigrationRecord[] {
    if (!this.tableExists("schema_migrations")) return [];
    return this.all<MigrationRecord>("SELECT id, name, applied_at, checksum FROM schema_migrations ORDER BY id");
  }

  /**
   * Apply pending migrations. Each migration runs in a transaction together
   * with its bookkeeping row, so an interrupted `db migrate` is always
   * resumable and never leaves a half-applied schema.
   */
  migrate(options: { verbose?: boolean } = {}): { applied: string[]; skipped: number } {
    this.handle.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        checksum TEXT NOT NULL
      )
    `);
    const applied = new Set(this.appliedMigrations().map((m) => m.id));
    const performed: string[] = [];
    for (const migration of MIGRATIONS) {
      const existing = this.get<MigrationRecord>("SELECT * FROM schema_migrations WHERE id = ?", [migration.id]);
      if (existing) {
        if (existing.checksum !== simpleChecksum(migration.sql)) {
          throw new HealthOSError(
            `Migration ${migration.id}_${migration.name} was modified after being applied`,
            {
              category: "CONFIG_ERROR",
              remediation:
                "Migrations are immutable. Add a new migration instead of editing an applied one, or reset the database.",
            },
          );
        }
        applied.add(migration.id);
        continue;
      }
      const run = this.handle.transaction(() => {
        this.handle.exec(migration.sql);
        this.handle
          .prepare("INSERT INTO schema_migrations (id, name, applied_at, checksum) VALUES (?, ?, ?, ?)")
          .run(migration.id, migration.name, nowIso(), simpleChecksum(migration.sql));
      });
      run();
      performed.push(`${migration.id}_${migration.name}`);
      if (options.verbose) console.log(`  migration applied: ${migration.id}_${migration.name}`);
    }
    return { applied: performed, skipped: MIGRATIONS.length - performed.length };
  }

  /** Drop every user table. Used by tests and `db reset`. */
  reset(): void {
    const tables = this.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'",
    );
    this.handle.pragma("foreign_keys = OFF");
    for (const table of tables) this.handle.exec(`DROP TABLE IF EXISTS "${table.name}"`);
    this.handle.pragma("foreign_keys = ON");
  }

  close(): void {
    try {
      this.handle.close();
    } catch {
      /* already closed */
    }
  }

  vacuum(): void {
    this.handle.exec("VACUUM");
  }

  get fileSizeBytes(): number {
    try {
      return fs.statSync(this.path).size;
    } catch {
      return 0;
    }
  }
}

export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new HealthOSError(`Unsafe SQL identifier: ${name}`, { category: "INVALID_REQUEST" });
  }
  return `"${name}"`;
}

let shared: Db | undefined;

export function getDb(options: DatabaseOptions = {}): Db {
  if (!shared || options.path) {
    shared = new Db(options);
  }
  return shared;
}

export function closeDb(): void {
  shared?.close();
  shared = undefined;
}
