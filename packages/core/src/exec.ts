import { spawn, type SpawnOptions } from "node:child_process";
import { HealthOSError, normalizeError, type ErrorCategory } from "./errors.js";
import { PATHS } from "./paths.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  /** Bytes of stdout/stderr retained (defaults to 4 MiB, protecting memory). */
  maxBufferBytes?: number;
  input?: string;
  /** Reject if any argument fails validation. */
  allowedBinaries?: readonly string[];
  category?: ErrorCategory;
  onStdout?: (chunk: string) => void;
}

/**
 * Arguments may never be shell metacharacters. The system never builds a
 * command string out of LLM output, and even with array argv this guard
 * rejects the shapes that would be dangerous if the argv ever became a
 * shell string by accident.
 */
const DANGEROUS_ARG = /[;&|`$><\n\r]|\$\(|\|\||&&/;

export function assertSafeArgv(command: string, args: string[]): void {
  if (DANGEROUS_ARG.test(command)) {
    throw new HealthOSError(`Unsafe executable name: ${command}`, { category: "INVALID_REQUEST" });
  }
  for (const arg of args) {
    if (typeof arg !== "string" || arg.length > 8192) {
      throw new HealthOSError(`Unsafe argument length for ${command}`, { category: "INVALID_REQUEST" });
    }
    if (DANGEROUS_ARG.test(arg)) {
      throw new HealthOSError(`Unsafe argument for ${command}: ${JSON.stringify(arg.slice(0, 80))}`, {
        category: "INVALID_REQUEST",
        remediation: "Pass user data through a file (for example --metadata-file) instead of raw shell text.",
      });
    }
    if (arg.includes("\u0000")) {
      throw new HealthOSError("NUL byte in argument", { category: "INVALID_REQUEST" });
    }
  }
}

/**
 * Spawn a process without a shell. Every external tool the studio uses
 * (ffmpeg, ffprobe, Playwright, PowerShell SAPI) goes through here.
 */
export async function run(
  command: string,
  args: string[] = [],
  options: RunOptions = {},
): Promise<RunResult> {
  assertSafeArgv(command, args);
  if (options.allowedBinaries && !options.allowedBinaries.includes(command)) {
    throw new HealthOSError(`Binary not permitted: ${command}`, { category: "CONFIG_ERROR" });
  }
  const timeoutMs = options.timeoutMs ?? 600_000;
  const maxBufferBytes = options.maxBufferBytes ?? 4 * 1024 * 1024;
  const startedAt = Date.now();

  const spawnOptions: SpawnOptions = {
    cwd: options.cwd ?? PATHS.root,
    shell: false,
    windowsHide: true,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  };

  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, spawnOptions);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const append = (target: "out" | "err", chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      if (target === "out") {
        if (stdout.length < maxBufferBytes) stdout += text;
        options.onStdout?.(text);
      } else if (stderr.length < maxBufferBytes) {
        stderr += text;
      }
    };

    child.stdout?.on("data", (c: Buffer) => append("out", c));
    child.stderr?.on("data", (c: Buffer) => append("err", c));

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() =>
          reject(
            new HealthOSError(`${command} timed out after ${timeoutMs}ms`, {
              category: "TIMEOUT",
              details: { command, args: args.slice(0, 20), stderr: stderr.slice(-2000) },
              remediation: "Inspect the tool logs, then re-run the stage; the render cache avoids redoing work.",
            }),
          ),
        );
      }, timeoutMs);
    }

    child.on("error", (error) => {
      finish(() => reject(normalizeError(error, { stage: command })));
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startedAt;
      finish(() => {
        if (code === 0) {
          resolve({ code: 0, stdout, stderr, durationMs, command: `${command} ${args.join(" ")}`.trim() });
          return;
        }
        reject(
          new HealthOSError(`${command} exited with code ${code ?? "null"}`, {
            category: options.category ?? classifyToolFailure(stderr),
            details: {
              command,
              args: args.slice(0, 20),
              exitCode: code,
              stderr: stderr.slice(-4000),
              durationMs,
            },
            cause: new Error(stderr.slice(-1000) || `exit ${code}`),
          }),
        );
      });
    });

    if (options.input !== undefined) child.stdin?.end(options.input);
    else child.stdin?.end();
  });
}

function classifyToolFailure(stderr: string): ErrorCategory {
  if (/Invalid data found|no such file|moov atom not found|Invalid argument/i.test(stderr))
    return "RENDER_ERROR";
  if (/Connection|network|Temporary failure|resolve host/i.test(stderr)) return "NETWORK_ERROR";
  if (/Unauthorized|401|403|invalid credential|token/i.test(stderr)) return "INVALID_CREDENTIAL";
  return "INTERNAL";
}

export async function which(binary: string): Promise<string | null> {
  try {
    const result = await run(process.platform === "win32" ? "where" : "which", [binary], {
      timeoutMs: 15_000,
    });
    const first = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
    return first ? first.trim() : null;
  } catch {
    return null;
  }
}

export async function requireBinary(binary: string, hint: string): Promise<string> {
  const found = await which(binary);
  if (!found) {
    throw new HealthOSError(`Required tool not found on PATH: ${binary}`, {
      category: "CONFIG_ERROR",
      remediation: hint,
    });
  }
  return found;
}
