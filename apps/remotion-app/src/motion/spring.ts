/**
 * Springs.
 *
 * Springs are used where the movement is a *thing arriving*: a marker landing on
 * a diagram, a counter settling, a figure being placed on a bar. Easing is used
 * where the movement is type or camera, because a spring on a headline reads as
 * a toy.
 *
 * Remotion's `spring` is a closed-form function of the frame, so a spring is as
 * reproducible as a cosine and needs no state. `damping` is the interesting
 * knob: below about 20 a spring oscillates, which is right for a particle
 * bouncing off a wall and wrong for almost everything else.
 */

import { spring as remotionSpring } from "remotion";
import { profile } from "./ease.js";

export interface SpringOptions {
  /** Frame within this animation's own timeline, after the delay. */
  frame: number;
  fps: number;
  durationInFrames: number;
  profile?: string;
  /** Extra looseness. 0 settles without passing the target. */
  overshoot?: number;
  /** Starting value. Defaults to 0. */
  from?: number;
  /** Resting value. Defaults to 1. */
  to?: number;
}

/** 0 before the spring starts, 1 at rest, with a small controlled overshoot. */
export function springIn(options: SpringOptions): number {
  const spec = profile(options.profile);
  const looseness = (options.overshoot ?? spec.overshoot) * 40;
  return remotionSpring({
    frame: options.frame,
    fps: options.fps,
    durationInFrames: Math.max(1, Math.round(options.durationInFrames)),
    config: {
      damping: Math.max(6, spec.damping - looseness),
      mass: 0.9,
      stiffness: 110,
    },
    from: options.from ?? 0,
    to: options.to ?? 1,
  });
}

/**
 * A spring that returns to rest. Used for emphasis that should not accumulate:
 * a marker that pushes past its target and comes back, rather than one that
 * settles and stays overshot forever.
 */
export function pulseSpring(options: SpringOptions): number {
  const settled = springIn(options);
  return 1 + (settled - 1) * 1.6;
}
