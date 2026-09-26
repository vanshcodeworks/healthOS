// A dependency that is used but not declared still works in a workspace, because
// npm hoists it to the root node_modules and every package resolves it from
// there. It breaks the moment the hoisting changes: a different install order, a
// pruned install, or someone consuming one package on its own.
//
// `@hc/core` imported zod this way for the whole project. Nothing failed, so
// nothing was reported. This test fails instead.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WORKSPACE_DIRS = ["packages", "apps"];

interface Pkg {
  dir: string;
  name: string;
  deps: Set<string>;
  devDeps: Set<string>;
  files: string[];
}

/** Every `packages/*` and `apps/*` directory that has a package.json. */
function workspacePackages(): Pkg[] {
  const out: Pkg[] = [];
  for (const group of WORKSPACE_DIRS) {
    for (const name of readdirSync(join(ROOT, group))) {
      const dir = join(group, name);
      if (!statSync(join(ROOT, dir)).isDirectory()) continue;
      const manifestPath = join(ROOT, dir, "package.json");
      let manifest: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch {
        continue;
      }
      if (!manifest.name) continue;
      const srcDir = join(ROOT, dir, "src");
      let files: string[] = [];
      try {
        files = readdirSync(srcDir, { recursive: true })
          .map(String)
          .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
      } catch {
        files = [];
      }
      out.push({
        dir,
        name: manifest.name,
        deps: new Set(Object.keys(manifest.dependencies ?? {})),
        devDeps: new Set(Object.keys(manifest.devDependencies ?? {})),
        files,
      });
    }
  }
  return out;
}

const packages = workspacePackages();
const byName = new Map(packages.map((p) => [p.name, p]));

/** Bare module specifiers imported by a file, excluding relative and node builtins. */
function importsOf(relPath: string): string[] {
  const source = readFileSync(join(ROOT, relPath), "utf8");
  const specifiers = new Set<string>();
  const patterns = [
    /\bfrom\s+"([^"]+)"/g,
    /\bimport\s+"([^"]+)"/g,
    /\bimport\s*\(\s*"([^"]+)"\s*\)/g,
    /\brequire\s*\(\s*"([^"]+)"\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (!spec) continue;
      if (spec.startsWith(".") || spec.startsWith("/")) continue;
      if (spec.startsWith("node:")) continue;
      // Take the package name out of a subpath import.
      specifiers.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] ?? spec));
    }
  }
  return [...specifiers];
}

describe("workspace dependencies are declared, not hoisted by accident", () => {
  it("finds the workspace packages", () => {
    expect(packages.length).toBeGreaterThan(10);
  });

  it("declares every external module it imports", () => {
    const undeclared: string[] = [];
    for (const pkg of packages) {
      for (const file of pkg.files) {
        for (const spec of importsOf(join(pkg.dir, "src", file))) {
          if (spec.startsWith("node:")) continue;
          if (!pkg.deps.has(spec) && !pkg.devDeps.has(spec)) {
            undeclared.push(`${pkg.name} imports "${spec}" in ${file} but does not declare it`);
          }
        }
      }
    }
    expect(undeclared, undeclared.join("\n")).toEqual([]);
  });

  it("imports internal packages that actually exist in the workspace", () => {
    // A typo'd or renamed workspace dependency would otherwise resolve to
    // nothing and fail only at runtime.
    const missing: string[] = [];
    for (const pkg of packages) {
      for (const file of pkg.files) {
        for (const spec of importsOf(join(pkg.dir, "src", file))) {
          if (spec.startsWith("@hc/") && !byName.has(spec)) {
            missing.push(`${pkg.name} imports "${spec}" in ${file}, which is not a workspace package`);
          }
        }
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("declares only workspace packages as internal dependencies", () => {
    // The mirror image: a declared internal dependency that nothing provides is
    // a stale entry left behind by a rename.
    const stale: string[] = [];
    for (const pkg of packages) {
      for (const dep of pkg.deps) {
        if (dep.startsWith("@hc/") && !byName.has(dep)) {
          stale.push(`${pkg.name} declares "${dep}", which is not a workspace package`);
        }
      }
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });

  it("pins internal dependencies to a concrete version", () => {
    // "*" happens to resolve locally, but it also accepts an unrelated published
    // package of the same name, which is a supply-chain foot-gun.
    const loose: string[] = [];
    for (const pkg of packages) {
      const manifest = JSON.parse(readFileSync(join(ROOT, pkg.dir, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      for (const dep of [...pkg.deps].filter((d) => d.startsWith("@hc/"))) {
        const range = manifest.dependencies?.[dep] ?? "";
        if (!/^\d+\.\d+\.\d+/.test(range)) {
          loose.push(`${pkg.name} depends on "${dep}@${range}", which is not a concrete version`);
        }
      }
    }
    expect(loose, loose.join("\n")).toEqual([]);
  });
});
