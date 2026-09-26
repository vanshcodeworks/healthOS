import dns from "node:dns/promises";
import net from "node:net";
import { HealthOSError } from "./errors.js";

const ALLOWED_PROTOCOLS = new Set(["https:"]);

function isPrivateAddress(address: string): boolean {
  const type = net.isIP(address);
  if (type === 4) {
    const parts = address.split(".").map((n) => Number.parseInt(n, 10));
    const [a = 0, b = 0] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (type === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return false;
  }
  return true;
}

/**
 * Validate an outbound URL: https only, no credentials in the URL, and no
 * loopback / link-local / private destinations. This blocks SSRF from any
 * content-derived URL (RSS feeds, stock search results, research APIs).
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HealthOSError(`Malformed URL: ${raw.slice(0, 120)}`, { category: "INVALID_REQUEST" });
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new HealthOSError(`Refusing non-https URL: ${url.protocol}`, {
      category: "INVALID_REQUEST",
      remediation: "Only https endpoints are permitted for outbound requests.",
    });
  }
  if (url.username || url.password) {
    throw new HealthOSError("Refusing URL containing embedded credentials", { category: "INVALID_CREDENTIAL" });
  }
  const host = url.hostname;
  const literal = net.isIP(host);
  if (literal) {
    if (isPrivateAddress(host)) {
      throw new HealthOSError(`Refusing private network address: ${host}`, { category: "INVALID_REQUEST" });
    }
    return url;
  }
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new HealthOSError(`Refusing internal hostname: ${host}`, { category: "INVALID_REQUEST" });
  }
  try {
    const records = await dns.lookup(host, { all: true });
    for (const record of records) {
      if (isPrivateAddress(record.address)) {
        throw new HealthOSError(`Host ${host} resolves to a private address`, {
          category: "INVALID_REQUEST",
        });
      }
    }
  } catch (error) {
    if (error instanceof HealthOSError) throw error;
    throw new HealthOSError(`DNS resolution failed for ${host}`, {
      category: "NETWORK_ERROR",
      cause: error,
    });
  }
  return url;
}

export function isLikelySafeUrlSync(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
    const host = url.hostname;
    if (net.isIP(host)) return !isPrivateAddress(host);
    return !/^(localhost|.*\.(local|internal))$/i.test(host);
  } catch {
    return false;
  }
}
