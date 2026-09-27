/**
 * The animator: a storyboard `Animation` name plus a `MotionSpec` in, a bag of
 * numbers out.
 *
 * This is the only place that knows what "wipe" means. Scenes ask for an
 * animation by name and read the result, so no scene implements timing itself and
 * two scenes asking for the same word get the same movement.
 *
 * `evaluate` is a pure function of the spec and the frame. Nothing reads a
 * clock, nothing holds state between frames, and nothing depends on the order
 * frames are rendered in — which is the whole reason the same project renders
 * identically in the Player, on CI, and on a laptop.
 */

import { ease, profile } from "./ease.js";
import { springIn } from "./spring.js";
import { drawPath, type DrawResult } from "./draw.js";
import type { MotionSpec } from "../props.js";

export interface AnimatedValues {
  /** 0..1 through the animation, easing included. */
  progress: number;
  /** False before the delay and after the exit has finished. */
  active: boolean;
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  rotate: number;
  /** Clip inset, for mask reveals. */
  clipPercent: number;
  /** 0..1 line-draw progress, for `draw` and `path_trace`. */
  drawProgress: number;
  /** 0..1 for count-up style animations. */
  counterProgress: number;
  /** Continuous 0..1 phase for loops, never resetting within a scene. */
  loopPhase: number;
}

export const NEUTRAL: AnimatedValues = {
  progress: 1,
  active: true,
  opacity: 1,
  translateX: 0,
  translateY: 0,
  scale: 1,
  rotate: 0,
  clipPercent: 0,
  drawProgress: 1,
  counterProgress: 1,
  loopPhase: 0,
};

export interface EvaluateOptions {
  /** Frame within the scene. */
  frame: number;
  fps: number;
  /** Scene length in frames, used to clamp loop phases. */
  sceneDurationInFrames: number;
  /** Scene's motion profile. */
  profile?: string;
}

/**
 * Direction and distance for a given word. Distances are fractions of the
 * element's own box unless stated, so a label and a headline can share a word and
 * move proportionally.
 */
const TRAVEL: Record<string, { dx: number; dy: number }> = {
  slide_left: { dx: -1, dy: 0 },
  slide_right: { dx: 1, dy: 0 },
  slide_up: { dx: 0, dy: 1 },
  slide_down: { dx: 0, dy: -1 },
  wipe: { dx: 0, dy: 0 },
  reveal_mask: { dx: 0, dy: 0 },
  label_pop: { dx: 0, dy: 0.35 },
  draw: { dx: 0, dy: 0 },
  path_trace: { dx: 0, dy: 0 },
  grid_draw: { dx: 0, dy: 0 },
  highlight_sweep: { dx: 0, dy: 0 },
  typewriter: { dx: 0, dy: 0 },
  count_up: { dx: 0, dy: 0 },
  counter_tick: { dx: 0, dy: 0 },
  breathe: { dx: 0, dy: 0 },
};

