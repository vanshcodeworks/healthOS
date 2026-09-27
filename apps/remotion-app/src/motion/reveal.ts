/**
 * Reveal utilities.
 *
 * The rule this module exists to enforce: type does not fade in.
 *
 * `opacity: 0 -> 1` on a headline is the default of every generated video and it
 * reads as generated, because it is the only thing that happens. A reveal that
 * earns attention moves: a mask slides across, a line rises out of its own
 * baseline, a rule draws under the word that is being stressed. Opacity is
 * available but is never the only thing that changes.
 */

import { ease } from "./ease.js";

export interface RevealOptions {
  /** Frame within the reveal's own timeline. */
  frame: number;
  fps: number;
  /** In frames. */
  durationInFrames: number;
  easing?: string;
  /** Stagger step in frames between successive lines. */
  stagger?: number;
  /** Which line this is, 0-indexed. */
  index?: number;
  /** Distance in px a line travels as it is revealed. */
  travel?: number;
}

function localFrame(frame: number, stagger: number, index: number): number {
  return frame - index * stagger;
}

function progress(options: RevealOptions): number {
  const f = localFrame(options.frame, options.stagger ?? 0, options.index ?? 0);
  if (f <= 0) return 0;
  if (f >= options.durationInFrames) return 1;
  return ease(options.easing, f / options.durationInFrames);
}

/**
 * A masked rise: the line travels up from below its own descender line while a
 * clip rectangle opens. Both halves matter — the movement alone reads as a
 * slide, the mask alone reads as a wipe, and together they read as type arriving.
 */
export function maskedRise(options: RevealOptions & { clipHeight: number }) {
  const t = progress(options);
  const travel = options.travel ?? options.clipHeight * 1.15;
  return {
    /** 0 at rest, 1 fully hidden below the mask. */
    translateY: (1 - t) * travel,
    /** Clip height as a fraction of the line box, 0 = fully clipped. */
    clip: t,
    opacity: t < 0.12 ? t / 0.12 : 1,
  };
}

/** A word that is being stressed lifts, tightens and returns. */
export function wordEmphasis(options: RevealOptions & { amount?: number }) {
  const t = progress(options);
  const amount = options.amount ?? 1;
  // A single fast swell rather than a spring: the word is being spoken, not
  // dropped onto a table.
  const swell = Math.sin(Math.PI * Math.min(1, t));
  return {
    scale: 1 + 0.055 * amount * swell,
    translateY: -8 * amount * swell,
    letterSpacing: -0.6 * amount * swell,
    opacity: 1,
  };
}

/**
 * A rule drawing itself under a word or a number. Progress 0 is a rule of full
 * length at zero opacity only if the caller asks for it; here it grows from the
 * left, which is how a pen moves.
 */
export function underlineDraw(options: RevealOptions & { width: number }) {
  const t = progress(options);
  return {
    width: options.width * t,
    opacity: t < 0.2 ? t / 0.2 : 1,
  };
}

/** A mask sliding open from one side. Used for panels and figure crops. */
export function revealMask(options: RevealOptions & { from?: "left" | "right" | "up" | "down" }) {
  const t = progress(options);
  const from = options.from ?? "left";
  const inv = 1 - t;
  return {
    clipPath:
      from === "left"
        ? `inset(0 ${(inv * 100).toFixed(2)}% 0 0)`
        : from === "right"
          ? `inset(0 0 0 ${(inv * 100).toFixed(2)}%)`
          : from === "up"
            ? `inset(${(inv * 100).toFixed(2)}% 0 0 0)`
            : `inset(0 0 ${(inv * 100).toFixed(2)}% 0)`,
    translateX: from === "left" ? -18 * inv : from === "right" ? 18 * inv : 0,
    translateY: from === "up" ? -18 * inv : from === "down" ? 18 * inv : 0,
    opacity: t < 0.15 ? t / 0.15 : 1,
  };
}

/**
 * A number counting to its value. Tabular figures, integer steps, and a spring
 * settle at the end so the last digit does not stop dead.
 */
export function countUp(options: RevealOptions & { from?: number; to: number; decimals?: number }) {
  const t = progress(options);
  const from = options.from ?? 0;
  const value = from + (options.to - from) * t;
  const decimals = options.decimals ?? 0;
  const shown = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
  return { value, shown };
}

/** A long hold, then leave. The exit is a fall, not a fade: it is going away. */
export function exitFall(options: RevealOptions & { distance?: number }) {
  const t = progress(options);
  const distance = options.distance ?? 26;
  return {
    translateY: t * distance,
    opacity: 1 - t,
  };
}
