// The focal point has to be where the layout says it is.
//
// Every one of these assertions exists because the frame was wrong in a way no
// duration check, schema check or timing check noticed: an organ drawn in a box
// three times its own size floated at a third of the intended size and a third
// of the way off centre; a comparison handed to a component that reads numbers
// rendered a zero; a caption rule struck through the last line of a headline.
// Geometry is only testable as geometry, so the tests parse the transform the
// provider actually emitted and check where the drawing lands.

import { describe, expect, it } from "vitest";
import { HtmlFrameProvider } from "@hc/renderer";
import { componentFor } from "@hc/renderer";
import { paletteFor } from "@hc/renderer";
import type { RenderComponent, RenderProject, RenderScene } from "@hc/render";

const WIDTH = 1080;
const HEIGHT = 1920;

function component(name: string, params: Record<string, unknown> = {}): RenderComponent {
  return {
    component: name,
    label: "",
    emphasis: "focus",
    position: { x: 0, y: 0, scale: 1, rotate: 0 },
    params,
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

/** The transform list GSAP-style: right to left, each function applied in turn. */
interface Placed {
  cx: number;
  cy: number;
  scale: number;
  /** The final half-extent translate, which is what centres the drawing. */
  ox: number;
  oy: number;
  width: number;
  height: number;
}

/**
 * Where each focal group lands.
 *
 * The emitted list is `translate(cx,cy) rotate(deg) scale(s) translate(-w/2,-h/2)`
 * and SVG applies it right to left. The last translate is the one that decides
 * whether the drawing is centred on (cx,cy) or hanging off to one side of it,
 * so it is read as well as asserted.
 */
function placedComponents(html: string): Placed[] {
  const out: Placed[] = [];
  const re = /<g data-hf="comp-(\d+)" transform="([^"]+)"/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const transform = m[2] ?? "";
    const nums = [...transform.matchAll(/-?\d+(?:\.\d+)?/g)].map((n) => Number(n[0]));
    const [cx, cy, , scale, ox, oy] = nums;
    if (nums.length < 6) continue;
    out.push({
      cx: cx ?? 0,
      cy: cy ?? 0,
      scale: scale ?? 1,
      ox: ox ?? 0,
      oy: oy ?? 0,
      width: 0,
      height: 0,
    });
  }
  return out;
}

/** Where the drawing's own box ends up, in frame coordinates. */
function drawnBox(html: string, index: number, visual: { extent: { w: number; h: number } }): Placed | null {
  const placed = placedComponents(html)[index];
  if (!placed) return null;
  return {
    ...placed,
    width: visual.extent.w * placed.scale,
    height: visual.extent.h * placed.scale,
  };
}

