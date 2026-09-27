// A caption is a block, and the block has to stay in the frame.
//
// This test exists because of a rendered frame, not a theory. The caffeine render
// put twelve lines of caption on screen where the storyboard asked for two, from
// y=1168 to y=1917: three pixels from the bottom edge of a 1920px frame. Nothing
// complained. The schema said `max_lines: 2`, the adapter copied the style through
// faithfully, the timing was correct, and the audio was correct, and the video was
// still wrong.
//
// The cause was two bugs that hid each other. The band broke its lines by word
// count and character count, which the storyboard sets to four words and twenty-four
// characters, so a sixty-character cue became five lines. Then the band asked the
// measured fitter to squeeze those five lines into two, was told "truncated: true",
// and rendered its own five lines at the floor size anyway. And the y position was
// a *centre* clamped to a band that was already below the safe area, so a tall
// block centred there hung off the bottom of the frame.
//
// The invariant is the one that matters and is asserted below: whatever the block
// is, it is inside the frame. The line count is asserted where it is decided.

import { describe, expect, it } from "vitest";
import { captionCentreY, CONTENT, FRAME, SAFE } from "@hc/remotion-app/spacing";
import { fitFontSize, measureLine } from "@hc/remotion-app/measure";

/** The frame-inspection harness treats anything inside this as off-frame. */
const MARGIN = 44;
const WIDTH = FRAME.width;
const HEIGHT = FRAME.height;

/** The band's own measure: Inter 500, tracked. Mirrors `components/Caption.tsx`. */
const CAPTION_MEASURE = { font: "text", weight: 500, letterSpacing: 0.4 } as const;

/**
 * The width a caption line paints at, computed the way the DOM computes it.
 *
 * The band lays words out in a flex row with a `gap` between them and no space
 * characters, so its width is the sum of the words plus one gap per space. This is
 * written out longhand rather than delegated to `measureLine` so that it is an
 * independent check: if the two ever disagree, the line is painting at a width
 * nobody fitted.
 */
function flexLineWidth(line: string, size: number): number {
  const words = line.split(" ");
  const gap = measureLine(" ", size, CAPTION_MEASURE);
  const wordsWidth = words.reduce((total, word) => total + measureLine(word, size, CAPTION_MEASURE), 0);
  return wordsWidth + gap * (words.length - 1);
}

