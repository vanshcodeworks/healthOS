/**
 * The camera.
 *
 * Wraps the scene's content in the scene's camera move. Every scene goes through
 * this component, including the ones with no camera intent, so that the transform
 * that gets applied is always the same one and a held frame is genuinely held
 * rather than accidentally drifting.
 *
 * `depth` on a layer makes it move at a different rate from the camera, which is
 * what produces parallax: a background diagram, a mid-ground structure and a
 * foreground label separating as the shot pushes in.
 */

import type { CSSProperties, ReactNode } from "react";
import { cameraState, cameraTransform, type CameraState } from "../motion/camera.js";
import type { CameraSpec } from "../props.js";

export interface CameraProps {
  camera: CameraSpec;
  /** Frame within the scene. */
  frame: number;
  fps: number;
  durationInFrames: number;
  children: ReactNode;
  /** Which plane this content sits on. 0 is locked to the camera. */
  depth?: number;
  profile?: string;
  leadInFrames?: number;
  leadOutFrames?: number;
  style?: CSSProperties;
  /** Anchor the transform. Centred by default. */
  origin?: string;
}

/** Exposed for tests and for QA, which needs the same numbers the frame has. */
export function useCameraState(props: {
  camera: CameraSpec;
  frame: number;
  fps: number;
  durationInFrames: number;
  profile?: string;
}): CameraState {
  const { camera, frame, fps, durationInFrames } = props;
  return cameraState({ camera, frame, fps, durationInFrames, profile: props.profile });
}

export function Camera(props: CameraProps) {
  const { camera, frame, fps, durationInFrames, children, depth = 1 } = props;
  const state = cameraState({
    camera,
    frame,
    fps,
    durationInFrames,
    profile: props.profile,
    leadInFrames: props.leadInFrames,
    leadOutFrames: props.leadOutFrames,
  });
  const scaled: CameraState = {
    ...state,
    scale: state.parallaxScale(depth),
    translateX: state.translateX * depth,
    translateY: state.translateY * depth,
    rotate: state.rotate * depth,
  };
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: cameraTransform(scaled),
        transformOrigin: props.origin ?? "50% 50%",
        willChange: "transform",
        ...props.style,
      }}
    >
      {children}
    </div>
  );
}
