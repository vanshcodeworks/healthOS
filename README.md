# healthOS

An autonomous studio for short-form health-science video. It discovers a topic,
gathers evidence, writes narration under evidence constraints, measures the
synthesised voice, builds a storyboard against that measurement, renders it as
deterministic motion design, and refuses to publish anything that fails a gate.

The output is a 1080×1920, 30fps, H.264/AAC vertical video with a spoken
narration track, burned-in captions, real figures and a full legal disclaimer.

---

## The one rule everything else follows

**The synthesised track is the authority on time.** Not the target, not the
script length, not the scene list.

Narration is synthesised first and measured. Scene windows are then allocated
from the measured speech duration, the lead-in, the tail and the internal
pauses — never the other way round. The video is the length the voice turned out
to be. Clip-fitting, time-stretching or speeding up audio to hit a number would
produce a video that hits a number and a voice nobody can follow, so those are
treated as bugs rather than features, and `audio.over_target` is reported as a
warning on every run that exceeds its target.

This is also why the pipeline is `PLAN → SYNTHESIZE → MEASURE → REBUILD →
VALIDATE → RENDER → FINAL VALIDATE` rather than the more usual plan-then-render:
the storyboard cannot honestly be written before the voice exists.

---

## Requirements

| Requirement | Why | Notes |
| --- | --- | --- |
| Node.js ≥ 22.13 | ESM, `node:test`-era APIs | `engines` in the root manifest |
| FFmpeg **and** ffprobe on `PATH` | segment encode, lossless concat, AAC mux, probe | `ffmpeg -version` must work |
| Playwright Chromium | the frame renderer *is* a headless browser | `npx playwright install chromium` |
| Windows + SAPI | default local narration, and the measured timing model | SAPI sentence pause is `1.389s`; a remote TTS provider needs its own measurement |
| SQLite | run state, source registry, manifests | created and migrated automatically |

Everything else — research providers, LLM providers, stock footage, publishing —
is optional. With an empty `.env` the studio still produces a complete local
video using deterministic offline research and local narration.

---

## Quick start

```bash
npm install
npx playwright install chromium
Copy-Item .env.example .env        # optional; defaults work

npm run build                      # compile all packages
npm run verify                     # build + typecheck + lint + full test suite
```

Rendering a real sample, end to end, with narration, frames and FFmpeg:

```bash
node temp/render-sample.mjs        # sample topic, renders to temp/sample-render/
```

Inspecting a render numerically — blank frames, margin overflow, focal
coverage — without trusting anyone's eyes, including the model's:

```bash
node temp/inspect-frames.mjs temp/sample-render/sample-caffeine/frames 4
```

---

## Commands

| Command | Does |
| --- | --- |
| `npm run build` | `tsc -b` across the emitting packages, with drift detection |
| `npm run typecheck` | whole-tree `--noEmit`, including tests and tooling |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm test` | full Vitest suite |
| `npm run test:unit` | unit tests only (fast) |
| `npm run test:integration` | integration and end-to-end tests (slow; needs SAPI, Chromium, FFmpeg) |
| `npm run verify` | the pre-publish gate: build → typecheck → lint → test, cheapest first |
| `npm run clean` | remove build output and caches |

`HEALTHOS_LIVE_SOURCES=1` opts into live citation verification, which needs the
network and is therefore excluded from `verify` so the gate cannot go flaky.

---

## Layout

```
packages/
  core          config, logging, database + migrations, errors, retry, paths
  schemas       strict Zod contracts shared by every stage
  research      topic discovery, evidence gathering, source registry
  script        narration written from reviewed claims, under evidence limits
  factcheck     claim verification, overclaim detection, safety gating
  storyboard    scene allocation against measured audio, visual policy
  audio         TTS providers, measured timing, mixing, loudness
  captions      forced alignment, styling, safe-region layout
  visuals       design system, motion engine, component library
  render        FFmpeg pipeline, browser engine, content-addressed cache
  qa            technical, visual, content, originality and rights gates
  assets        asset registry, providers, licensing audit trail
  analytics     metric normalisation, learning loop
  publishing    platform adapters and metadata agent
apps/
  orchestrator  durable job state machine, resumable pipeline
  renderer      the editorial HTML/CSS/SVG frame provider actually rendered
  cli           command line entry point (in progress)
  dashboard     local operational dashboard (in progress)
```

### How a frame is made

1. `apps/renderer` turns a scene into one HTML document: SVG components, headline,
   caption, legal footer, all in the editorial palette.
2. That document loads GSAP, builds a paused timeline, and the engine seeks it to
   an exact frame index. There is no wall-clock race, so frame 900 of a re-render
   is byte-identical to frame 900 of the previous run.
3. Frames are PNGs on disk, FFmpeg encodes per-scene segments, concatenates them
   losslessly, muxes the measured audio, and `ffprobe` verifies the result.
4. The render cache is content-addressed on the storyboard, the audio hash **and
   the engine version**, so changing the renderer invalidates it by construction.

Charts are drawn for the box they are given rather than scaled up afterwards, and
an illustration is never magnified past 1.6× — a 19px axis label blown up to 31px
is a different, worse design, not a bigger one.

---

## Content safety

This project publishes health-adjacent material, so the gates are not optional:

- Every claim carries its evidence and an evidence level.
- The overclaim detector refuses statements the evidence does not support.
- Safety gating blocks advice that should not be automated.
- Figures are only drawn when they exist in the source claim. A claim with no
  approved numbers gets a typographic treatment, never an invented chart.
- Content is for general information, not medical advice, and the full wording of
  the disclaimer is carried on the closing shot. It is never truncated to fit.
- A missing credential disables an integration; it never silently degrades a gate.

---

## Repository hygiene

- `.gitignore` excludes dependencies, build output, runtime state, rendered media
  and every real `.env`. `.env.example` is the committed template.
- `.gitattributes` normalises line endings to LF in the repository, so a Windows
  checkout does not produce whole-file diffs.
- CI runs on `windows-latest` because local narration and its measured timing
  depend on Windows SAPI.

### Known gaps

- `apps/cli` and `apps/dashboard` are declared but have no source yet; the root
  `bin` entry points at `apps/cli/bin/healthos.mjs`, which does not exist, so
  `npm run healthos`, `db:migrate` and `demo` do not run yet. Use `npm run
  verify` and the sample scripts until the CLI lands.
- The orchestrator is missing the `AUDIO_SYNTHESIZING`, `ASSETS_READY`,
  `PUBLISHED` and `FINAL_VALIDATION` states and typed failure classifications.
- `npm audit` reports 5 advisories in the **dev** toolchain (`vitest`, `vite`,
  `esbuild`, `vite-node`, `@vitest/mocker`). `npm audit --omit=dev` is clean:
  nothing shipped is affected. Upgrading the Vitest major is the fix.

---

## License

Unlicensed and private. All rights reserved.
