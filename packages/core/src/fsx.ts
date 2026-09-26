import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { HealthOSError } from "./errors.js";
import { assertSafeSegment, ensureDir, safeJoin } from "./paths.js";

export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
export const MAX_ASSET_BYTES = 64 * 1024 * 1024;

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirAsync(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function readJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(file, "utf8");
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new HealthOSError(`Malformed JSON in ${file}`, {
      category: "STORAGE_ERROR",
      details: { file, cause: String(error) },
    });
  }
}

export async function writeJsonAtomic(file: string, value: unknown, pretty = true): Promise<void> {
  await ensureDirAsync(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, pretty ? 2 : 0), "utf8");
  await fs.rename(tmp, file);
}

export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await ensureDirAsync(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

export async function fileSize(file: string): Promise<number> {
  const stat = await fs.stat(file);
  return stat.size;
}

export async function assertFileSize(file: string, maxBytes = MAX_UPLOAD_BYTES): Promise<number> {
  const size = await fileSize(file);
  if (size > maxBytes) {
    throw new HealthOSError(`File exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit: ${path.basename(file)}`, {
      category: "INVALID_REQUEST",
      details: { file, size, maxBytes },
      remediation: "Lower the render quality or shorten the video.",
    });
  }
  return size;
}

export async function assertNotEmpty(file: string, what: string): Promise<number> {
  const size = await fileSize(file);
  if (size === 0) {
    throw new HealthOSError(`${what} is empty: ${path.basename(file)}`, {
      category: "STORAGE_ERROR",
      details: { file },
      remediation: "Re-run the producing stage; do not publish a zero-byte artefact.",
    });
  }
  return size;
}

export async function copyIntoRoot(root: string, id: string, ext: string, data: Uint8Array | string): Promise<string> {
  const target = safeJoin(root, `${assertSafeSegment(id, "asset id")}${ext}`);
  await ensureDirAsync(path.dirname(target));
  await writeFileAtomic(target, data);
  return target;
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  const buffer = await fs.readFile(file);
  hash.update(buffer);
  return hash.digest("hex");
}

export async function listFilesRecursive(dir: string, filter?: RegExp): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(full, filter)));
    } else if (!filter || filter.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export async function dirSize(dir: string): Promise<number> {
  const files = await listFilesRecursive(dir);
  let total = 0;
  for (const file of files) {
    try {
      total += await fileSize(file);
    } catch {
      /* file vanished during scan */
    }
  }
  return total;
}

export async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

export function ensureDirSync(dir: string): string {
  return ensureDir(dir);
}
