import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

/**
 * Monotonic, lexicographically sortable identifier (ULID-compatible layout:
 * 48-bit timestamp + 80-bit randomness). Stable across restarts because the
 * timestamp prefix is real time, and sortable by creation order in the DB.
 */
export function ulid(now: number = Date.now()): string {
  let time = now;
  const chars = new Array<string>(26);
  for (let i = 9; i >= 0; i--) {
    chars[i] = ALPHABET[time % 32] as string;
    time = Math.floor(time / 32);
  }
  const random = randomBytes(16);
  for (let i = 0; i < 16; i++) {
    chars[10 + i] = ALPHABET[(random[i] as number) % 32] as string;
  }
  return chars.join("");
}

/** ULID timestamp -> epoch millis, or null when malformed. */
export function ulidTime(id: string): number | null {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return null;
  let time = 0;
  for (let i = 0; i < 10; i++) {
    const value = ALPHABET.indexOf(id.charAt(i));
    if (value < 0) return null;
    time = time * 32 + value;
  }
  return time;
}

/**
 * Deterministic id derived from stable inputs. Used for topics, sources and
 * claims so that re-running discovery does not create duplicates.
 */
export function deterministicId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `${prefix}_${digest.slice(0, 20)}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${ulid().toLowerCase()}`;
}