export function evaluate(spec: MotionSpec | undefined, options: EvaluateOptions): AnimatedValues {
  if (!spec) return NEUTRAL;
  const { frame, fps } = options;
  const prof = profile(options.profile);
  const delay = Math.round(spec.delay_s * fps);
  const asked = Math.max(1, Math.round(spec.duration_s * fps * prof.durationScale));
  /**
   * A component that asks for a longer draw than its scene has gets the draw
   * compressed to fit, rather than being cut off mid-stroke. A half-drawn stomach
   * at a cut looks like a broken frame; a slightly faster complete one does not.
   * The compression is bounded so a scene that is barely long enough does not
   * turn a 0.6s draw into an instant pop.
   */
  const available =
    options.sceneDurationInFrames === undefined
      ? asked
      : Math.max(Math.round(asked * 0.5), options.sceneDurationInFrames - delay);
  const duration = Math.max(1, Math.min(asked, available));
  const amplitude = spec.amplitude;

  // `iterations` above 1 means the animation repeats inside the scene. The phase
  // is derived from the absolute frame, so a loop does not restart when a
  // component remounts and two components with different delays stay out of step
  // only if they were authored that way.
  const loops = Math.max(1, Math.round(spec.iterations));
  const loopLength = duration * loops;
  const raw = frame - delay;
  if (raw < 0) {
    return { ...NEUTRAL, active: false, opacity: 0, progress: 0, drawProgress: 0, counterProgress: 0 };
  }
  const within = loops > 1 ? raw % loopLength : raw;
  const loopPhase = loops > 1 ? within / loopLength : 0;
  const t = Math.min(1, within / duration);
  const eased = ease(spec.easing, t);

  const values: AnimatedValues = {
    ...NEUTRAL,
    progress: eased,
    active: true,
    loopPhase,
  };

  switch (spec.animation) {
    case "fade":
      values.opacity = eased;
      break;

    case "fade_out":
      values.opacity = 1 - eased;
      break;

    case "scale_in":
      values.opacity = Math.min(1, eased * 2.4);
      values.scale = 0.9 + 0.1 * eased;
      break;

    case "scale_out":
      values.opacity = 1 - eased;
      values.scale = 1 + 0.12 * eased;
      break;

    case "scale_punch":
      values.scale = 1 + 0.09 * amplitude * Math.sin(Math.PI * eased);
      values.opacity = Math.min(1, eased * 3);
      break;

    case "pulse": {
      // Continuous pressure, not a one-shot. Two cycles a scene is enough; more
      // reads as a warning light.
      const phase = Math.sin(Math.PI * 2 * Math.min(1, raw / (duration * Math.max(1, loops))));
      values.scale = 1 + 0.028 * amplitude * phase;
      break;
    }

    case "breathe": {
      const cycles = Math.max(1, Math.round(spec.iterations));
      const phase = 0.5 - 0.5 * Math.cos((2 * Math.PI * Math.min(1, raw / (duration * cycles))));
      values.scale = 1 + 0.014 * amplitude * phase;
      break;
    }

    case "rotate_slow":
      values.rotate = (spec.to ?? 360) * eased * 0.25;
      break;

    case "stagger_in":
      values.opacity = Math.min(1, eased * 2.2);
      values.translateY = (1 - eased) * 26 * amplitude;
      break;

    case "grid_sweep":
    case "grid_draw":
      values.drawProgress = eased;
      values.opacity = Math.min(1, eased * 3);
      break;

    case "particle_flow":
    case "path_trace":
      values.drawProgress = eased;
      values.opacity = loops > 1 ? 1 : Math.min(1, eased * 3);
      values.loopPhase = loops > 1 ? (raw / (duration * loops)) % 1 : 0;
      break;

    case "count_up":
    case "counter_tick":
      values.counterProgress = eased;
      values.opacity = Math.min(1, eased * 4);
      break;

    case "underline_sweep":
      values.drawProgress = eased;
      values.opacity = 1;
      break;

    case "highlight_sweep":
      values.drawProgress = eased;
      break;

    case "camera_push":
      values.scale = 1 + 0.045 * amplitude * eased;
      break;

    case "camera_pull":
      values.scale = 1 - 0.045 * amplitude * eased;
      break;

    case "camera_pan_left":
      values.translateX = -0.05 * amplitude * eased;
      break;

    case "camera_pan_right":
      values.translateX = 0.05 * amplitude * eased;
      break;

    case "camera_tilt":
      values.translateY = 0.05 * amplitude * eased;
      break;

    case "parallax":
      values.translateY = -0.02 * amplitude * eased;
      break;

    case "morph":
      values.scale = 1 + 0.03 * amplitude * Math.sin(Math.PI * eased);
      values.opacity = Math.min(1, eased * 2.4);
      break;

    case "shake":
      // Damped, and only for the first third: a diagram that trembles once on
      // impact and then settles.
      values.translateX = Math.sin(eased * 34) * 7 * amplitude * (1 - eased);
      values.opacity = Math.min(1, eased * 4);
      break;

    case "typewriter":
      values.drawProgress = eased;
      break;

    default: {
      const travel = TRAVEL[spec.animation] ?? TRAVEL.wipe!;
      if (travel.dx !== 0) values.translateX = travel.dx * 40 * amplitude * (1 - eased);
      if (travel.dy !== 0) values.translateY = travel.dy * 30 * amplitude * (1 - eased);
      values.opacity = travel.dx === 0 && travel.dy === 0 ? Math.min(1, eased * 2) : Math.min(1, eased * 1.6);
      break;
    }
  }

  // Anything that arrives should also be able to arrive as a spring. The
  // storyboard asks for it by naming `spring` as the easing.
  if (spec.easing === "spring" && (spec.animation === "scale_in" || spec.animation === "label_pop")) {
    values.scale = 0.9 + 0.1 * springIn({ frame: within, fps, durationInFrames: duration, profile: options.profile });
  }

  return values;
}

/** The draw state for an animation, given a path. */
export function evaluateDraw(
  spec: MotionSpec | undefined,
  d: string,
  options: EvaluateOptions,
): DrawResult | null {
  if (!spec) return null;
  const drawish = spec.animation === "draw" || spec.animation === "path_trace" || spec.animation === "grid_draw";
  if (!drawish) return null;
  const prof = profile(options.profile);
  return drawPath(d, {
    frame: options.frame,
    fps: options.fps,
    durationInFrames: Math.max(1, Math.round(spec.duration_s * options.fps * prof.durationScale)),
    easing: spec.easing,
    from: spec.from,
    to: spec.to,
    delay: Math.round(spec.delay_s * options.fps),
  });
}

export function toCss(values: AnimatedValues): string {
  const parts: string[] = [];
  if (values.translateX !== 0) parts.push(`translateX(${values.translateX.toFixed(2)}px)`);
  if (values.translateY !== 0) parts.push(`translateY(${values.translateY.toFixed(2)}px)`);
  if (values.scale !== 1) parts.push(`scale(${values.scale.toFixed(4)})`);
  if (values.rotate !== 0) parts.push(`rotate(${values.rotate.toFixed(2)}deg)`);
  return parts.length > 0 ? parts.join(" ") : "none";
}
