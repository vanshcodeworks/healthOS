// A fitted element has to set the weight it was fitted against.
//
// `TYPE_MEASURE` decides how wide the fitter believes a string is, and the
// `fontWeight` on the element decides how wide it actually is. When the two
// disagree the frame is wrong in a way no geometric check catches: the block still
// fits, it is just painted in a different face than the fit assumed, so it stops
// short of the column it was measured to fill.
//
// That is what happened. `Headline`, `Deck`, `SpokenWord` and the `BigStat` figure
// all measured against a weight and set none, taking the inherited initial 400 while
// the measure used Fraunces 500 — about 5% narrower per glyph. The headline and the
// big number are the two elements whose whole job is to fill a measured width, so
// the disagreement was most visible exactly where it mattered most.
//
// This renders the components to static markup and reads the weight back out of the
// emitted style, so the assertion is on what the frame would actually paint rather
// than on what the source appears to say.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Headline, Deck, SpokenWord } from "@hc/remotion-app/editorial-text";
import { TYPE, TYPE_MEASURE } from "@hc/remotion-app/typography";
import type { Palette } from "@hc/remotion-app/palette";

const PALETTE = { ink: "#111111", inkMuted: "#555555", accent: "#cc3300", line: "#dddddd", bg: "#ffffff" } as unknown as Palette;

/** Mid-reveal, so nothing is still hidden by an `e <= 0` early return. */
const FRAME = 90;
const FPS = 30;

/** The first `font-weight` the markup emits, in px-independent form. */
function paintedWeight(markup: string): number {
  const match = /font-weight:\s*([\d.]+)/.exec(markup);
  if (!match) throw new Error(`no font-weight in markup: ${markup.slice(0, 400)}`);
  return Number(match[1]);
}

describe("editorial type paints the weight it was fitted against", () => {
  it("Headline sets the display weight the fitter measured", () => {
    const markup = renderToStaticMarkup(
      createElement(Headline, {
        text: "What happens in your brain",
        palette: PALETTE,
        frame: FRAME,
        fps: FPS,
        maxWidth: 900,
      }),
    );
    expect(paintedWeight(markup)).toBe(TYPE_MEASURE.display.weight);
    expect(paintedWeight(markup)).toBe(TYPE.headline.fontWeight);
  });

  it("Deck sets the text weight the fitter measured", () => {
    const markup = renderToStaticMarkup(
      createElement(Deck, {
        text: "A sentence under a headline.",
        palette: PALETTE,
        frame: FRAME,
        fps: FPS,
        maxWidth: 900,
      }),
    );
    expect(paintedWeight(markup)).toBe(TYPE_MEASURE.text.weight);
    expect(paintedWeight(markup)).toBe(TYPE.deck.fontWeight);
  });

  it("SpokenWord sets the display weight the fitter measured", () => {
    const markup = renderToStaticMarkup(
      createElement(SpokenWord, { word: "focus", palette: PALETTE, frame: FRAME, fps: FPS }),
    );
    expect(paintedWeight(markup)).toBe(TYPE_MEASURE.display.weight);
    expect(paintedWeight(markup)).toBe(TYPE.spoken.fontWeight);
  });

  it("does not leave any of them on the inherited initial weight", () => {
    // The specific failure: a fitted element with no declared weight inherits 400,
    // which is a real weight the scale never chose and never measured.
    for (const [name, markup] of [
      [
        "Headline",
        renderToStaticMarkup(
          createElement(Headline, { text: "A claim", palette: PALETTE, frame: FRAME, fps: FPS, maxWidth: 900 }),
        ),
      ],
      [
        "Deck",
        renderToStaticMarkup(
          createElement(Deck, { text: "Under it.", palette: PALETTE, frame: FRAME, fps: FPS, maxWidth: 900 }),
        ),
      ],
      [
        "SpokenWord",
        renderToStaticMarkup(createElement(SpokenWord, { word: "focus", palette: PALETTE, frame: FRAME, fps: FPS })),
      ],
    ] as const) {
      expect(markup, `${name} declared no font-weight`).toMatch(/font-weight:/);
    }
  });
});
