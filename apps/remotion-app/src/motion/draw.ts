/**
 * Path drawing.
 *
 * The whole point of the illustration engine is that a diagram is drawn, not
 * faded in. A stomach outline that appears all at once is a picture of a stomach;
 * one whose contour travels is a diagram being constructed, and the viewer's eye
 * follows the line to the part being named.
 *
 * Length is measured with `@remotion/paths`, which parses path data
 * arithmetically. It does not need a laid-out DOM, so the same measurement is
 * available on the first frame, during server-side rendering, and inside the
 * Player. Measuring with `getTotalLength()` on a ref would give an undrawn path
 * on the frames that matter most.
 */

import { getLength } from "@remotion/paths";
import { ease } from "./ease.js";

/** Path length in user units, cached because it never changes for a given `d`. */
const LENGTH_CACHE = new Map<string, number>();

export function pathLength(d: string): number {
  const hit = LENGTH_CACHE.get(d);
  if (hit !== undefined) return hit;
  const value = getLength(d);
  LENGTH_CACHE.set(d, value);
  return value;
}

export interface DrawOptions {
  /** Frame within the draw's own timeline. */
  frame: number;
  fps: number;
  /** In frames. */
  durationInFrames: number;
  easing?: string;
  /** Fraction of the path drawn at frame 0. 0 = nothing. */
  from?: number;
  /** Fraction of the path drawn at the end. 1 = all of it. */
  to?: number;
  /** Delay in frames, for a line that starts after another finishes. */
  delay?: number;
}

export interface DrawResult {
  /** `stroke-dasharray`. */
  dashArray: number;
  /** `stroke-dashoffset`. */
  dashOffset: number;
  /** Stroke width multiplier, for a line that thickens as it is drawn. */
  weight: number;
  /** 0 until the first bit of the line exists. */
  opacity: number;
}

/** Pen travel along a path, in seconds of animation. */
export function drawPath(d: string, options: DrawOptions): DrawResult {
  const length = pathLength(d);
  const start = options.from ?? 0;
  const end = options.to ?? 1;
  const f = options.frame - (options.delay ?? 0);
  let t = 0;
  if (f > 0 && options.durationInFrames > 0) {
    t = f >= options.durationInFrames ? 1 : ease(options.easing, f / options.durationInFrames);
  }
  const drawn = length * (start + (end - start) * t);
  return {
    dashArray: length,
    dashOffset: length - drawn,
    // A line that keeps a constant weight reads as printed. Letting it thin
    // slightly at the start reads as a pen being placed.
    weight: 0.82 + 0.18 * t,
    opacity: drawn > 0 ? Math.min(1, 0.25 + t * 4) : 0,
  };
}

/**
 * A travelling dot: used to show direction along a path without animating the
 * path itself. Returns the position in path user units.
 */
export function pathTravel(d: string, options: DrawOptions & { cycles?: number; from?: number; to?: number }) {
  const f = options.frame - (options.delay ?? 0);
  const length = pathLength(d);
  const cycles = options.cycles ?? 1;
  const start = options.from ?? 0;
  const end = options.to ?? 1;
  const t =
    f <= 0
      ? 0
      : options.durationInFrames > 0
        ? Math.min(1, f / options.durationInFrames)
        : 1;
  const span = (end - start) * length;
  // Ping-pong so a dot does not teleport back at the loop boundary.
  const phase = cycles > 0 ? (t * cycles) % 1 : t;
  const pingPong = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return start * length + span * ease(options.easing, pingPong);
}

/** A highlight sweeping across a shape, as a percentage of its width. */
export function sweep(options: DrawOptions & { width: number }): { x: number; width: number; opacity: number } {
  const f = options.frame - (options.delay ?? 0);
  const t =
    f <= 0 ? 0 : options.durationInFrames > 0 ? ease(options.easing, Math.min(1, f / options.durationInFrames)) : 1;
  const band = options.width * 0.34;
  return {
    x: (options.width - band) * t,
    width: band,
    opacity: t > 0 && t < 1 ? Math.sin(Math.PI * t) * 0.5 : 0,
  };
}
