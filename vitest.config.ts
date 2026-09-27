import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = (pkg: string, file = "src/index.ts") =>
  fileURLToPath(new URL(`./packages/${pkg}/${file}`, import.meta.url));

/** Apps live outside `packages/`, so they need their own resolver. */
const app = (name: string, file = "src/index.ts") =>
  fileURLToPath(new URL(`./apps/${name}/${file}`, import.meta.url));

/**
 * Subpath aliases for `@hc/remotion-app`, resolved to source.
 *
 * Without these, `@hc/remotion-app/measure` resolves through the package's
 * `exports` map to `dist/art/measure.js` — the last build — so the suite silently
 * tested yesterday's renderer. That is not hypothetical: the caption test below
 * asserted against the measured Inter advances and still saw the old heuristic's
 * `0.52em`, because the dist copy was a build older than the change under test.
 *
 * Aliases are matched in declaration order, so the two `art/` modules have to
 * precede the bare specifier: `@hc/remotion-app/measure` would otherwise be
 * rewritten to `src/measure`, which does not exist.
 */
const remotionSubpath = (subpath: string) => app("remotion-app", `src/${subpath}.ts`);

/** React components are `.tsx`; the aliases above resolve to source, not `dist`. */
const remotionComponent = (subpath: string) => app("remotion-app", `src/${subpath}.tsx`);

export default defineConfig({
  test: {
    // Tests import from package entry points rather than deep relative paths, so
    // a broken export surface fails the suite instead of passing on internals.
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The pipeline tests build storyboards and run citation audits for every
    // topic, which takes real work.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "logs/vitest-junit.xml" },
    pool: "forks",
  },
  resolve: {
    alias: {
      // Most specific first; see `remotionSubpath` for why the order matters.
      "@hc/remotion-app/measure": remotionSubpath("art/measure"),
      "@hc/remotion-app/typography": remotionSubpath("art/typography"),
      "@hc/remotion-app/editorial-text": remotionComponent("components/EditorialText"),
      "@hc/remotion-app/palette": remotionSubpath("art/palette"),
      "@hc/remotion-app/font-metrics": remotionSubpath("art/font-metrics"),
      "@hc/remotion-app/spacing": remotionSubpath("art/spacing"),
      "@hc/remotion-app/parts-row": remotionSubpath("art/parts-row"),
      "@hc/remotion-app/props": remotionSubpath("props"),
      "@hc/remotion-app": app("remotion-app"),
      "@hc/core": src("core"),
      "@hc/schemas": src("schemas"),
      "@hc/research": src("research"),
      "@hc/script": src("script"),
      "@hc/factcheck": src("factcheck"),
      "@hc/storyboard": src("storyboard"),
      "@hc/audio": src("audio"),
      "@hc/render": src("render"),
      "@hc/orchestrator": app("orchestrator"),
      "@hc/renderer": app("renderer"),
    },
  },
});

