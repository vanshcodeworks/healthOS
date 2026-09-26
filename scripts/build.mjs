#!/usr/bin/env node
// Build every workspace project that emits JavaScript.
//
// The point of this script is the drift check, not the build. `tsc -b` will
// happily build exactly the projects it is told about, so a package added to the
// repo but forgotten in tsconfig.build.json is a package that never compiles and
// never fails. That is the worst possible failure mode for a build system, so it
// is checked explicitly and loudly.

import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Workspace directories that can contain a composite project. */
function workspaceDirs(kind) {
  const base = join(root, kind);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((name) => join(base, name))
    .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, "tsconfig.json")));
}

function declaredReferences() {
  const text = readFileSync(join(root, "tsconfig.build.json"), "utf8");
  // The file may carry comments, so it is stripped before parsing.
  const withoutComments = text.replace(/^\s*\/\/.*$/gm, "");
  const parsed = JSON.parse(withoutComments);
  return (parsed.references ?? []).map((r) => r.path.replace(/\\/g, "/"));
}

function onDisk() {
  return [...workspaceDirs("packages"), ...workspaceDirs("apps")].map((dir) =>
    dir.slice(root.length + 1).replace(/\\/g, "/"),
  );
}

const declared = new Set(declaredReferences());
const present = onDisk();
const missing = present.filter((p) => !declared.has(p));
const stale = [...declared].filter((p) => !present.includes(p));

if (missing.length > 0 || stale.length > 0) {
  console.error("tsconfig.build.json is out of date with the workspace.");
  for (const p of missing) console.error(`  missing reference: ${p} (tsconfig.json exists but is not built)`);
  for (const p of stale) console.error(`  stale reference:   ${p} (referenced but has no tsconfig.json)`);
  process.exit(1);
}

const started = Date.now();
try {
  const { stdout, stderr } = await run(
    process.execPath,
    [join(root, "node_modules", "typescript", "bin", "tsc"), "-b", join(root, "tsconfig.build.json"), "--pretty", "false"],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 },
  );
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
} catch (err) {
  console.error(String(err.stdout ?? "").trim());
  console.error(String(err.stderr ?? "").trim() || err.message);
  process.exit(err.code ?? 1);
}

console.log(`build ok: ${present.length} projects in ${((Date.now() - started) / 1000).toFixed(1)}s`);