describe("editorial layout places the focal point", () => {
  it("centres a single focal point in the frame, not in a nominal box", () => {
    const visual = componentFor(component("Cell"), paletteFor("mechanism"));
    const s = scene({ components: [component("Cell")] });
    const html = new HtmlFrameProvider().html(project([s]), s);
    const box = drawnBox(html, 0, visual);
    expect(box).not.toBeNull();
    // The group is translated by half of the drawing's own extents, which is the
    // only thing that puts the drawing's centre on the frame's centre. A fixed
    // offset of a nominal box size leaves every focal point off to one side.
    expect(box!.ox).toBeCloseTo(-visual.extent.w / 2, 0);
    expect(box!.oy).toBeCloseTo(-visual.extent.h / 2, 0);
    // The drawing's own centre is the frame's centre.
    expect(box!.cx).toBeCloseTo(WIDTH / 2, 0);
    expect(box!.cy).toBeCloseTo(HEIGHT * 0.44, 0);
    // And it is drawn large enough to be the focal point, not a footnote.
    expect(box!.width).toBeGreaterThan(WIDTH * 0.18);
    expect(box!.height).toBeGreaterThan(HEIGHT * 0.12);
  });

  it("keeps every focal point inside the frame", () => {
    for (const name of ["Cell", "Brain", "Heart", "Lungs", "Molecule", "Counter", "BarChart"]) {
      const comps = [component(name)];
      const s = scene({ components: comps });
      const html = new HtmlFrameProvider().html(project([s]), s);
      const visual = componentFor(comps[0]!, paletteFor("mechanism"));
      const box = drawnBox(html, 0, visual);
      const left = box!.cx - box!.width / 2;
      const right = box!.cx + box!.width / 2;
      expect(left, `${name} runs off the left edge`).toBeGreaterThanOrEqual(0);
      expect(right, `${name} runs off the right edge`).toBeLessThanOrEqual(WIDTH);
      expect(box!.cy - box!.height / 2).toBeGreaterThanOrEqual(0);
      // Clear of the caption band at the bottom of the frame.
      expect(box!.cy + box!.height / 2).toBeLessThan(HEIGHT * 0.72);
    }
  });

  it("lays three components out as a row of three, not a block with a hole", () => {
    const comps = [component("Intestine"), component("BloodVessel"), component("Brain")];
    const s = scene({ components: comps, layout: "full_bleed" });
    const html = new HtmlFrameProvider().html(project([s]), s);
    const placed = placedComponents(html);
    expect(placed.length).toBe(3);
    const ys = placed.map((p) => Math.round(p.cy));
    expect(new Set(ys).size, "all three share one row").toBe(1);
    const xs = placed.map((p) => Math.round(p.cx));
    expect(new Set(xs).size, "and none is stacked on another").toBe(3);
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
  });

  it("gives a comparison's measure to its numbers", () => {
    const comps = [
      component("ComparisonBars", {
        series: [
          { label: "240 ml cup", value: 95, unit: "mg" },
          { label: "60 ml espresso", value: 63, unit: "mg" },
        ],
      }),
    ];
    const s = scene({ components: comps });
    const html = new HtmlFrameProvider().html(project([s]), s);
    // Both figures carry the unit, and both bases are named: a bar labelled
    // "63" over "60 ml espresso" is a riddle.
    expect(html).toContain("95");
    expect(html).toContain("63");
    expect(html).toContain("mg");
    expect(html).toContain("240 ml cup");
    expect(html).toContain("60 ml espresso");
  });

  it("draws a chart for the box it is given instead of scaling its type up", () => {
    const comp = component("ComparisonBars", {
      series: [
        { label: "240 ml cup", value: 95, unit: "mg" },
        { label: "60 ml espresso", value: 63, unit: "mg" },
      ],
    });
    const s = scene({ components: [comp] });
    const html = new HtmlFrameProvider().html(project([s]), s);
    // Drawn for the cell, so the fit scale is 1. A 1.6x magnification turned the
    // 19px axis labels into 31px ones that ran into each other and past the
    // left margin of the frame.
    const placed = placedComponents(html)[0];
    expect(placed?.scale).toBe(1);
    // And the labels keep their designed size rather than being blown up.
    const labelSizes = [...html.matchAll(/data-hf="fadeup"[^>]*font-size="(\d+(?:\.\d+)?)"/g)].map(
      (m) => Number(m[1]),
    );
    expect(labelSizes.length).toBeGreaterThan(0);
    for (const size of labelSizes) {
      expect(size).toBeLessThanOrEqual(27);
      expect(size).toBeGreaterThanOrEqual(19);
    }
  });

  it("never magnifies an illustration past a drawn, editorial scale", () => {
    // A 200x220 organ handed a 900x600 cell would be scaled 2.7x, which fattens
    // its strokes and breaks the hand-drawn look the art direction is going for.
    const s = scene({ components: [component("Cell")] });
    const html = new HtmlFrameProvider().html(project([s]), s);
    const placed = placedComponents(html)[0];
    expect(placed?.scale).toBeLessThanOrEqual(1.6);
    // The point of the cap: the drawing is still large enough to read.
    expect(placed?.scale).toBeGreaterThan(1);
  });

  it("never opens a shot on a blank frame", () => {
    const boot = new HtmlFrameProvider().bootScript?.(
      project([scene({ components: [component("Cell")] })]),
      scene({ components: [component("Cell")] }),
    );
    expect(boot).toBeDefined();
    // Type holds from t=0: an eager `from` fade renders its start state
    // immediately, which is how every shot used to open on empty paper.
    const headline = /tl\.from\('\[data-hf="headline"\]'[^\n]*/.exec(boot)?.[0] ?? "";
    expect(headline).toContain("immediateRender: false");
    const caption = /tl\.from\('\[data-hf="caption"\]'[^\n]*/.exec(boot)?.[0] ?? "";
    expect(caption).toContain("immediateRender: false");
  });

  it("keeps the legal footer outside the camera move and clear of the frame edge", () => {
    const s = scene({ index: 2, layout: "center", headline: "Closing" });
    const html = new HtmlFrameProvider().html(project([scene(), s, scene({ index: 1 })]), s);
    // Below the stage div, so the push cannot carry it off the bottom edge.
    const footerAt = html.indexOf('class="footer"');
    expect(footerAt).toBeGreaterThan(0);
    expect(footerAt).toBeGreaterThan(html.indexOf("</svg>"));
    // And it does not sit in the platform UI zone.
    expect(html).toMatch(/\.footer\{[^}]*bottom:\s*(9\d|1\d\d)px/);
  });
});
