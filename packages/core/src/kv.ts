import { nowIso } from "./time.js";
import type { Db } from "./db.js";

/**
 * Small durable key/value area for loop bookkeeping (thresholds, last run
 * times, learned weights). Survives restarts, unlike in-memory state.
 */
export class KvStore {
  constructor(private readonly db: Db) {}

  get<T>(key: string, fallback: T): T {
    const row = this.db.get<{ value: string }>("SELECT value FROM kv WHERE key = ?", [key]);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value ?? null), nowIso()],
    );
  }

  delete(key: string): void {
    this.db.run("DELETE FROM kv WHERE key = ?", [key]);
  }

  bumpCounter(key: string, by = 1): number {
    const next = this.get<number>(key, 0) + by;
    this.set(key, next);
    return next;
  }
}
