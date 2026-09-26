// Motion is generated as source text, and generated source text is not compiled
// by anything.
//
// A `pulse()` helper wrapped its selector argument in quotes while callers
// passed an expression containing a local variable, so the heart sample's
// `Heart` scene emitted:
//
//   tl.to('sel + ' [data-hf=beat]'', { ... }, 1);
//
// That is a syntax error. It took down the entire scene's boot script, so
// `window.__hfTimeline` was never created, so the renderer's per-frame seek
// quietly did nothing, so all 197 frames of that scene were the same still
// image. The video then passed ffprobe, passed the duration check, and passed
// final validation, because none of those checks look at whether anything moved.
//
// Two things are asserted here. Every component's motion must parse, which stops
// the malformed script reaching a browser at all. And the engine must refuse to
// capture a scene whose motion produced no timeline, which is the failure that
// actually reached disk.

import { describe, expect, it } from "vitest";
import { Script } from "node:vm";
import { COMPONENT_NAMES, HtmlFrameProvider, componentFor, paletteFor } from "@hc/renderer";
import type { RenderComponent, RenderProject, RenderScene } from "@hc/render";

const WIDTH = 1080;
const HEIGHT = 1920;

/** Params that exercise the parts of a component that emit the most source text. */
function paramsFor(name: string): Record<string, unknown> {
  if (/Chart|Bars/i.test(name)) {
    return {
      series: [
        { label: "240 ml cup", value: 95, unit: "mg" },
        { label: "60 ml espresso", value: 63, unit: "mg" },
      ],
    };
  }
  if (name === "LineChart") {
    return {
      points: [
        { x: 0, y: 95, label: "now" },
        { x: 1, y: 140, label: "30 min" },
        { x: 2, y: 121, label: "2 h" },
      ],
    };
  }
  if (name === "StatTile" || name === "KeyValueList") {
    return {
      tiles: [
        { value: "5 l/min", label: "at rest", note: "cardiac output" },
        { value: "2.5 l/day", label: "adequate intake" },
      ],
    };
  }
  return {};
}

function component(name: string): RenderComponent {
  return {
    component: name,
    label: "",
    emphasis: "focus",
    position: { x: 0, y: 0, scale: 1, rotate: 0 },
    params: paramsFor(name),
  };
}

function scene(over: Partial<RenderScene> = {}): RenderScene {
  return {
    scene_id: "sc_test",
    index: 0,
    start_s: 0,
    end_s: 4,
    duration_s: 4,
    intent: "explain",
    headline: "A headline that wraps onto two lines",
    subtext: "",
    components: [],
    layout: "center",
    ...over,
  };
}

function project(scenes: RenderScene[]): RenderProject {
  return {
    project_id: "p",
    video_id: "v",
    title: "Title",
    topic: "Topic",
    palette_id: "mechanism",
    template_id: "t",
    renderer_version: "test",
    video: { width: WIDTH, height: HEIGHT, fps: 30, crf: 18, videoBitrate: "8M", audioBitrate: "192k" },
    scenes,
    captions: [],
    caption_style: { style: "editorial", y: 0.78, max_lines: 2, max_words_per_line: 9, max_chars_per_line: 46 },
    audio: { path: "a.wav", duration_s: 4, hash: "h", sample_rate: 24000, channels: 1 },
    disclaimer: "General information, not medical advice.",
    cta: { enabled: false, kind: "follow", text: "" },
  };
}

const provider = new HtmlFrameProvider();

/**
 * Compiles the source without running it.
 *
 * `vm.Script` is the honest tool: it parses and compiles exactly as a browser
 * tag would and throws the same `SyntaxError`, but executes nothing. A snapshot
 * or a regex would only ever agree with a parser by luck.
 */
function syntaxErrorIn(source: string): string | null {
  try {
    new Script(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("generated motion is valid source text", () => {
  it("has a non-trivial set of components to check", () => {
    // A guard that silently checks nothing is worse than no guard.
    expect(COMPONENT_NAMES.length).toBeGreaterThan(20);
  });

  it.each(COMPONENT_NAMES)("emits a parseable boot script for %s", (name) => {
    const s = scene({ components: [component(name)] });
    const boot = provider.bootScript?.(project([s]), s) ?? "";
    expect(boot.length).toBeGreaterThan(0);
    expect(syntaxErrorIn(boot), `boot script for ${name}`).toBeNull();
  });

  it("emits a parseable boot script when several components share a scene", () => {
    // The failing case was one component among three, so a single-component scene
    // is not the only shape that has to be valid.
    const names = ["Heart", "Signal", "BloodVessel", "Muscle"];
    const s = scene({ components: names.map((n) => component(n)), layout: "full_bleed" });
    const boot = provider.bootScript?.(project([s]), s) ?? "";
    expect(syntaxErrorIn(boot), "boot script for a four-component scene").toBeNull();
  });

  it("gives every component a motion, so a scene is never a still by design", () => {
    const withoutMotion = COMPONENT_NAMES.filter(
      (name) => !componentFor(component(name), paletteFor("mechanism"), { w: 400, h: 300 }).motion,
    );
    expect(withoutMotion, `components with no motion: ${withoutMotion.join(", ")}`).toEqual([]);
  });
});
