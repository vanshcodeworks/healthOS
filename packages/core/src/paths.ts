import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { HealthOSError } from "./errors.js";

/**
 * Repository layout. Everything is resolved from this file's location so the
 * CLI works regardless of the caller's working directory.
 */
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "packages"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

function fromRoot(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

export const PATHS = {
  root: REPO_ROOT,
  packages: fromRoot("packages"),
  apps: fromRoot("apps"),
  templates: fromRoot("templates"),
  assets: fromRoot("assets"),
  assetsFonts: fromRoot("assets", "fonts"),
  assetsSfx: fromRoot("assets", "sfx"),
  assetsStock: fromRoot("assets", "stock"),
  data: fromRoot("data"),
  dataTopics: fromRoot("data", "topics"),
  dataSources: fromRoot("data", "sources"),
  dataManifests: fromRoot("data", "manifests"),
  dataSeeds: fromRoot("data", "seeds"),
  db: fromRoot("data", "healthos.db"),
  output: fromRoot("output"),
  temp: fromRoot("temp"),
  logs: fromRoot("logs"),
  docs: fromRoot("docs"),
  tests: fromRoot("tests"),
} as const;

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureParent(file: string): string {
  ensureDir(path.dirname(file));
  return file;
}

export const videoDir = (videoId: string): string => path.join(PATHS.output, videoId);
export const videoTempDir = (videoId: string): string => path.join(PATHS.temp, videoId);
export const videoRenderDir = (videoId: string): string => path.join(videoDir(videoId), "render");
export const videoAudioDir = (videoId: string): string => path.join(videoDir(videoId), "audio");
export const videoFramesDir = (videoId: string): string => path.join(videoDir(videoId), "frames");
export const videoThumbDir = (videoId: string): string => path.join(videoDir(videoId), "thumbs");
export const manifestPath = (videoId: string): string => path.join(videoDir(videoId), "manifest.json");

/**
 * Reject any path that escapes its declared root. Used for every externally
 * influenced path (asset ids, video ids, cache keys).
 */
export function safeJoin(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const withSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (target !== resolvedRoot && !target.startsWith(withSep)) {
    throw new HealthOSError(`Path escapes its permitted root: ${segments.join("/")}`, {
      category: "INVALID_REQUEST",
      remediation: "Sanitise the identifier before using it as a path segment.",
    });
  }
  return target;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,120}$/;

export function assertSafeSegment(segment: string, what = "identifier"): string {
  if (!SAFE_SEGMENT.test(segment) || segment === "." || segment === "..") {
    throw new HealthOSError(`Unsafe ${what}: ${JSON.stringify(segment)}`, {
      category: "INVALID_REQUEST",
      remediation: `Use only [A-Za-z0-9._-] in ${what} values.`,
    });
  }
  return segment;
}

export const slugify = (input: string, maxLength = 60): string =>
  input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "") || "untitled";
