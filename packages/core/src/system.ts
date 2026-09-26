import os from "node:os";
import fs from "node:fs";
import { PATHS } from "./paths.js";
import { listFilesRecursive, removeDir } from "./fsx.js";

/**
 * Lightweight resource measurement. The requirement is "measure CPU/RAM use",
 * not a full telemetry stack: per-render CPU time and peak RSS are enough to
 * find the real bottleneck.
 */
export interface ResourceSample {
  cpuUserMs: number;
  cpuSystemMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  sampledAt: string;
}

export function sampleResources(): ResourceSample {
  const usage = process.resourceUsage();
  const memory = process.memoryUsage();
  return {
    cpuUserMs: Math.round(usage.userCPUTime * 1000) / 1000,
    cpuSystemMs: Math.round(usage.systemCPUTime * 1000) / 1000,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    sampledAt: new Date().toISOString(),
  };
}

export function totalCpuMs(sample: ResourceSample): number {
  return Math.round((sample.cpuUserMs + sample.cpuSystemMs) * 100) / 100;
}

export function hostInfo(): {
  platform: string;
  cpus: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  loadAverage: number[];
  nodeVersion: string;
} {
  return {
    platform: `${os.type()} ${os.release()} (${process.platform}/${process.arch})`,
    cpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    loadAverage: os.loadavg(),
    nodeVersion: process.version,
  };
}

export interface StorageUsage {
  outputBytes: number;
  tempBytes: number;
  logsBytes: number;
  assetsBytes: number;
  databaseBytes: number;
  totalBytes: number;
}

function dirBytes(dir: string): number {
  try {
    let total = 0;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = `${current}/${entry.name}`;
        if (entry.isDirectory()) stack.push(full);
        else {
          try {
            total += fs.statSync(full).size;
          } catch {
            /* raced with cleanup */
          }
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export function storageUsage(): StorageUsage {
  const outputBytes = dirBytes(PATHS.output);
  const tempBytes = dirBytes(PATHS.temp);
  const logsBytes = dirBytes(PATHS.logs);
  const assetsBytes = dirBytes(PATHS.assets);
  let databaseBytes = 0;
  try {
    databaseBytes = fs.statSync(PATHS.db).size;
  } catch {
    databaseBytes = 0;
  }
  return {
    outputBytes,
    tempBytes,
    logsBytes,
    assetsBytes,
    databaseBytes,
    totalBytes: outputBytes + tempBytes + logsBytes + assetsBytes + databaseBytes,
  };
}

export interface CleanupResult {
  removedDirs: number;
  freedBytes: number;
  removedFiles: number;
}

/**
 * Delete render intermediates for videos that are not in flight, plus temp
 * files older than the retention window. Never touches `output/`.
 */
export async function cleanupTemp(options: {
  tempDir?: string;
  retentionHours?: number;
  protectDirs?: string[];
}): Promise<CleanupResult> {
  const tempDir = options.tempDir ?? PATHS.temp;
  const retentionMs = (options.retentionHours ?? 6) * 3600_000;
  const protect = new Set(options.protectDirs ?? []);
  const result: CleanupResult = { removedDirs: 0, freedBytes: 0, removedFiles: 0 };
  const cutoff = Date.now() - retentionMs;

  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(tempDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const full = `${tempDir}/${entry.name}`;
    if (protect.has(entry.name)) continue;
    try {
      const stat = await fs.promises.stat(full);
      if (stat.mtimeMs > cutoff) continue;
      if (entry.isDirectory()) {
        const files = await listFilesRecursive(full);
        for (const file of files) {
          try {
            result.freedBytes += (await fs.promises.stat(file)).size;
          } catch {
            /* ignore */
          }
        }
        await removeDir(full);
        result.removedDirs += 1;
        result.removedFiles += files.length;
      } else {
        result.freedBytes += stat.size;
        await fs.promises.rm(full, { force: true });
        result.removedFiles += 1;
      }
    } catch {
      /* file already gone */
    }
  }
  return result;
}
