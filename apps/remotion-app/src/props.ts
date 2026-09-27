/**
 * The Remotion boundary.
 *
 * The scene graph in `@hc/schemas` is the source of truth and stays
 * renderer-neutral. This file is the contract between it and React: a
 * structurally-typed, JSON-serialisable projection of a validated storyboard
 * that the composition tree receives as `inputProps`.
 *
 * Two rules make this safe rather than a second, competing schema:
 *
 * 1. Nothing here is authored. Every field is derived from a `Storyboard` that
 *    has already passed Zod, by `toHealthVideoProps` in `@hc/render`. The
 *    adapter is the only writer, and a test asserts it fills this shape.
 * 2. No imports from other workspace packages. The Remotion bundle is compiled
 *    by webpack in a browser context, so a bare `@hc/*` import would have to
 *    resolve at bundle time. Keeping the contract local means the composition
 *    tree is a pure function of its props, which is also what makes the Player
 *    and the production renderer agree.
 *
 * Anything the composition needs and this file does not describe is a bug in
 * the adapter, not a reason to reach into the storyboard from a component.
 */

export interface VideoGeometry {
  width: number;
  height: number;
  fps: number;
}

/** Camera moves, normalised. Magnitudes are fractions, not pixels. */
export interface CameraSpec {
  push: number;
  pull: number;
  panX: number;
  panY: number;
  rotate: number;
  /** Depth of the parallax stack. 0 locks every layer to the camera. */
  depth: number;
  easing: string;
}

/**
 * One animation, in seconds, relative to the start of its scene.
 *
 * Remotion has no timeline objects: every animated value is a pure function of
 * the current frame. So a spec is a *duration and a shape*, and `motion/`
 * turns it into a number for a given frame. The unit stays seconds everywhere so
 * the storyboard reads the same as it always has.
 */
export interface MotionSpec {
  animation: string;
  delay_s: number;
  duration_s: number;
  easing: string;
  /** Repetition for continuous motion. 1 plays once. */
  iterations: number;
  amplitude: number;
  from?: number;
  to?: number;
}

export interface ComponentRef {
  component: string;
  label: string;
  emphasis: "normal" | "highlight" | "dim" | "focus";
  position: { x: number; y: number; scale: number; rotate: number };
  params: Record<string, unknown>;
  enter?: MotionSpec;
  exit?: MotionSpec;
  loop?: MotionSpec;
}

export interface LayerRef {
  layer_id: string;
  type: string;
  z: number;
  ref?: string;
  frame: {
    x: number;
    y: number;
    w: number;
    h: number;
    anchor: "center" | "top_left" | "top_center" | "bottom_center" | "bottom_left";
  };
  opacity: number;
  blend: string;
  radius: number | string;
  params: Record<string, unknown>;
  enter?: MotionSpec;
  exit?: MotionSpec;
  loop?: MotionSpec;
  parallax: number;
}

/**
 * A chart carries approved numbers only. `claim_ids` records which claims the
 * numbers came from, and the QA gate refuses a chart whose claims are not
 * evidence-bound, so a renderer can never be the place a figure is invented.
 */
export interface ChartRef {
  kind: "bar" | "line" | "comparison" | "counter" | "percentage" | "stat_tile";
  title?: string;
  unit?: string;
  data?: { label: string; value: number; display?: string; highlight?: boolean }[];
  xLabels?: string[];
  series?: { name: string; color?: string; values: number[] }[];
  markers?: { at: number; label: string }[];
  left?: { label: string; value: number; display?: string };
  right?: { label: string; value: number; display?: string };
  verdict?: string;
  value?: number;
  display?: string;
  label?: string;
  sublabel?: string;
  prefix?: string;
  suffix?: string;
  tiles?: { value: string; label: string; note?: string }[];
  claim_ids: string[];
}

/**
 * One narration beat inside a scene.
 *
 * The beat is what a visual action is timed against, so it carries its own
 * window rather than assuming the scene's. A beat that has not started yet must
 * not animate, and a beat that has finished holds its end state.
 */
export interface BeatRef {
  beat_id: string;
  text: string;
  start_s: number;
  end_s: number;
  /** Within the scene. */
  local_start_s: number;
  local_end_s: number;
  role:
    | "hook"
    | "setup"
    | "explanation"
    | "reveal"
    | "contrast"
    | "statistic"
    | "warning"
    | "conclusion"
    | "cta";
  /**
   * Words the narrator leans on. Optional on purpose.
   *
   * Nothing upstream produces this today, so the adapter leaves it empty rather
   * than deriving it from word length — a renderer that invents emphasis is a
   * renderer that emphasises the wrong word on the one line that mattered.
   * Typography emphasis comes from the storyboard's own `emphasis` fields, which
   * are authored, until a reviewed emphasis signal exists to fill this.
   */
  emphasis_words?: string[];
  /** Explicit silence after this beat, in seconds. Held in the timeline. */
  pause_after_s: number;
}

export interface SceneRef {
  scene_id: string;
  index: number;
  start_s: number;
  end_s: number;
  duration_s: number;
  intent: string;
  visual_strategy: string;
  layout: string;
  narration: string;
  headline: string;
  subtext: string;
  components: ComponentRef[];
  layers: LayerRef[];
  chart?: ChartRef;
  beats: BeatRef[];
  camera: CameraSpec;
  transition_in: string;
  transition_out: string;
  captions_enabled: boolean;
  /**
   * Which visual grammar this scene is drawn with. The storyboard's
   * `visual_strategy` describes what leads; this describes how the frame is
   * composed. Two scenes can share a strategy and still not look alike.
   */
  composition:
    | "editorial_hook"
    | "big_stat"
    | "scientific_diagram"
    | "anatomy_focus"
    | "mechanism"
    | "particle_flow"
    | "cause_effect"
    | "comparison"
    | "timeline"
    | "zoom_reveal"
    | "molecular_breakdown"
    | "question"
    | "conclusion"
    | "disclaimer";
  /** Deterministic seed for hand-drawn variation and particle phases. */
  seed: number;
}

export interface CaptionWord {
  text: string;
  start_s: number;
  end_s: number;
}

export interface CaptionRef {
  index: number;
  start_s: number;
  end_s: number;
  scene_id?: string;
  text: string;
  words: CaptionWord[];
}

export interface AudioRef {
  /** Path inside the Remotion `public/` staging directory. */
  src: string;
  duration_s: number;
  hash: string;
  sample_rate: number;
  channels: number;
}

export interface CtaRef {
  enabled: boolean;
  kind: string;
  text: string;
}

/**
 * The props the composition receives.
 *
 * A `type` alias rather than an `interface` on purpose: Remotion's `Composition`
 * constrains props to `Record<string, unknown>`, and only a type alias gets the
 * implicit index signature that satisfies it. An interface would need a cast at
 * every composition registration, which is exactly the kind of friction that
 * eventually becomes an `any`.
 */
export type HealthVideoProps = {
  project_id: string;
  video_id: string;
  storyboard_hash: string;
  title: string;
  topic: string;
  /** Actual measured track duration, plus any deliberate final hold. */
  duration_s: number;
  geometry: VideoGeometry;
  palette_id: string;
  style_family: string;
  /** Every scene, ordered, non-overlapping, with narration measured. */
  scenes: SceneRef[];
  captions: CaptionRef[];
  caption_style: {
    style: string;
    y: number;
    max_lines: number;
    max_words_per_line: number;
    max_chars_per_line: number;
  };
  audio: AudioRef;
  disclaimer: string;
  cta: CtaRef;
  /** Bumped whenever pixels change. Part of the render cache key. */
  renderer_version: string;
  seed: number;
};
