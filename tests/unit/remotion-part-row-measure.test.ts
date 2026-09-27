// A row of part names is measured the way it is painted.
//
// The molecular breakdown fits a structure's part names into the content column
// and centres the row, so a row that measures narrower than it paints runs off
// both sides of the frame at once. It used to. The row renders each name in its own
// span with a drawn separator on top of the flex gap, but the fitter measured
// `parts.join(" ")` — one word space, about 8px at 34px, for a gap the row paints at
// 44px. It also measured every name at weight 500 while the one the bracket is on
// paints bold.
//
// Measured against the shipped frames the numbers are:
//
//   parts   old size   painted width   column
//   2-4     34         fits            948
//   5       34         962px           14px over
//   6       28         1102px          154px over, 77px past the safe margin
//   6 long  24         1109px          161px over
//
// which is why it survived: the scenes that shipped had three parts, where the
// under-count happened to stay inside the column. The error is 36px per boundary,
// so it is a function of part count and nothing else caught it.
//
// What is asserted here is the guarantee the fitter is supposed to provide — the row
// it approves is a row that fits — plus the differential that proves the previous
// measure did not provide it.

import { describe, expect, it } from "vitest";
import { fitPartSize, measurePartRow, wrapParts, PART_GAP } from "@hc/remotion-app/parts-row";
import { measureLine } from "@hc/remotion-app/measure";
import { CONTENT } from "@hc/remotion-app/spacing";

/** Mirrors the resting render weight in `art/parts-row.ts`. */
const RESTING = { font: "text", weight: 500, letterSpacing: 0.6 } as const;

const TWO = ["receptor", "molecule"];
const THREE = ["intestine", "blood vessel", "brain"];
const FIVE = ["blood vessel", "intestinal lining", "liver", "pancreas", "brain"];
const SIX = ["blood vessel", "intestinal lining", "liver", "pancreas", "brain", "peripheral nerve"];
const LONG_FOUR = ["gastrointestinal tract", "hypothalamus", "adrenal gland", "pituitary"];
const LONG_SIX = ["gastrointestinal tract", "hypothalamus", "adrenal gland", "pituitary", "thyroid", "pancreas"];

/** The fitter as it was: names joined with word spaces, all measured at one weight. */
function oldFitPartSize(parts: string[]): number {
  if (parts.length === 0) return 30;
  let size = 34;
  while (size > 20) {
    if (measureLine(parts.join(" "), size, RESTING) <= CONTENT.width) return size;
    size -= 2;
  }
  return 20;
}

/** `wrapParts` returns rows without offsets; this walks them back into indices. */
function rowsWithOffsets(parts: string[], size: number, currentIndex: number) {
  const rows = wrapParts(parts, size, currentIndex);
  let from = 0;
  return rows.map((row) => {
    const entry = { row, from };
    from += row.length;
    return entry;
  });
}

describe("molecular breakdown part row", () => {
  it("charges the real gap between names rather than a word space", () => {
    // The two ways of measuring the same single boundary, at the fitter's top size.
    const asSentence = measureLine(`${THREE[0]} ${THREE[1]}`, 34, RESTING);
    const asRow = measureLine(THREE[0]!, 34, RESTING) + PART_GAP + measureLine(THREE[1]!, 34, RESTING);
    expect(PART_GAP).toBeGreaterThan(measureLine(" ", 34, RESTING) * 4);
    expect(asRow - asSentence).toBeGreaterThan(20);
  });

  it("measures the bracketed name bold, because that is how it paints", () => {
    const parts = ["brain", "pathway"];
    const boldFirst = measurePartRow(parts, 30, 0);
    const noBold = measurePartRow(parts, 30, -1);
    expect(boldFirst).toBeGreaterThan(noBold);
  });

  it("keeps every row it fits inside the content column", () => {
    for (const parts of [TWO, THREE, FIVE, SIX, LONG_FOUR, LONG_SIX]) {
      for (let current = 0; current < parts.length; current += 1) {
        const size = fitPartSize(parts, current);
        for (const { row, from } of rowsWithOffsets(parts, size, current)) {
          expect(measurePartRow(row, size, current, from)).toBeLessThanOrEqual(CONTENT.width);
        }
      }
    }
  });

  it("would have overflowed where the word-space measure approved the size", () => {
    // Five names is the smallest count where the old measure was already wrong.
    for (const parts of [FIVE, SIX, LONG_FOUR, LONG_SIX]) {
      const old = oldFitPartSize(parts);
      const current = 0;
      expect(old).toBeGreaterThan(fitPartSize(parts, current));
      expect(measurePartRow(parts, old, current)).toBeGreaterThan(CONTENT.width);
    }
  });

  it("wraps a row that cannot fit, rather than painting it past the margin", () => {
    for (const parts of [LONG_SIX]) {
      const size = fitPartSize(parts, 0);
      const rows = wrapParts(parts, size, 0);
      expect(rows.length).toBeGreaterThan(1);
      // Wrapping is only allowed if it preserves the names and their order.
      expect(rows.flat()).toEqual(parts);
    }
  });

  it("leaves a short row at the fitter's top size", () => {
    // The bug was invisible at low part counts, so this pins the case that used to
    // agree: the correction must not shrink type that already fit.
    expect(fitPartSize(THREE, 0)).toBe(34);
    expect(fitPartSize(TWO, 0)).toBe(34);
  });
});