describe("caption band geometry", () => {
  it("keeps the whole block inside the frame for any requested position", () => {
    // Every normalised y the storyboard schema permits, against block heights from
    // one line to the twelve that actually happened.
    for (let y = 0; y <= 1.0001; y += 0.02) {
      for (const lines of [1, 2, 3, 5, 8, 12]) {
        const size = 52;
        const blockH = lines * size * 1.34;
        const centre = captionCentreY(y, blockH);
        const top = centre - blockH / 2;
        const bottom = centre + blockH / 2;
        expect(top, `y=${y.toFixed(2)} lines=${lines} top`).toBeGreaterThanOrEqual(-1e-6);
        expect(bottom, `y=${y.toFixed(2)} lines=${lines} bottom`).toBeLessThanOrEqual(HEIGHT + 1e-6);
      }
    }
  });

  it("never puts a caption under the platform's own furniture", () => {
    // A caption that runs into the bottom UI is a QA finding found after the
    // render, so the block stays above the handle zone with room to spare.
    const blockH = 2 * 52 * 1.34;
    const centre = captionCentreY(0.78, blockH);
    expect(centre + blockH / 2).toBeLessThanOrEqual(HEIGHT - 220);
  });

  it("still honours the storyboard's own position when the block fits", () => {
    // The clamp is a floor, not a replacement: a short block asked for inside the
    // allowed band stays where it was asked for. 0.78 is the corpus default.
    const blockH = 2 * 44 * 1.34;
    expect(captionCentreY(0.78, blockH)).toBeCloseTo(0.78 * HEIGHT, 6);
    expect(captionCentreY(0.75, blockH)).toBeCloseTo(0.75 * HEIGHT, 6);
  });

  it("returns the bare centre when no block height is given", () => {
    // QA locates the band with this, and it must stay the unclamped request.
    expect(captionCentreY(0.78)).toBeCloseTo(0.78 * HEIGHT, 6);
    expect(captionCentreY(0)).toBe(CONTENT.bottom - 150);
    expect(captionCentreY(1)).toBe(HEIGHT - 250);
  });

  it("fits a long cue into the line budget the storyboard asked for", () => {
    // The real defect, stated as an invariant: the fitter the band uses must be
    // able to fit the longest cue in the corpus into `max_lines` lines at the
    // width of the content column, without truncating. The band's model is
    // reproduced here exactly — Inter 500, tracked, word gaps taken from the
    // measured space advance — so "fits" here means "fits when rendered".
    const cue =
      "This is where the gap between the two numbers actually lives, and it is not the part that marketing usually shows you.";
    const fitted = fitFontSize(cue, { ...CAPTION_MEASURE, max: 52, min: 30, maxWidth: CONTENT.width, maxLines: 2, lineHeightFactor: 1 });
    expect(fitted.truncated, "the band renders its own lines, so a truncation here is a 12-line block").toBe(false);
    expect(fitted.lines.length).toBeLessThanOrEqual(2);
    for (const line of fitted.lines) {
      expect(flexLineWidth(line, fitted.size)).toBeLessThanOrEqual(CONTENT.width);
    }
  });

  it("keeps the word gap and the measure in agreement", () => {
    // The band separates words with a flex gap taken from the measure's space
    // advance, and the fitter charges the same space advance for the space it
    // thinks is there. If those two ever disagree, the line paints at a width
    // nobody fitted, which is the whole class of bug this file is about. The two
    // are computed independently here: `flexLineWidth` is the DOM's arithmetic,
    // `measureLine` is the fitter's.
    for (const size of [30, 36, 40, 44, 48, 52]) {
      for (const line of [
        "This is where the gap between",
        "the two numbers actually lives",
        "marketing usually shows you",
        "a b c d e f g h i j k l m n o p",
      ]) {
        expect(flexLineWidth(line, size), `flex vs measure at ${size}px: ${line}`).toBeCloseTo(measureLine(line, size, CAPTION_MEASURE), 6);
      }
    }
  });

  it("measures Inter as Inter, not as a guess", () => {
    // The regression that matters: the band used to be fitted against a
    // hand-written table of average per-character factors, which under-counted
    // Inter's letters by about 16% — 0.52em for an `n` where Inter 500 is 0.6016em.
    // A caption the table believed was 916px wide painted at 1019px and ran off
    // both sides of a 948px column. If a future change swaps the measured table
    // back for heuristics, this is the assertion that notices: it pins real
    // advances, measured in the browser by `scripts/calibrate-font-metrics.mjs`,
    // and it pins them *per weight*, because Inter 400 and Inter 500 differ.
    expect(measureLine("nnnnnnnnnn", 100, { font: "text", weight: 500 })).toBeCloseTo(10 * 0.6016 * 100, 6);
    expect(measureLine("mmmmmmmmmm", 100, { font: "text", weight: 500 })).toBeCloseTo(10 * 0.8882 * 100, 6);
    expect(measureLine(" ", 100, { font: "text", weight: 500 })).toBeCloseTo(0.2666 * 100, 6);
    // The same characters in a different weight are a different width, so a
    // measure that cannot tell the two apart is measuring the wrong font.
    expect(measureLine("nnnnnnnnnn", 100, { font: "text", weight: 400 })).toBeLessThan(
      measureLine("nnnnnnnnnn", 100, { font: "text", weight: 500 }),
    );
  });

  it("does not shrink a short cue", () => {
    // The fitter is a ceiling, not a target. A four-word cue at the band's own
    // default size is set at that size; a caption band that quietly renders every
    // cue small is a different design from one that shrinks only what must shrink.
    const fitted = fitFontSize("here is the part", { ...CAPTION_MEASURE, max: 52, min: 30, maxWidth: CONTENT.width, maxLines: 2, lineHeightFactor: 1 });
    expect(fitted.truncated).toBe(false);
    expect(fitted.size).toBe(52);
  });

  it("keeps the caption column inside the side margins", () => {
    expect(CONTENT.left).toBe(SAFE.side);
    expect(CONTENT.left + CONTENT.width).toBeLessThanOrEqual(WIDTH - MARGIN);
  });
});
