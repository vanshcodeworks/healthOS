#!/usr/bin/env node
// The pre-publish gate: everything that must be true before this repo is trusted.
//
// Order matters and runs cheapest-first, so a type error does not cost a full
// test run. Each step is reported, and the first failure stops the run: a later
// stage's result is meaningless if an earlier one failed.
//
//   1. build      every package compiles
//   2. typecheck  the whole tree, including tests, which the build does not cover
//   3. lint       no floating promises, no `any` creeping through untyped JSON
//   4. test       the corpus survives research -> script -> factcheck -> storyboard
//
// Live citation verification is opt-in via HEALTHOS_LIVE_SOURCES=1 because it
// depends on the network and must not make this gate flaky.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Windows needs a shell to run .cmd shims like npx, but a shell also splits its
// command string on spaces. Node lives in "C:\Program Files\nodejs", so an
// unquoted path fails with "'C:\Program' is not recognized". Quote before handing
// anything to a shell.
const useShell = process.platform === "win32";
const shellQuote = (value) => (useShell && /\s/.test(value) ? `"${value}"` : value);

if (!existsSync(join(root, "tsconfig.build.json"))) {
  console.error("verify FAILED: tsconfig.build.json is missing.");
  process.exit(1);
}

/** Run a command, inheriting stdio, and resolve with its exit code. */
function exec(command, args, env = {}) {
  return new Promise((resolveExit) => {
    const child = spawn(shellQuote(command), args, {
      cwd: root,
      stdio: "inherit",
      shell: useShell,
      env: { ...process.env, ...env },
    });
    child.on("error", (err) => {
      console.error(`failed to start ${command}: ${err.message}`);
      resolveExit(1);
    });
    child.on("close", (code) => resolveExit(code ?? 1));
  });
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const STEPS = [
  {
    name: "build",
    run: () => exec(process.execPath, [join(root, "scripts", "build.mjs")]),
  },
  {
    name: "typecheck",
    // The build only covers the six emitting packages. This also checks tests and
    // tooling, which is where an unused import or a bad fixture hides.
    run: () => exec(npx, ["tsc", "-p", "tsconfig.json", "--noEmit", "--pretty", "false"]),
  },
  {
    name: "lint",
    run: () => exec(npx, ["eslint", ".", "--max-warnings", "0"]),
  },
  {
    name: "test",
    run: () => exec(npx, ["vitest", "run"]),
  },
];

// Skip steps whose tooling is not installed, rather than failing on a missing
// optional dev dependency.
function toolAvailable(binary, probeArgs) {
  return new Promise((resolveProbe) => {
    const child = spawn(shellQuote(binary), probeArgs, {
      cwd: root,
      stdio: "ignore",
      shell: useShell,
    });
    child.on("error", () => resolveProbe(false));
    child.on("close", (code) => resolveProbe(code === 0));
  });
}

const started = Date.now();
const results = [];
for (const step of STEPS) {
  if (step.name === "lint" && !(await toolAvailable(npx, ["eslint", "--version"]))) {
    console.log("--- lint: skipped (eslint not installed)\n");
    results.push({ name: "lint", status: "skipped" });
    continue;
  }
  console.log(`--- ${step.name} ---`);
  const code = await step.run();
  results.push({ name: step.name, status: code === 0 ? "ok" : "failed" });
  if (code !== 0) {
    console.error(`\nverify FAILED at step "${step.name}".`);
    report();
    process.exit(code);
  }
  console.log("");
}
report();

function report() {
  const failed = results.filter((r) => r.status === "failed");
  const skipped = results.filter((r) => r.status === "skipped").map((r) => r.name);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (failed.length === 0) {
    const note = skipped.length ? ` (skipped: ${skipped.join(", ")})` : "";
    console.log(`verify OK in ${seconds}s${note}`);
  }
}
