import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = (pkg: string, file = "src/index.ts") =>
  fileURLToPath(new URL(`./packages/${pkg}/${file}`, import.meta.url));

/** Apps live outside `packages/`, so they need their own resolver. */
const app = (name: string, file = "src/index.ts") =>
  fileURLToPath(new URL(`./apps/${name}/${file}`, import.meta.url));

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
