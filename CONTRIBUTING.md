# Contributing

## Setup

```bash
npm install
npx playwright install chromium
Copy-Item .env.example .env
npm run build
npm run verify
```

`npm run verify` is the gate: build → typecheck → lint → test, cheapest first,
stopping at the first failure. Run it before you push.

The full suite includes an end-to-end render that talks to Windows SAPI,
Chromium and FFmpeg and takes several minutes. `npm run test:unit` is the fast
loop; `npm run test:integration` is the one that catches pipeline and renderer
regressions.

## Conventions this repo actually follows

**A test earns its place by naming the bug it prevents.** The assertions in
`tests/unit/renderer-layout.test.ts` exist because the rendered frame was wrong
in a way no duration check, schema check or timing check noticed — an organ
drawn into a box three times its own size, a comparison handed to a component
that reads numbers rendering a zero, a legal footer pushed off the bottom edge
by a camera move. When you fix a rendering or timing defect, add the assertion
that would have caught it, and say in a comment what the frame looked like
before. A test with no story behind it is a maintenance cost.

**Comments explain why, not what.** The codebase is dense with comments that
record a decision and its cost, because a surprising line of code is nearly
always a scar from a bug. Do not narrate the line above it.

**Comments are written, never generated.** No comments in this repository are
emitted by an AI assistant, in source or in tests. This is an explicit condition
of the project.

**Measured beats estimated.** If a value can be measured from the real artefact
— audio duration, frame count, `ffprobe` output — measure it. Fallbacks exist for
offline runs, not as a shortcut.

## Style

- TypeScript, strict, ESM. No `any` in a signature; unknown JSON is parsed through
  a Zod schema or narrowed explicitly.
- Two-space indent, LF endings, double quotes, trailing semicolons.
- ESLint runs with `--max-warnings 0`. If the rule is wrong, change the rule in
  `eslint.config.js` deliberately, not with an inline disable.
- `dist/` is build output and is never edited or committed. Fix the source.

## Commits and branches

- Branch from `main` with a short descriptive name.
- Keep a commit to one concern; a renderer fix and a schema change are two
  commits.
- Describe the change in terms of what the viewer or operator now gets, and name
  the failure it prevents.
