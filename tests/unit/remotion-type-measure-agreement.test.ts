// The weight a fitter measures is the weight the frame paints.
//
// Every layout bug in this project has been one of two things: a measure that did
// not match the render. The caption band measured Inter 500 against a table that
// held Inter 400's advances and painted 1019px of text into a 948px column. The
// headline mask hid its own seam by a third of an em and made consecutive lines of
// a display serif collide. The part-row fitter charged a word space for a 44px gap
// and put a six-part row 154px past the column.
//
// This guards the remaining seam, between `TYPE` — the scale a frame is set in —
// and `TYPE_MEASURE` — what `art/measure.ts` fits against. Those were two
// hand-written tables, so a change to one did not reach the other: `TYPE_MEASURE`
// held `weight: 500` as a literal while the renderers set no `fontWeight` at all and
// inherited the initial 400, leaving the headline fitted against Fraunces 500 and
// painted in Fraunces 400, about 5% narrower per glyph than the fit assumed.
//
// The assertions are structural rather than numeric. Numbers here would go stale
// the next time a size changes; what must never change is that every weight asked
// for is one the calibration measured, the loader loads, and the scale agrees with.

import { describe, expect, it } from "vitest";
import { TYPE, TYPE_MEASURE } from "@hc/remotion-app/typography";
import { FONT_METRICS } from "@hc/remotion-app/font-metrics";

/** Weights `art/fonts.ts` loads, keyed by the metric family each role paints in. */
const LOADED: Record<string, number[]> = {
  display: [500, 600, 700],
  eyebrow: [500, 700],
  text: [400, 500, 600, 700],
  mono: [400, 500, 600],
};

/**
 * Every entry in the scale, with the family it paints in. Written out rather than
 * inferred from the font family string, so a role added to `TYPE` without a row here
 * fails the test instead of quietly escaping it.
 */
const SCALE: { key: keyof typeof TYPE; family: keyof typeof FONT_METRICS }[] = [
  { key: "eyebrow", family: "eyebrow" },
  { key: "headline", family: "display" },
  { key: "headlineSmall", family: "display" },
  { key: "deck", family: "text" },
  { key: "label", family: "text" },
  { key: "annotation", family: "text" },
  { key: "unit", family: "text" },
  { key: "stat", family: "display" },
  { key: "statSmall", family: "display" },
  { key: "figure", family: "mono" },
  { key: "caption", family: "text" },
  { key: "disclaimer", family: "text" },
  { key: "source", family: "mono" },
  { key: "spoken", family: "display" },
];

/** Which scale entry each measured role is derived from. */
const ROLES = [
  { role: "display", family: "display", scale: "headline" },
  { role: "displayTight", family: "display", scale: "headlineSmall" },
  { role: "eyebrow", family: "eyebrow", scale: "eyebrow" },
  { role: "text", family: "text", scale: "deck" },
  { role: "textStrong", family: "text", scale: "caption" },
  { role: "mono", family: "mono", scale: "figure" },
] as const;

describe("type scale and type measure agree", () => {
  it("covers every entry in the scale", () => {
    expect(SCALE.map((s) => s.key).sort()).toEqual(Object.keys(TYPE).sort());
  });

  it("derives every measured role from the scale entry it paints in", () => {
    for (const { role, scale } of ROLES) {
      const measured = TYPE_MEASURE[role];
      const painted = TYPE[scale];
      expect(measured.weight, `${role} weight vs TYPE.${scale}.fontWeight`).toBe(painted.fontWeight);
      expect(measured.letterSpacing, `${role} tracking vs TYPE.${scale}.letterSpacing`).toBe(painted.letterSpacing);
    }
  });

  it("only ever asks for a weight the calibration actually measured", () => {
    for (const { role, family } of ROLES) {
      const calibrated = Object.keys(FONT_METRICS[family].weights);
      expect(calibrated, `${role} weight ${TYPE_MEASURE[role].weight} has no calibrated table`).toContain(
        String(TYPE_MEASURE[role].weight),
      );
    }
  });

  it("only ever asks for a weight the font loader loads", () => {
    // A weight CSS cannot match renders at whatever the browser picks as nearest,
    // which is how a scale ends up painting a different face than the measure read.
    for (const { key, family } of SCALE) {
      const weight = TYPE[key].fontWeight;
      expect(LOADED[family], `TYPE.${key} asks for ${weight}, which fonts.ts does not load`).toContain(weight);
    }
  });
});
