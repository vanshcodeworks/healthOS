/**
 * Central error taxonomy.
 *
 * Every failure that crosses a stage boundary is one of these, so the job
 * system can make a retry decision without parsing strings.
 */

export const ERROR_CATEGORIES = [
  "NETWORK_ERROR",
  "RATE_LIMIT",
  "INVALID_CREDENTIAL",
  "INVALID_REQUEST",
  "INVALID_HEALTH_CLAIM",
  "SCHEMA_VIOLATION",
  "MISSING_ASSET",
  "ASSET_RIGHTS",
  "RENDER_ERROR",
  "AUDIO_ERROR",
  "CAPTION_ERROR",
  "QA_FAILED",
  "ORIGINALITY_REJECTED",
  "DUPLICATE",
  "TIMEOUT",
  "STORAGE_ERROR",
  "CONFIG_ERROR",
  "UNSUPPORTED",
  "INTERNAL",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** Retry semantics per category. Permanent failures must never be retried. */
export const RETRYABLE: Readonly<Record<ErrorCategory, boolean>> = Object.freeze({
  NETWORK_ERROR: true,
  RATE_LIMIT: true,
  TIMEOUT: true,
  STORAGE_ERROR: true,
  RENDER_ERROR: true,
  AUDIO_ERROR: true,
  INTERNAL: true,
  INVALID_CREDENTIAL: false,
  INVALID_REQUEST: false,
  INVALID_HEALTH_CLAIM: false,
  SCHEMA_VIOLATION: false,
  MISSING_ASSET: false,
  ASSET_RIGHTS: false,
  QA_FAILED: false,
  ORIGINALITY_REJECTED: false,
  DUPLICATE: false,
  CAPTION_ERROR: false,
  CONFIG_ERROR: false,
  UNSUPPORTED: false,
});

export interface HealthOSErrorOptions {
  category?: ErrorCategory;
  stage?: string;
  jobId?: string;
  videoId?: string;
  remediation?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
  /** Milliseconds the caller must wait before retrying (rate limits). */
  retryAfterMs?: number;
}

export class HealthOSError extends Error {
  readonly category: ErrorCategory;
  readonly stage: string | undefined;
  readonly jobId: string | undefined;
  readonly videoId: string | undefined;
  readonly remediation: string | undefined;
  readonly details: Record<string, unknown>;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: HealthOSErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HealthOSError";
    this.category = options.category ?? "INTERNAL";
    this.stage = options.stage;
    this.jobId = options.jobId;
    this.videoId = options.videoId;
    this.remediation = options.remediation;
    this.details = options.details ?? {};
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE[this.category];
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      stage: this.stage,
      jobId: this.jobId,
      videoId: this.videoId,
      remediation: this.remediation,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      details: this.details,
    };
  }
}

export class ConfigError extends HealthOSError {
  constructor(message: string, options: HealthOSErrorOptions = {}) {
    super(message, { ...options, category: "CONFIG_ERROR" });
    this.name = "ConfigError";
  }
}

export class SchemaError extends HealthOSError {
  constructor(message: string, options: HealthOSErrorOptions = {}) {
    super(message, { ...options, category: "SCHEMA_VIOLATION" });
    this.name = "SchemaError";
  }
}

export class RenderError extends HealthOSError {
  constructor(message: string, options: HealthOSErrorOptions = {}) {
    super(message, { ...options, category: "RENDER_ERROR" });
    this.name = "RenderError";
  }
}

export class HealthClaimError extends HealthOSError {
  constructor(message: string, options: HealthOSErrorOptions = {}) {
    super(message, { ...options, category: "INVALID_HEALTH_CLAIM" });
    this.name = "HealthClaimError";
  }
}

export class OriginalityError extends HealthOSError {
  constructor(message: string, options: HealthOSErrorOptions = {}) {
    super(message, { ...options, category: "ORIGINALITY_REJECTED" });
    this.name = "OriginalityError";
  }
}

export function isHealthOSError(value: unknown): value is HealthOSError {
  return value instanceof HealthOSError;
}

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPROTO",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
]);

/**
 * Normalise an unknown throwable into a HealthOSError so that failures are
 * never silently dropped and always carry a category.
 */
export function normalizeError(
  error: unknown,
  context: { stage?: string; jobId?: string; videoId?: string } = {},
): HealthOSError {
  if (isHealthOSError(error)) {
    return error;
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    let category: ErrorCategory = "INTERNAL";
    if (code && NETWORK_CODES.has(code)) category = "NETWORK_ERROR";
    else if (code === "ETIMEDOUT" || error.name === "TimeoutError") category = "TIMEOUT";
    else if (code === "ENOENT") category = "STORAGE_ERROR";
    else if (code === "EACCES" || code === "EPERM") category = "STORAGE_ERROR";
    else if (code === "ERR_INVALID_ARG_TYPE" || code === "ERR_INVALID_ARG_VALUE")
      category = "INVALID_REQUEST";
    return new HealthOSError(error.message, { ...context, category, cause: error });
  }
  return new HealthOSError(String(error), { ...context, category: "INTERNAL" });
}
