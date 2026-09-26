import path from "node:path";
import { appendFileSync } from "node:fs";
import {
  pino,
  type DestinationStream,
  type Logger as PinoLogger,
} from "pino";
import { PATHS, ensureDir } from "./paths.js";
import { loadEnv } from "./config.js";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

export interface HealthLogger {
  readonly level: LogLevel;
  trace(fields: LogFields, message?: string): void;
  debug(fields: LogFields, message?: string): void;
  info(fields: LogFields, message?: string): void;
  warn(fields: LogFields, message?: string): void;
  error(fields: LogFields, message?: string): void;
  /** Structured pipeline-stage lifecycle event. */
  stage(fields: LogFields, message?: string): void;
  /** Quality-gate decision event. */
  gate(fields: LogFields, message?: string): void;
  child(bindings: LogFields): HealthLogger;
}

class PinoHealthLogger implements HealthLogger {
  readonly level: LogLevel;

  constructor(private readonly inner: PinoLogger, level: LogLevel) {
    this.level = level;
  }

  trace(fields: LogFields, message?: string): void {
    this.inner.trace(fields, message);
  }

  debug(fields: LogFields, message?: string): void {
    this.inner.debug(fields, message);
  }

  info(fields: LogFields, message?: string): void {
    this.inner.info(fields, message);
  }

  warn(fields: LogFields, message?: string): void {
    this.inner.warn(fields, message);
  }

  error(fields: LogFields, message?: string): void {
    this.inner.error(fields, message);
  }

  stage(fields: LogFields, message?: string): void {
    this.inner.info({ ...fields, event: "stage" }, message);
  }

  gate(fields: LogFields, message?: string): void {
    this.inner.info({ ...fields, event: "gate" }, message);
  }

  child(bindings: LogFields): HealthLogger {
    return new PinoHealthLogger(this.inner.child(bindings), this.level);
  }
}

const LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error"];

function parseLevel(value: string): LogLevel {
  return (LEVELS as string[]).includes(value) ? (value as LogLevel) : "info";
}

let root: HealthLogger | undefined;

function build(): HealthLogger {
  const env = loadEnv();
  const level = parseLevel(env.LOG_LEVEL);
  const logDir = env.LOG_DIR ? path.resolve(env.LOG_DIR) : path.join(PATHS.logs, "healthos");
  ensureDir(logDir);
  const day = new Date().toISOString().slice(0, 10);
  const filePath = path.join(logDir, `healthos-${day}.jsonl`);

  // Two sinks from one logger: human-readable stderr for operators and
  // newline-delimited JSON on disk for machine analysis. Machine parsing only
  // ever reads the file, so the console format may change freely.
  const tee: DestinationStream = {
    write(chunk: string) {
      if (env.LOG_CONSOLE !== "off") process.stderr.write(chunk);
      pending += chunk;
      if (pending.length > 65_536) flushPending();
    },
  };
  let pending = "";
  const flushPending = (): void => {
    if (pending.length === 0) return;
    try {
      appendFileSync(filePath, pending, "utf8");
    } catch {
      /* logging must never take down a render */
    }
    pending = "";
  };
  process.on("exit", flushPending);

  const inner = pino(
    {
      level,
      base: { service: "health-content-os", pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: {
        paths: [
          "headers.authorization",
          "token",
          "*.accessToken",
          "*.access_token",
          "*.apiKey",
          "*.api_key",
          "*.clientSecret",
          "*.client_secret",
          "*.password",
        ],
        censor: "[redacted]",
      },
    },
    tee,
  );

  return new PinoHealthLogger(inner, level);
}

export function getLogger(): HealthLogger {
  if (!root) root = build();
  return root;
}

export function setLogger(logger: HealthLogger): void {
  root = logger;
}

export interface StageLogInfo {
  stage: string;
  jobId?: string;
  videoId?: string;
  meta?: LogFields;
}

/**
 * Emit exactly one structured start/finish pair per pipeline stage so the
 * dashboard can show per-stage cost and failure rate without extra metrics
 * plumbing.
 */
export async function withStageLog<T>(info: StageLogInfo, fn: () => Promise<T>): Promise<T> {
  const log = getLogger();
  const startedAt = Date.now();
  log.stage({ ...info.meta, stage: info.stage, jobId: info.jobId, videoId: info.videoId, phase: "start" });
  try {
    const result = await fn();
    log.stage({
      stage: info.stage,
      jobId: info.jobId,
      videoId: info.videoId,
      phase: "ok",
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    log.stage(
      {
        stage: info.stage,
        jobId: info.jobId,
        videoId: info.videoId,
        phase: "error",
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      },
      "stage failed",
    );
    throw error;
  }
}
