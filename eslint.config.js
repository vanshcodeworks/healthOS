// Flat ESLint config.
//
// The rule set is deliberately small. TypeScript already checks types, so the
// value here is catching the classes of bug a type checker cannot see: floating
// promises, unhandled rejections, and `any` creeping in through untyped JSON.
// Anything stylistic is left to the formatter.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "data/**",
      "output/**",
      "logs/**",
      "temp/**",
      "**/*.tsbuildinfo",
      // Installed agent skills are third-party source dropped into the tree, not
      // code this project owns: they are not in any tsconfig, they carry their own
      // conventions, and linting them produced dozens of parsing errors about files
      // the project service had never heard of. Vendored code is not this repo's
      // code to fix.
      ".agents/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        // Root tooling is covered by the root tsconfig via allowJs, so the
        // project service resolves it without a hand-maintained allowlist.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An unhandled rejection in a batch pipeline means a video silently never
      // gets made, so these are errors rather than warnings.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-console": "off",

      // `any` is how untrusted JSON quietly defeats the type system. Parsed
      // payloads must be validated at the boundary, not asserted away.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
          // An inline `import("./x.js").T` annotation is the correct way to
          // reference a type without adding a runtime import or a cycle, so it
          // is not treated as a violation.
          disallowTypeAnnotations: false,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    // Config and tooling scripts run under Node but are plain ESM JavaScript,
    // outside any TypeScript project.
    files: ["scripts/**/*.mjs", "*.config.{js,mjs,ts}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // The font calibration runs in Node but its measuring step is a function
    // handed to `page.evaluate`, which is serialised and executed inside the
    // browser. Those callbacks legitimately use `document`, and Node's globals
    // do not include it, so this file is linted with both sets.
    files: ["scripts/calibrate-font-metrics.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["tests/**/*.ts", "temp/**/*.ts"],
    rules: {
      // Tests legitimately reach into internals and use loose fixtures.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
);
