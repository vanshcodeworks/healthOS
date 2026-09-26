#!/usr/bin/env node
// Remove build output.
//
// Only paths that resolve inside the workspace are ever deleted. A clean script
// that can be talked into removing the wrong directory is not a clean script, it
// is a hazard, so every candidate is checked against the workspace root and
// against a literal allowlist of names before it is touched.

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve, dirname, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Only these directory names are ever removed, whatever their parent. */
const ALLOWED_DIR_NAMES = new Set(["dist", "output", ".vite"]);

/** Workspace kinds whose member directories can hold a dist/ to remove. */
const WORKSPACE_KINDS = ["packages", "apps"];

function isInsideWorkspace(target) {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

/**
 * Delete one directory after proving it is both inside the workspace and named
 * something this script is allowed to delete.
 */
function safeRemoveDir(absTarget, label) {
  const abs = resolve(absTarget);
  if (!isInsideWorkspace(abs)) {
    console.error(`refusing to remove ${abs}: outside the workspace`);
    return false;
  }
  if (!ALLOWED_DIR_NAMES.has(basename(abs))) {
    console.error(`refusing to remove ${abs}: not an allowlisted build directory`);
    return false;
  }
  rmSync(abs, { recursive: true, force: true });
  console.log(`removed ${label}: ${relative(root, abs)}`);
  return true;
}

let removed = 0;

/** Every directory that could hold a package's build output. */
function candidateParents() {
  const parents = [{ dir: root, label: "root dist" }];
  for (const kind of WORKSPACE_KINDS) {
    const base = join(root, kind);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const dir = join(base, entry);
      try {
        if (statSync(dir).isDirectory()) parents.push({ dir, label: `${kind} dist` });
      } catch {
        continue;
      }
    }
  }
  return parents;
}

for (const { dir, label } of candidateParents()) {
  const candidate = join(dir, "dist");
  if (!existsSync(candidate)) continue;
  if (safeRemoveDir(candidate, label)) removed++;
}

/**
 * tsbuildinfo files record what TypeScript considers already built. Leaving them
 * behind makes the next build skip work it should redo, so they go too.
 */
let infoCount = 0;
function sweep(dir, depth = 0) {
  if (depth > 3 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "data") continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      sweep(full, depth + 1);
      continue;
    }
    if (entry.endsWith(".tsbuildinfo") && isInsideWorkspace(full)) {
      rmSync(full, { force: true });
      infoCount++;
    }
  }
}
sweep(root);

console.log(`clean ok: ${removed} dist director${removed === 1 ? "y" : "ies"}, ${infoCount} tsbuildinfo file(s)`);
