/**
 * The video.
 *
 * One body, and it is the whole video: the Remotion Player renders it,
 * `@remotion/renderer` renders it, and there is no second implementation. That is
 * the only way preview and production can be trusted to agree.
 *
 * Structure:
 *
 *   Audio            the measured track, at its measured length
 *   Sequences        one per scene, at the scene's measured window
 *     SceneRenderer  the scene's grammar, inside the scene's camera
 *   CaptionBand      one band, driven by the same cue list the audio was cut to
 *
 * The duration is not set here. It comes from `calculateMetadata` in `Root`, which
 * derives it from the measured track plus any deliberate final hold, so a long
 * voice produces a long video rather than a truncated one.
 *
 * The audio element lives *outside* the scaled frame, on purpose. `staticFile`
 * resolves against the bundle's public directory, and keeping the track outside the
 * scaled layer means a re-scaled preview still plays the same audio.
 */

import type { FC } from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import type { HealthVideoProps } from "../props.js";
import { paletteFor } from "../art/palette.js";
import { FRAME } from "../art/spacing.js";
import { SceneRenderer } from "./SceneRenderer.js";
import { CaptionBand } from "../components/Caption.js";
import { motionProfileFor } from "./profile.js";

export interface HealthVideoBodyProps {
  props: HealthVideoProps;
  /** `false` renders identical frames with no audio element at all. */
  audio: boolean;
}

export const HealthVideoBody: FC<HealthVideoBodyProps> = ({ props, audio }) => {
  const { fps, width, height } = useVideoConfig();
  const palette = paletteFor(props.palette_id);
  const style = motionProfileFor(props.topic, undefined, props.style_family);

  const scaleX = width / FRAME.width;
  const scaleY = height / FRAME.height;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.paper, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          width: FRAME.width,
          height: FRAME.height,
          transform: `scale(${scaleX}, ${scaleY})`,
          transformOrigin: "top left",
        }}
      >
        {props.scenes.map((scene) => {
          const from = Math.round(scene.start_s * fps);
          const length = Math.max(1, Math.round(scene.duration_s * fps));
          return (
            <Sequence key={scene.scene_id} from={from} durationInFrames={length} name={scene.scene_id} layout="none">
              <SceneRenderer
                scene={scene}
                palette={palette}
                fps={fps}
                durationInFrames={length}
                profile={style}
                seed={scene.seed}
                width={FRAME.width}
                height={FRAME.height}
                topic={props.topic}
                title={props.title}
                sceneCount={props.scenes.length}
              />
            </Sequence>
          );
        })}

        <CaptionBand
          captions={props.captions}
          palette={palette}
          fps={fps}
          scenes={props.scenes.map((s) => ({
            start_s: s.start_s,
            end_s: s.end_s,
            scene_id: s.scene_id,
            captions_enabled: s.captions_enabled,
          }))}
          style={props.caption_style}
        />
      </AbsoluteFill>

      {audio && props.audio.src ? <Audio src={staticFile(props.audio.src)} /> : null}
    </AbsoluteFill>
  );
};

export const HealthVideo: FC<HealthVideoProps> = (props) => (
  <HealthVideoBody props={props} audio />
);
