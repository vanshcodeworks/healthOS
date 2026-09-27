/**
 * Text measurement without a DOM.
 *
 * Type has to be fitted before it is drawn, on frame 0, during a server-side
 * render, in the Player, and in a test that never opens a browser. A canvas
 * measure would be unavailable in all of those, so the widths come from
 * `font-metrics.ts` instead: advance widths in em, per family and per weight,
 * measured in the same browser engine that renders the video by
 * `scripts/calibrate-font-metrics.mjs`, and committed.
 *
 * The earlier version of this file carried a hand-written table of per-character
 * factors. It was a guess, and it was wrong in the direction that costs a
 * published frame: it under-counted Inter by about 13%, so a caption the fitter
 * believed was 916px wide painted at 1019px and ran off both sides of the
 * column. Measured advances cannot drift from the render the way a guessed
 * average can, so the guess is gone.
 *
 * Kerning is the one thing a per-character table cannot represent, because a kern
 * pair is a property of two adjacent characters. It is also the smallest term in
 * the sum — a few tenths of a percent at display size — and it is handled where it
 * actually matters: tracking is added explicitly by every caller that sets
 * `letterSpacing`, so a line is never fitted against a width the CSS will not
 * paint.
 */

import { advanceEm, type FontMetricKey } from "./font-metrics.js";

export type { FontMetricKey };

/**
 * The type a measurement is for. `text` at weight 500 is the default because the
 * caption band is the one measurement that has to be exactly right at all times:
 * it is the widest text in the frame, it sits in the band the platform UI covers,
 * and it is measured per cue rather than once per scene.
 */
export interface MeasureStyle {
  /** Which measured family. Defaults to the caption's own family. */
  font?: FontMetricKey;
  /** A weight that `art/fonts.ts` actually loads. */
  weight?: number;
  /**
   * Per-character tracking in px, which CSS adds *after* every character including
   * the last. Passing it here means the fit accounts for the width the line will
   * actually paint, instead of every caller pre-subtracting it by hand.
   */
  letterSpacing?: number;
}

const DEFAULT_STYLE: Required<Omit<MeasureStyle, "letterSpacing">> = { font: "text", weight: 500 };

/** Rendered width of a single line, in px, tracking included. */
export function measureLine(line: string, fontSize: number, style: MeasureStyle = {}): number {
  const font = style.font ?? DEFAULT_STYLE.font;
  const weight = style.weight ?? DEFAULT_STYLE.weight;
  const advances = advanceEm(font, weight, line) * fontSize;
  return advances + (style.letterSpacing ?? 0) * line.length;
}

/** Width of a single word, which is what an emphasis underline has to cover. */
export function measureWord(word: string, fontSize: number, style: MeasureStyle = {}): number {
  return measureLine(word, fontSize, { ...style, letterSpacing: 0 });
}

export interface WrapOptions extends MeasureStyle {
  maxWidth: number;
  fontSize: number;
  maxLines: number;
  /**
   * A multiplier on the width a line may fill, for a measure that wants a shorter
   * or longer line than the column. Below 1 is *tighter*, which is what a display
   * serif wants; it must never be above 1 here, because that lets the fitter
   * believe a line fits when it paints wider than the column it was measured
   * against — the exact failure this file's history is about.
   */
  lineHeightFactor?: number;
}

export interface WrapResult {
  lines: string[];
  /** True when the text was cut to fit. The caller should say so, not hide it. */
  truncated: boolean;
}

/**
 * Greedy wrap, then a fit pass.
 *
 * If the text still will not fit at the requested size it is *not* shrunk here:
 * the caller decides, because a headline that quietly became 12% smaller than
 * every other headline in the video is worse than one that is visibly long.
 * `fitFontSize` is the opt-in.
 */
export function wrapText(text: string, options: WrapOptions): WrapResult {
  const target = options.maxWidth * (options.lineHeightFactor ?? 1);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureLine(candidate, options.fontSize, options) <= target || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  const truncated = lines.length > options.maxLines;
  return { lines: lines.slice(0, options.maxLines), truncated };
}

/**
 * Largest size at or below `max` that fits the text in the box. Uses a binary
 * search on 1px steps' worth of candidates, so it is stable and cheap.
 */
export function fitFontSize(
  text: string,
  { max, min = 24, maxWidth, maxLines, lineHeightFactor, ...style }: Omit<WrapOptions, "fontSize"> & { max: number; min?: number },
): { size: number; lines: string[]; truncated: boolean } {
  let lo = min;
  let hi = max;
  let best = min;
  let bestLines: string[] = [text];
  let bestTruncated = true;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const result = wrapText(text, { maxWidth, fontSize: mid, maxLines, lineHeightFactor, ...style });
    if (!result.truncated) {
      best = mid;
      bestLines = result.lines;
      bestTruncated = false;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (bestTruncated) {
    const result = wrapText(text, { maxWidth, fontSize: min, maxLines, lineHeightFactor, ...style });
    return { size: min, lines: result.lines, truncated: true };
  }
  return { size: best, lines: bestLines, truncated: bestTruncated };
}

/**
 * Deliberate line breaks. A headline breaks where the sentence breathes, not
 * where the box happens to end, so authors can insert a marker to override the
 * greedy wrap.
 */
export const BREAK = "↵";

export function applyBreaks(text: string): string[] {
  return text.split(BREAK).map((s) => s.trim()).filter(Boolean);
}
