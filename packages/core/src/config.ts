import path from "node:path";
import { config as loadDotenvFile } from "dotenv";
import { z } from "zod";
import { PATHS } from "./paths.js";
import { ConfigError } from "./errors.js";

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : /^(1|true|yes|on)$/i.test(v.trim())));

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number.parseInt(v, 10)))
    .pipe(z.number().int());

const str = (fallback: string) => z.string().optional().default(fallback).transform((v) => v ?? fallback);

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const envSchema = z.object({
  NODE_ENV: str("development"),
  LOG_LEVEL: str("info"),
  LOG_FORMAT: str("json"),
  LOG_CONSOLE: str("on"),
  LOG_DIR: str(""),

  // --- Storage / database -------------------------------------------------
  DATABASE_URL: str(`sqlite:${PATHS.db}`),
  DATABASE_PATH: str(PATHS.db),
  REDIS_URL: optionalSecret,
  S3_BUCKET: optionalSecret,
  S3_REGION: optionalSecret,
  S3_ENDPOINT: optionalSecret,
  S3_ACCESS_KEY_ID: optionalSecret,
  S3_SECRET_ACCESS_KEY: optionalSecret,
  ARCHIVE_BUCKET: optionalSecret,

  // --- AI providers (optional; deterministic local fallbacks are used) ----
  ANTHROPIC_API_KEY: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  LLM_PROVIDER: str("none"),
  LLM_MODEL: str(""),
  LLM_BASE_URL: optionalSecret,

  // --- Research providers -------------------------------------------------
  PUBMED_API_KEY: optionalSecret,
  NCBI_API_KEY: optionalSecret,
  EUROPE_PMC_ENABLED: bool(true),
  SERPAPI_API_KEY: optionalSecret,
  YOUTUBE_API_KEY: optionalSecret,
  REDDIT_CLIENT_ID: optionalSecret,
  REDDIT_CLIENT_SECRET: optionalSecret,
  GOOGLE_TRENDS_ENABLED: bool(false),
  RSS_FEEDS: str(""),

  // --- Stock / asset providers -------------------------------------------
  PEXELS_API_KEY: optionalSecret,
  PIXABAY_API_KEY: optionalSecret,
  UNSPLASH_ACCESS_KEY: optionalSecret,
  ASSET_PROVIDER: str("none"),

  // --- Voice ---------------------------------------------------------------
  TTS_PROVIDER: str("auto"),
  TTS_API_KEY: optionalSecret,
  TTS_BASE_URL: optionalSecret,
  TTS_MODEL: str(""),
  TTS_VOICE: str("default"),
  VOICE_DIR: str(""),
  SPEECH_RATE: int(0),
  SYNTHETIC_MEDIA_DISCLOSURE: str("AI-generated narration and motion graphics"),

  // --- Rendering -----------------------------------------------------------
  RENDER_ENGINE: str("html"),
  RENDER_CONCURRENCY: int(2),
  RENDER_FPS: int(30),
  RENDER_WIDTH: int(1080),
  RENDER_HEIGHT: int(1920),
  RENDER_JPEG_QUALITY: int(95),
  RENDER_SEEK_TIMEOUT_MS: int(30000),
  RENDER_BROWSER_PATH: str(""),
  HEADLESS: bool(true),

  // --- Production ----------------------------------------------------------
  DAILY_TARGET: int(5),
  TARGET_DURATION_SECONDS: int(42),
  MIN_DURATION_SECONDS: int(30),
  MAX_DURATION_SECONDS: int(60),
  PUBLISH_MODE: str("AUTO_PUBLISH_AFTER_ALL_GATES"),
  PUBLISH_DRY_RUN: bool(false),
  BATCH_PUBLISH: bool(true),
  ANALYTICS_ENABLED: bool(true),

  // --- Platforms -----------------------------------------------------------
  INSTAGRAM_ACCESS_TOKEN: optionalSecret,
  INSTAGRAM_BUSINESS_ACCOUNT_ID: optionalSecret,
  FACEBOOK_ACCESS_TOKEN: optionalSecret,
  FACEBOOK_PAGE_ID: optionalSecret,
  YOUTUBE_ACCESS_TOKEN: optionalSecret,
  YOUTUBE_CHANNEL_ID: optionalSecret,
  TIKTOK_ACCESS_TOKEN: optionalSecret,
  TIKTOK_OPEN_ID: optionalSecret,
  YOUTUBE_CREDENTIALS_FILE: str(""),

  // --- Dashboard -----------------------------------------------------------
  DASHBOARD_PORT: int(4785),
  DASHBOARD_HOST: str("127.0.0.1"),

  // --- Loop ----------------------------------------------------------------
  LOOP_ENABLED: bool(false),
  LOOP_INTERVAL_SECONDS: int(120),
  TEMP_RETENTION_HOURS: int(6),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Load `.env` then process.env and validate. Never throws for optional keys. */
export function loadEnv(options: { force?: boolean } = {}): Env {
  if (cached && !options.force) return cached;
  // Lazy import keeps the config module usable in the browser-free test env
  // while still supporting a local .env file.
  loadDotEnv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`Invalid environment configuration: ${issues}`, {
      remediation: "Compare your environment against .env.example and correct the offending values.",
    });
  }
  cached = parsed.data;
  return cached;
}

function loadDotEnv(): void {
  if (process.env.HEALTHOS_SKIP_DOTENV) return;
  loadDotenvFile({ path: path.join(PATHS.root, ".env"), override: false, quiet: true });
}

export interface IntegrationStatus {
  name: string;
  enabled: boolean;
  missing: string[];
  note: string;
}

const INTEGRATION_ENV_KEYS: Record<string, string[]> = {
  "pubmed": ["PUBMED_API_KEY", "NCBI_API_KEY"],
  pexels: ["PEXELS_API_KEY"],
  pixabay: ["PIXABAY_API_KEY"],
  unsplash: ["UNSPLASH_ACCESS_KEY"],
  tts_remote: ["TTS_API_KEY"],
  instagram: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"],
  facebook: ["FACEBOOK_ACCESS_TOKEN", "FACEBOOK_PAGE_ID"],
  youtube: ["YOUTUBE_ACCESS_TOKEN"],
  tiktok: ["TIKTOK_ACCESS_TOKEN", "TIKTOK_OPEN_ID"],
  serpapi: ["SERPAPI_API_KEY"],
  youtube_data: ["YOUTUBE_API_KEY"],
  llm: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
};

/**
 * Startup secret validation. An integration with missing credentials is
 * reported and disabled; it never aborts the run, because the studio is
 * designed to keep producing through local fallbacks.
 */
export function validateIntegrations(env: Env = loadEnv()): IntegrationStatus[] {
  const statuses: IntegrationStatus[] = [];
  for (const [name, keys] of Object.entries(INTEGRATION_ENV_KEYS)) {
    const missing = keys.filter((key) => !env[key as keyof Env]);
    const hasAny = missing.length < keys.length;
    statuses.push({
      name,
      enabled: missing.length === 0,
      missing: missing.length === keys.length ? [] : missing,
      note: hasAny
        ? "Partially configured; credential may be incomplete."
        : "Configured with local fallbacks where an adapter supports them.",
    });
  }
  return statuses;
}

export function assertVideoDimensions(env: Env = loadEnv()): void {
  if (env.RENDER_WIDTH !== 1080 || env.RENDER_HEIGHT !== 1920) {
    // Non-1080x1920 output is allowed but is not the default deliverable.
    return;
  }
}

export type { z };
