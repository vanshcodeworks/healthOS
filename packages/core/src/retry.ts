import { HealthOSError, normalizeError, type ErrorCategory } from "./errors.js";

export interface RetryPolicy {
  /** Total attempts, including the first. */
  maxAttempts: number;
  /** Delay before attempt 2. */
  baseDelayMs: number;
  /** Upper bound for the exponential delay. */
  maxDelayMs: number;
  /** Multiplier applied per attempt. */
  factor: number;
  /** Random fraction added to each delay to avoid thundering herds. */
  jitterRatio: number;
  /** Never wait longer than this for one attempt, regardless of category. */
  maxAttemptDurationMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 60_000,
  factor: 2,
  jitterRatio: 0.25,
  maxAttemptDurationMs: 900_000,
});

export const NO_RETRY_POLICY: RetryPolicy = Object.freeze({
  ...DEFAULT_RETRY_POLICY,
  maxAttempts: 1,
});

export function backoffDelay(attempt: number, policy: RetryPolicy, random = Math.random): number {
  const raw = policy.baseDelayMs * Math.pow(policy.factor, Math.max(0, attempt - 1));
  const capped = Math.min(raw, policy.maxDelayMs);
  const jitter = capped * policy.jitterRatio * random();
  return Math.round(capped + jitter);
}

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  policy?: RetryPolicy;
  onRetry?: (info: { attempt: number; delayMs: number; error: HealthOSError }) => void;
  sleep?: Sleep;
  /** Override the decision for an error category (e.g. force transient retry). */
  isRetryable?: (error: HealthOSError, attempt: number) => boolean;
  label?: string;
}

/**
 * Run `fn` with exponential backoff. Permanent error categories stop
 * immediately — the system never burns attempts on a failure that cannot
 * change without different input.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: HealthOSError | undefined;
  for (let attempt = 1; attempt <= Math.max(1, policy.maxAttempts); attempt++) {
    try {
      return await fn(attempt);
    } catch (raw) {
      const error = normalizeError(raw, { stage: options.label });
      lastError = error;
      const retryable = options.isRetryable ? options.isRetryable(error, attempt) : error.retryable;
      if (!retryable || attempt >= policy.maxAttempts) throw error;
      const delay = error.retryAfterMs ?? backoffDelay(attempt, policy);
      options.onRetry?.({ attempt, delayMs: delay, error });
      await sleep(delay);
    }
  }
  throw lastError ?? new HealthOSError("retry loop exhausted");
}

export interface CircuitState {
  failures: number;
  openedAt: number | null;
}

/**
 * Minimal circuit breaker. A permanently failing integration (for example a
 * platform whose token expired) is disabled after `threshold` consecutive
 * failures so one dead adapter cannot stall the whole batch.
 */
export class CircuitBreaker {
  private state: CircuitState = { failures: 0, openedAt: null };

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 60_000,
  ) {}

  get isOpen(): boolean {
    if (this.state.openedAt === null) return false;
    if (Date.now() - this.state.openedAt >= this.cooldownMs) {
      this.state.openedAt = null;
      this.state.failures = 0;
      return false;
    }
    return true;
  }

  success(): void {
    this.state = { failures: 0, openedAt: null };
  }

  failure(): void {
    this.state.failures += 1;
    if (this.state.failures >= this.threshold) this.state.openedAt = Date.now();
  }

  assertUsable(what: string): void {
    if (this.isOpen) {
      throw new HealthOSError(`${what} is temporarily disabled after repeated failures`, {
        category: "RATE_LIMIT",
        remediation: "Re-enable the integration once the upstream issue is resolved.",
      });
    }
  }
}

export function categorizeHttpStatus(status: number, body?: string): ErrorCategory {
  if (status === 401 || status === 403) return "INVALID_CREDENTIAL";
  if (status === 429) return "RATE_LIMIT";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 400 || status === 422) {
    if (body && /copyright|rights|ownership|restricted/i.test(body)) return "ASSET_RIGHTS";
    return "INVALID_REQUEST";
  }
  if (status === 404) return "INVALID_REQUEST";
  if (status >= 500) return "NETWORK_ERROR";
  return "INVALID_REQUEST";
}
