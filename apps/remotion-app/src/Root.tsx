/**
 * The root.
 *
 * Two compositions, and only two, because a renderer with a hundred "demo"
 * compositions is a renderer whose output nobody trusts.
 *
 *   `HealthVideo`        the deliverable: 1080x1920, portrait, no audio
 *                        assumptions baked in, duration derived from the measured
 *                        track.
 *   `HealthVideoSilent`  the same frames with the audio element removed, for
 *                        platforms that reject or re-mute a video that contains
 *                        a track, and for frame-exact visual diffing.
 *
 * `calculateMetadata` is where the duration is decided, and it is decided from the
 * *audio* rather than from a target. That ordering is the whole point of the
 * timing contract: a voice that runs long produces a longer video, and the QA
 * report says the voice was over target. It never produces a truncated video.
 */

import type { FC } from "react";
import { Composition, Folder } from "remotion";
import { HealthVideo } from "./compositions/HealthVideo.js";
import { HealthVideoSilent } from "./compositions/HealthVideoSilent.js";
import type { HealthVideoProps } from "./props.js";
import { FRAME } from "./art/spacing.js";
import { emptyProps } from "./compositions/empty-props.js";

const FPS = FRAME.fps;
const MIN_FRAMES = 1;

function durationInFramesFor(props: HealthVideoProps): number {
  // The measured track is authoritative. A deliberate hold after the last word is
  // already included in `duration_s` by the adapter, so nothing is added here.
  const seconds = Number.isFinite(props.duration_s) ? props.duration_s : 0;
  return Math.max(MIN_FRAMES, Math.round(seconds * FPS));
}

function metadata(props: HealthVideoProps) {
  return {
    durationInFrames: durationInFramesFor(props),
    fps: FPS,
    width: FRAME.width,
    height: FRAME.height,
  };
}

export const RemotionRoot: FC = () => {
  return (
    <Folder name="HealthOS">
      <Composition
        id="HealthVideo"
        component={HealthVideo}
        durationInFrames={Math.round(48 * FPS)}
        fps={FPS}
        width={FRAME.width}
        height={FRAME.height}
        defaultProps={emptyProps()}
        calculateMetadata={({ props }) => metadata(props)}
      />
      <Composition
        id="HealthVideoSilent"
        component={HealthVideoSilent}
        durationInFrames={Math.round(48 * FPS)}
        fps={FPS}
        width={FRAME.width}
        height={FRAME.height}
        defaultProps={emptyProps()}
        calculateMetadata={({ props }) => metadata(props)}
      />
    </Folder>
  );
};
