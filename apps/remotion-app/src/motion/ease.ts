/**
 * Easing.
 *
 * The vocabulary is closed and small, because a frame with three different
 * accelerations reads as a template. What actually varies between scenes is
 * *which* of these is used and how long it takes, not the shape of every move.
 *
 * The house curves:
 * - `editorial` — long, soft deceleration. Type and camera.
 * - `scientific` — a precise, slightly damped arrival. Diagrams and markers.
 * - `energetic`  — short, confident. Counters and beats.
 * - `calm`       — very long, almost linear. Ambient and holds.
 *
 * `out` is the default for almost everything. `in` is reserved for things
 * leaving the frame, and `in_out` for a value that has to arrive and settle
 * without a visible top.
 * The curves are implemented here rather than borrowed from the renderer's
 * easing helper. Two reasons, both practical: the easing table is then testable
 * in a plain unit test with no Remotion runtime, and the shapes are frozen — a
 * dependency upgrade cannot silently change what a 2026 video looks like when it
 * is re-rendered next year from the same storyboard hash.
 */

export type MotionProfile = "editorial" | "scientific" | "energetic" | "calm" | "clinical" | "curious" | "dramatic";

type EasingName =
  | "linear"
  | "sine_in"
  | "sine_out"
  | "sine_in_out"
  | "quad_in"
  | "quad_out"
  | "quad_in_out"
  | "cubic_in"
  | "cubic_out"
  | "cubic_in_out"
  | "quart_out"
  | "expo_out"
  | "back_out"
  | "elastic_out"
  | "bounce_out"
  | "spring";

const HALF_PI = Math.PI / 2;
const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;

function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) {
    const u = t - 1.5 / d;
    return n * u * u + 0.75;
  }
  if (t < 2.5 / d) {
    const u = t - 2.25 / d;
    return n * u * u + 0.9375;
  }
  const u = t - 2.625 / d;
  return n * u * u + 0.984375;
}

const TABLE: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  sine_in: (t) => 1 - Math.cos(t * HALF_PI),
  sine_out: (t) => Math.sin(t * HALF_PI),
  sine_in_out: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  quad_in: (t) => t * t,
  quad_out: (t) => t * (2 - t),
  quad_in_out: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  cubic_in: (t) => t * t * t,
  cubic_out: (t) => 1 - Math.pow(1 - t, 3),
  cubic_in_out: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  quart_out: (t) => 1 - Math.pow(1 - t, 4),
  expo_out: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  back_out: (t) => 1 + BACK_C3 * Math.pow(t - 1, 3) + BACK_C1 * Math.pow(t - 1, 2),
  elastic_out: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  bounce_out: bounceOut,
  // Spring is handled by the spring module, which needs a frame and an fps. This
  // entry exists so a storyboard naming it resolves rather than silently falling
  // back to a different curve.
  spring: (t) => 1 - Math.pow(1 - t, 3),
};

export function ease(name: string | undefined, t: number): number {
  const fn = TABLE[(name ?? "cubic_out") as EasingName] ?? TABLE.cubic_out;
  return fn(Math.min(1, Math.max(0, t)));
}

/**
 * Profiles are how a scene declares its character once, instead of every
 * animation in it picking an easing. A calmer scene is longer and softer; an
 * energetic one is shorter. Magnitudes, not shapes: the shape stays constant so
 * two profiles still look like the same studio.
 */
interface ProfileSpec {
  /** Multiplies every duration. >1 is slower. */
  durationScale: number;
  /** Multiplies every travel distance. */
  distanceScale: number;
  /** Default spring damping. Lower is looser. */
  damping: number;
  overshoot: number;
}

const PROFILES: Record<MotionProfile, ProfileSpec> = {
  editorial: { durationScale: 1.25, distanceScale: 1, damping: 26, overshoot: 0 },
  scientific: { durationScale: 1, distanceScale: 0.9, damping: 22, overshoot: 0.04 },
  energetic: { durationScale: 0.68, distanceScale: 1.15, damping: 18, overshoot: 0.1 },
  dramatic: { durationScale: 1.5, distanceScale: 1.4, damping: 30, overshoot: 0 },
  calm: { durationScale: 1.7, distanceScale: 0.7, damping: 28, overshoot: 0 },
  clinical: { durationScale: 0.9, distanceScale: 0.8, damping: 30, overshoot: 0 },
  curious: { durationScale: 1.1, distanceScale: 1, damping: 16, overshoot: 0.12 },
};

export function profile(name: string | undefined): ProfileSpec {
  return PROFILES[(name ?? "editorial") as MotionProfile] ?? PROFILES.editorial;
}

export const MOTION_PROFILES = Object.keys(PROFILES) as MotionProfile[];
