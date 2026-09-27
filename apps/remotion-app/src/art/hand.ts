/**
 * Hand-drawn treatment.
 *
 * A diagram that is perfectly smooth reads as clip art. A diagram whose lines
 * wobble randomly reads as a filter. The version that reads as drawing is
 * between the two: the *travelling* line is a little unsteady, the *idle* line
 * is straight, and the unsteadiness is smooth rather than noisy, so the eye reads
 * a hand rather than a defect.
 *
 * So the deformation here is a sum of a few low-frequency sinusoids with phases
 * drawn from a seed. Not per-point randomness: that is what produces the fuzzy,
 * crawly look. With three harmonics the line has a slow drift and a slight
 * waver, which is what a pen on paper actually does.
 *
 * Everything is a function of the seed, so an illustration is byte-identical
 * between two renders, and different between two scenes.
 */

import { getLength, getPointAtLength, getTangentAtLength } from "@remotion/paths";

/** Mulberry32. Small, fast, and identical across machines. */
export function seededRandom(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HandOptions {
  seed: number;
  /** Peak displacement in user units. 0 disables the treatment entirely. */
  roughness?: number;
  /** How many slow waves the line has. 1-4; more looks nervous. */
  harmonics?: number;
  /** Samples along the path. More is smoother and more expensive. */
  samples?: number;
  /** Displacement at t=0, as a fraction of roughness. Lets two lines meet. */
  anchorStart?: number;
  anchorEnd?: number;
}

interface Harmonic {
  freq: number;
  phase: number;
  amp: number;
}

function harmonicsFor(seed: number, count: number): Harmonic[] {
  const rand = seededRandom(seed);
  const out: Harmonic[] = [];
  // Amplitudes fall off fast: the first wave carries the character, the rest add
  // just enough to stop the line looking like a sine wave.
  const weights = [0.58, 0.26, 0.11, 0.05];
  for (let i = 0; i < count; i += 1) {
    out.push({
      freq: 1 + i * (1.4 + rand() * 1.8),
      phase: rand() * Math.PI * 2,
      amp: weights[i] ?? 0.05,
    });
  }
  return out;
}

/** Displacement at a normalised position along the path, in user units. */
export function handOffset(seed: number, t: number, roughness: number, harmonics: number): number {
  if (roughness <= 0) return 0;
  let sum = 0;
  let norm = 0;
  for (const h of harmonicsFor(seed, harmonics)) {
    sum += Math.sin(Math.PI * 2 * h.freq * t + h.phase) * h.amp;
    norm += h.amp;
  }
  return (sum / norm) * roughness;
}

/**
 * Catmull-Rom through the sampled points, emitted as cubic beziers. A spline
 * rather than a polyline, because a polyline at this sample count is visibly
 * faceted and the whole point is that the line looks drawn.
 */
function spline(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  const parts = [`M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    parts.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    );
  }
  return parts.join(" ");
}

export { spline as splinePath };

/**
 * Turns an ideal path into a drawn one.
 *
 * Implemented on top of `@remotion/paths` arithmetic rather than the DOM, so it
 * works on the first frame of a server-side render and produces the same string
 * in the Player.
 */
export function handPath(
  d: string,
  { seed, roughness = 2.4, harmonics = 3, samples = 48 }: HandOptions,
): string {
  if (roughness <= 0) return d;
  return resampleAndWarp(d, { seed, roughness, harmonics, samples });
}

interface Sample {
  x: number;
  y: number;
}

function resampleAndWarp(
  d: string,
  options: Required<Omit<HandOptions, "anchorStart" | "anchorEnd">>,
): string {
  const length = getLength(d);
  if (length <= 0) return d;
  const count = Math.max(8, options.samples);
  const points: Sample[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const at = t * length;
    const p = getPointAtLength(d, at);
    const tan = getTangentAtLength(d, at);
    // Perpendicular to the direction of travel: the line wanders sideways, the
    // way a pen does, rather than growing and shrinking. A zero-length path has
    // no tangent, and nothing to wander, so it is passed through untouched.
    if (!p || !tan || (p.x === 0 && p.y === 0)) {
      points.push(p ?? { x: 0, y: 0 });
      continue;
    }
    const nx = -tan.y;
    const ny = tan.x;
    const offset = handOffset(options.seed, t, options.roughness, options.harmonics);
    points.push({ x: p.x + nx * offset, y: p.y + ny * offset });
  }
  return spline(points);
}

/**
 * Line weight variation. A drawn line is not one weight: it is heavier where the
 * pen slowed down. Returned as a multiplier on the nominal stroke width.
 */
export function handWeight(seed: number, t: number, amount = 0.16): number {
  return 1 - amount + amount * (0.5 + 0.5 * Math.sin(Math.PI * 2 * (1.3 * t) + (seed % 17)));
}

/**
 * A hand-drawn circle. Built as an ellipse with a slow radial waver, which is
 * what makes a circle look drawn rather than plotted.
 */
export function handEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  { seed, roughness = 1.8, samples = 56 }: { seed: number; roughness?: number; samples?: number },
): string {
  const points: Sample[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / samples;
    const a = t * Math.PI * 2;
    const r = 1 + handOffset(seed, t, roughness / Math.max(rx, ry), 3);
    points.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r });
  }
  return `${spline(points)} Z`;
}
