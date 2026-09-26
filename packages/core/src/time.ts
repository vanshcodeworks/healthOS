export const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

export interface Deadline {
  readonly expiresAt: number;
  remaining(): number;
  expired(): boolean;
}

export function deadline(ms: number): Deadline {
  const expiresAt = Date.now() + ms;
  return {
    expiresAt,
    remaining: () => Math.max(0, expiresAt - Date.now()),
    expired: () => Date.now() >= expiresAt,
  };
}

/** ISO-8601 UTC, the single timestamp format stored in the database. */
export function nowIso(): string {
  return new Date().toISOString();
}

export function isoAt(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function toIso(value: string | number | Date): string {
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date(value).toISOString();
}

export function seconds(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function round(n: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${Math.round(seconds % 60)}s`;
}
