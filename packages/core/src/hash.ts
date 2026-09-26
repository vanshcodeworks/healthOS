import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys sorted recursively so that hashing is stable
 * regardless of property insertion order. This is the backbone of the
 * content-addressed render cache.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalise);
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    out[key] = canonicalise(source[key]);
  }
  return out;
}

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function shortHash(input: string, length = 12): string {
  return sha256(input).slice(0, length);
}

/** Full content hash of any JSON-serialisable structure. */
export function hashContent(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function hashFile(path: string): Promise<string> {
  // Lazily required so that pure-JS consumers of this module stay light.
  return import("node:fs/promises").then((fs) =>
    fs.readFile(path).then((buf) => sha256(buf)),
  );
}
