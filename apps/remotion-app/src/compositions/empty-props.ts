/**
 * Default props.
 *
 * `npx remotion studio` needs something to show, and the production render path
 * needs something to call `selectComposition` with before the real props arrive.
 *
 * This is therefore a real, valid `HealthVideoProps`: two scenes, measured against
 * a six-second track, with a real caption cue and a real disclaimer. It is not a
 * placeholder card. If the default renders correctly then the contract, the scene
 * dispatch, the caption band and the audio element are all wired, which is exactly
 * what a first smoke test needs to prove — and it doubles as the fixture for the
 * blank-frame and geometry QA gates.
 *
 * A real project's props come from the adapter and always replace this.
 */

import type { CaptionRef, HealthVideoProps, SceneRef } from "../props.js";
import { FRAME } from "../art/spacing.js";

const CAMERA = {
  push: 0.018,
  pull: 0,
  panX: 0,
  panY: 0,
  rotate: 0,
  depth: 8,
  easing: "sine_in_out",
};

const BEATS = [
  {
    beat_id: "b1",
    text: "A blank frame is a failed frame.",
    start_s: 0.6,
    end_s: 3.2,
    local_start_s: 0.6,
    local_end_s: 3.2,
    role: "hook" as const,
    emphasis_words: ["blank", "failed"],
    pause_after_s: 0.2,
  },
];

const CAPTIONS: CaptionRef[] = [
  {
    index: 0,
    start_s: 0.6,
    end_s: 3.2,
    scene_id: "s1",
    text: "A blank frame is a failed frame.",
    words: [
      { text: "A", start_s: 0.6, end_s: 0.9 },
      { text: "blank", start_s: 0.9, end_s: 1.4 },
      { text: "frame", start_s: 1.4, end_s: 1.9 },
      { text: "is", start_s: 1.9, end_s: 2.1 },
      { text: "a", start_s: 2.1, end_s: 2.3 },
      { text: "failed", start_s: 2.3, end_s: 2.9 },
      { text: "frame.", start_s: 2.9, end_s: 3.2 },
    ],
  },
];

const SCENES: SceneRef[] = [
  {
    scene_id: "s1",
    index: 0,
    start_s: 0,
    end_s: 3.6,
    duration_s: 3.6,
    intent: "hook",
    visual_strategy: "typographic",
    layout: "left-aligned stack",
    narration: "A blank frame is a failed frame.",
    headline: "A blank frame is a failed frame.",
    subtext: "If nothing is drawn, the render failed and the QA gate should have said so.",
    components: [],
    layers: [],
    beats: BEATS,
    camera: CAMERA,
    transition_in: "fade",
    transition_out: "cut",
    captions_enabled: true,
    composition: "editorial_hook",
    seed: 1011,
  },
  {
    scene_id: "s2",
    index: 1,
    start_s: 3.6,
    end_s: 6,
    duration_s: 2.4,
    intent: "caveat",
    visual_strategy: "typographic",
    layout: "bottom-weighted",
    narration: "This channel checks its own work first.",
    headline: "",
    subtext:
      "Educational use only. Not medical advice. Every figure on this channel is bound to a cited claim in its project record, and the sources are listed there.",
    components: [],
    layers: [],
    beats: [
      {
        beat_id: "b2",
        text: "This channel checks its own work first.",
        start_s: 3.8,
        end_s: 5.6,
        local_start_s: 0.2,
        local_end_s: 2,
        role: "conclusion" as const,
        emphasis_words: ["checks"],
        pause_after_s: 0.2,
      },
    ],
    camera: CAMERA,
    transition_in: "dip_to_base",
    transition_out: "cut",
    captions_enabled: false,
    composition: "disclaimer",
    seed: 2022,
  },
];

export function emptyProps(): HealthVideoProps {
  return {
    project_id: "project_default",
    video_id: "video_default",
    storyboard_hash: "default",
    title: "default composition",
    topic: "why a blank frame is a failed frame",
    duration_s: 6,
    geometry: { width: FRAME.width, height: FRAME.height, fps: FRAME.fps },
    palette_id: "neutral",
    style_family: "editorial",
    scenes: SCENES,
    captions: CAPTIONS,
    caption_style: {
      style: "clean_plate",
      y: 0.86,
      max_lines: 2,
      max_words_per_line: 7,
      max_chars_per_line: 34,
    },
    audio: {
      src: "narration.wav",
      duration_s: 6,
      hash: "default",
      sample_rate: 48000,
      channels: 1,
    },
    disclaimer: "Educational use only. Not medical advice.",
    cta: { enabled: false, kind: "none", text: "" },
    renderer_version: "1.0.0+remotion",
    seed: 7,
  };
}
