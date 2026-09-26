import { HealthOSError } from "./errors.js";

export function stringifyColumn(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJsonColumn<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function requireJsonColumn<T>(raw: unknown, context: string): T {
  try {
    return JSON.parse(String(raw)) as T;
  } catch (error) {
    throw new HealthOSError(`Corrupt JSON column in ${context}`, {
      category: "STORAGE_ERROR",
      cause: error,
    });
  }
}

/** Parse a JSON array column into a typed array, dropping malformed entries. */
export function parseJsonArray<T>(raw: unknown): T[] {
  const value = parseJsonColumn<unknown>(raw, []);
  return Array.isArray(value) ? (value.filter((v) => v !== null && v !== undefined) as T[]) : [];
}
