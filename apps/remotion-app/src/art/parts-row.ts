/**
 * Part rows.
 *
 * The molecular breakdown lays a structure's parts out as a single row of names
 * under the figure, and that row has to fit the content column. The rule that makes
 * this fiddly is that the row must be *measured the way it is painted*: each name
 * is its own span, there is a drawn separator between names on top of the flex gap,
 * and the one name the bracket is currently on is set bold while the rest are not.
 * Measure a name-run joined with spaces and you have measured a sentence.
 *
 * That mistake was live. The fitter used `parts.join(" ")`, which charges one word
 * space for a gap the row paints at twice that — 8px against 44px at 34px — so a
 * three-part row was fitted against a 948px column while painting 992, and because
 * the row is centred it overhung both sides by more than the safe area's own margin.
 * The error is 36px per boundary, which is why it survived: it is invisible on two
 * names and a hard overflow on six, and the scenes that shipped had three.
 *
 * Pure layout, no React, so the invariant can be asserted without a render.
 */

import { measureLine } from "./measure.js";
import { CONTENT } from "./spacing.js";

/** The rule drawn between two part names. Also the flex gap either side of it. */
export const PART_SEPARATOR = 22;

/**
 * The real distance between two names: the flex `gap` plus the separator span.
 * Change `PART_SEPARATOR` and the row and this measure move together.
 */
export const PART_GAP = PART_SEPARATOR * 2;

const PART_MEASURE = { font: "text", weight: 500, letterSpacing: 0.6 } as const;

/** The part the bracket is sitting on is set bold, so it is measured bold. */
const PART_CURRENT_MEASURE = { font: "text", weight: 700, letterSpacing: 0.6 } as const;

/**
 * Measured width of a row as the row paints it: every name at the weight it will
 * render in, and the real gap between names.
 *
 * `from` is the index of the row's first name within the whole list, so the bold
 * test still lands on the right name once the names have wrapped across rows.
 */
export function measurePartRow(parts: string[], size: number, currentIndex: number, from = 0): number {
  let total = 0;
  parts.forEach((part, i) => {
    if (i > 0) total += PART_GAP;
    total += measureLine(part, size, from + i === currentIndex ? PART_CURRENT_MEASURE : PART_MEASURE);
  });
  return total;
}

/** Greedy wrap of the part names into rows that fit the column. */
export function wrapParts(parts: string[], size: number, currentIndex: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  for (const part of parts) {
    const candidate = [...row, part];
    const from = rows.reduce((n, r) => n + r.length, 0);
    if (measurePartRow(candidate, size, currentIndex, from) <= CONTENT.width || row.length === 0) {
      row = candidate;
    } else {
      rows.push(row);
      row = [part];
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** Largest name size at which the whole breakdown still fits the content column. */
export function fitPartSize(parts: string[], currentIndex: number): number {
  if (parts.length === 0) return 30;
  let size = 34;
  while (size > 20) {
    const rows = wrapParts(parts, size, currentIndex);
    if (rows.length === 1 && measurePartRow(rows[0]!, size, currentIndex) <= CONTENT.width) {
      return size;
    }
    size -= 2;
  }
  return 20;
}
