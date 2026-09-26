import { HealthOSError, normalizeError } from "./errors.js";
import { assertSafeUrl } from "./url.js";
import { categorizeHttpStatus, withRetry, type RetryOptions } from "./retry.js";

export interface HttpRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  /** Caller identity for structured logs. */
  integration?: string;
  retry?: RetryOptions;
  accept?: "json" | "text" | "buffer";
  /**
   * Set false to observe the 3xx itself instead of the destination. Used for DOI
   * verification: `doi.org` answering with a redirect proves the DOI is
   * registered, whereas following it lands on publisher bot protection that says
   * nothing about the citation.
   */
  followRedirects?: boolean;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: Uint8Array;
  text(): string;
  json<T>(): T;
  retryAfterMs?: number;
  /** Present when `followRedirects: false` and the response is a 3xx. */
  location?: string;
}

const REDACT = /^(authorization|cookie|x-api-key|api-key)$/i;

function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = REDACT.test(key) ? "[redacted]" : value;
  }
  return out;
}

async function singleRequest(request: HttpRequest): Promise<HttpResponse> {
  const url = await assertSafeUrl(request.url);
  const timeoutMs = request.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const method = request.method ?? "GET";
  const followRedirects = request.followRedirects !== false;
  const headers: Record<string, string> = {
    "user-agent": "health-content-os/1.0 (+https://example.invalid/health-content-os)",
    ...scrubHeaders(request.headers ?? {}),
  };
  if (request.accept === "json") headers["accept"] ??= "application/json";
  if (request.body !== undefined && headers["content-type"] === undefined) {
    headers["content-type"] = "application/json";
  }
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: request.body as BodyInit | undefined,
      signal: controller.signal,
      redirect: followRedirects ? "follow" : "manual",
    });
    const body = new Uint8Array(await response.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    const text = () => new TextDecoder().decode(body);
    const retryAfterHeader = responseHeaders["retry-after"];
    const retryAfterMs = retryAfterHeader
      ? Math.max(0, (Number.parseInt(retryAfterHeader, 10) || 0) * 1000)
      : undefined;
    const result: HttpResponse = {
      status: response.status,
      ok: response.ok,
      headers: responseHeaders,
      body,
      text,
      json: <T>() => JSON.parse(text()) as T,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
    const isRedirect = response.status >= 300 && response.status < 400;
    if (isRedirect && !followRedirects) {
      const location = responseHeaders["location"];
      if (location) result.location = location;
      return result;
    }
    if (!response.ok) {
      throw new HealthOSError(`HTTP ${response.status} from ${request.integration ?? url.host}`, {
        category: categorizeHttpStatus(response.status, text().slice(0, 2000)),
        details: {
          url: url.toString().slice(0, 300),
          status: response.status,
          integration: request.integration,
          body: text().slice(0, 1200),
        },
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
    }
    return result;
  } catch (error) {
    if (error instanceof HealthOSError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new HealthOSError(`Request to ${url.host} timed out after ${timeoutMs}ms`, {
        category: "TIMEOUT",
        details: { url: url.toString().slice(0, 300) },
        cause: error,
      });
    }
    throw normalizeError(error, { stage: request.integration ?? "http" });
  } finally {
    clearTimeout(timer);
  }
}

export async function httpRequest(request: HttpRequest): Promise<HttpResponse> {
  return await withRetry(() => singleRequest(request), {
    ...request.retry,
    label: request.integration ?? "http",
  });
}

export async function fetchJson<T>(request: HttpRequest): Promise<T> {
  const response = await httpRequest({ accept: "json", ...request });
  return response.json<T>();
}
