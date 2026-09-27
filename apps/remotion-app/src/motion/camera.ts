/**
 * Camera.
 *
 * A camera that moves because the scene is static is the most common reason a
 * generated video feels restless. So the camera has one job: to make a
 * composition's *hierarchy* legible over time. A slow push says "this is the
 * important thing". A lateral drift follows a moving subject. A focus shift
 * moves attention from a label to the thing the label points at.
 *
 * Magnitudes are fractions of the frame. `push: 0.04` is a 4% push over the
 * whole scene, which on a 14s shot is barely perceptible frame to frame and
 * obvious over the shot. Anything past 0.08 is a move that has to be justified.
 *
 * The camera also never overshoots or bounces, and it never moves during a hold.
 */

import { ease } from "./ease.js";
import type { CameraSpec } from "../props.js";

export interface CameraState {
  scale: number;
  translateX: number;
  translateY: number;
  rotate: number;
  /** Per-layer scale multiplier for parallax, keyed by depth. */
  parallaxScale: (depth: number) => number;
}

export interface CameraOptions {
  /** Frame within the scene. */
  frame: number;
  fps: number;
  /** Scene length in frames. */
  durationInFrames: number;
  camera: CameraSpec;
  /** Frames of hold at the start before any movement. */
  leadInFrames?: number;
  /** Frames of hold at the end. */
  leadOutFrames?: number;
  /** The scene's motion profile, which scales how fast the move happens. */
  profile?: string;
}

export function cameraState(options: CameraOptions): CameraState {
  const { frame, fps, durationInFrames, camera } = options;
  const leadIn = options.leadInFrames ?? Math.round(0.25 * fps);
  const leadOut = options.leadOutFrames ?? Math.round(0.35 * fps);
  const travel = Math.max(1, durationInFrames - leadIn - leadOut);

  // A scene with no camera intent is held dead still. This is the default and
  // it is deliberate: stillness is a choice, and it is usually the right one.
  const active =
    camera.push > 0 || camera.pull > 0 || camera.panX !== 0 || camera.panY !== 0 || camera.rotate !== 0;
  const t = active
    ? ease(camera.easing, Math.min(1, Math.max(0, (frame - leadIn) / travel)))
    : 0;

  const scale = 1 + camera.push * t - camera.pull * t;
  const translateX = camera.panX * 0.06 * t;
  const translateY = camera.panY * 0.06 * t;
  const rotate = camera.rotate * 0.35 * t;
  const depth = camera.depth;

  return {
    scale,
    translateX,
    translateY,
    rotate,
    /**
     * Parallax: a layer at `depth` moves proportionally faster than the camera.
     * `camera.depth` is the strength of the whole stack, normalised against the
     * nominal 8 — so a storyboard that asks for a shallow scene gets a flatter,
     * more printed frame, and one that asks for a deep scene gets layers that
     * clearly separate. A layer at 0 is locked to the camera, which is how a
     * background plate stays put under a push.
     */
    parallaxScale: (layerDepth: number) => 1 + (scale - 1) * layerDepth * (depth / NOMINAL_DEPTH),
  };
}

/** The scene depth at which the documented parallax feel applies. */
export const NOMINAL_DEPTH = 8;

/** The CSS transform for a camera state. `transform-origin` is set separately. */
export function cameraTransform(state: CameraState): string {
  const parts: string[] = [];
  if (state.scale !== 1) parts.push(`scale(${state.scale.toFixed(5)})`);
  if (state.translateX !== 0) parts.push(`translateX(${(state.translateX * 100).toFixed(3)}%)`);
  if (state.translateY !== 0) parts.push(`translateY(${(state.translateY * 100).toFixed(3)}%)`);
  if (state.rotate !== 0) parts.push(`rotate(${state.rotate.toFixed(4)}deg)`);
  return parts.length > 0 ? parts.join(" ") : "none";
}

/**
 * How much of a scene the camera is using. A composition whose camera consumes
 * more than this fraction of the safe width is not going to fit, and the layout
 * code clamps rather than letting content leave the frame.
 */
export function cameraHeadroom(camera: CameraSpec): number {
  return Math.max(camera.push, camera.pull) + Math.abs(camera.panX) * 0.5 + Math.abs(camera.panY) * 0.5;
}
