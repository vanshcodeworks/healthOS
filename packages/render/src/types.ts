import type { Storyboard } from "@hc/schemas";

/** Output geometry. Chosen by the caller, honoured exactly by the engine. */
export interface VideoSpec {
  width: number;
  height: number;
  fps: number;
  /** Constant rate factor. Lower is better quality and a bigger file. */
  crf: number;
  videoBitrate: string;
  audioBitrate: string;
}

export const DEFAULT_VIDEO_SPEC: VideoSpec = {
  width: 1080,
  height: 1920,
  fps: 30,
  crf: 18,
  videoBitrate: "8M",
  audioBitrate: "192k",
};

/** One shot on the timeline. Durations are final; the engine does not change them. */
export interface RenderScene {
  scene_id: string;
  index: number;
  start_s: number;
  end_s: number;
  duration_s: number;
  intent: string;
  headline: string;
  subtext: string;
  components: RenderComponent[];
  layout: string;
}

export interface RenderComponent {
  component: string;
  label: string;
  emphasis: string;
  position: { x: number; y: number; scale: number; rotate: number };
  params: Record<string, unknown>;
}

export interface RenderCaptionCue {
  index: number;
  start_s: number;
  end_s: number;
  text: string;
  words: { word: string; start_s: number; end_s: number }[];
}

export interface RenderAudio {
  path: string;
  duration_s: number;
  hash: string;
  sample_rate: number;
  channels: number;
}

export interface RenderProject {
  project_id: string;
  video_id: string;
  title: string;
  topic: string;
  palette_id: string;
  template_id: string;
  /** Bumped by the caller; part of the cache key so stale frames never survive. */
  renderer_version: string;
  video: VideoSpec;
  scenes: RenderScene[];
  captions: RenderCaptionCue[];
  caption_style: {
    style: string;
    y: number;
    max_lines: number;
    max_words_per_line: number;
    max_chars_per_line: number;
  };
  audio: RenderAudio;
  /** Full legal wording. The renderer shows it; it never shortens it. */
  disclaimer: string;
  cta: { enabled: boolean; kind: string; text: string };
}

/**
 * Turns a project into the markup for a single shot.
 *
 * A provider is allowed to draw whatever it likes. It is not allowed to decide
 * how long anything lasts: `RenderScene.duration_s` and the caption cue times
 * have already been decided and validated upstream.
 */
export interface FrameProvider {
  readonly id: string;
  readonly version: string;
  /** Assets resolved ahead of the browser session (fonts, images, sprites). */
  prepare?(project: RenderProject, workDir: string): Promise<void>;
  html(project: RenderProject, scene: RenderScene): string;
  /**
   * The scene's motion, evaluated after GSAP is loaded.
   *
   * Must build a paused `window.__hfTimeline` in seconds. Absent, the scene is
   * captured as a single still. Present, it is captured at `video.fps` frames
   * per second by seeking the timeline, which is what makes a shot animate
   * rather than sit.
   */
  bootScript?(project: RenderProject, scene: RenderScene): string;
}

export interface RenderOutput {
  /** Directory for frames and intermediate files. Reused on retry. */
  workDir: string;
  /** Final muxed file path. */
  videoPath: string;
}

export interface RenderResult {
  video_path: string;
  /** Measured from the finished file, not assumed from the timeline. */
  video_duration_s: number;
  audio_duration_s: number;
  width: number;
  height: number;
  bytes: number;
  frames: number;
  renderer_id: string;
  renderer_version: string;
  cache_hit: boolean;
  duration_ms: number;
}
export interface RenderEngine {
  readonly id: string;
  readonly version: string;
  render(project: RenderProject, output: RenderOutput): Promise<RenderResult>;
}

/** Projects a validated storyboard onto the flat shape renderers consume. */
export function toRenderProject(
  storyboard: Storyboard,
  audio: RenderAudio,
  video: VideoSpec = DEFAULT_VIDEO_SPEC,
): RenderProject {
  const captions = storyboard.narration.segments
    .filter((s) => s.text.trim().length > 0)
    .map((segment, i) => ({
      index: i,
      start_s: segment.start_s,
      end_s: segment.end_s,
      text: segment.text,
      words: [],
    }));

  return {
    project_id: storyboard.storyboard_id,
    video_id: storyboard.video_id,
    title: storyboard.title,
    topic: storyboard.topic,
    palette_id: storyboard.palette_id,
    template_id: storyboard.template_id,
    renderer_version: storyboard.renderer_version,
    video,
    scenes: storyboard.scenes.map((scene, index) => ({
      scene_id: scene.scene_id,
      index,
      start_s: scene.start,
      end_s: scene.end,
      duration_s: Math.max(0, scene.end - scene.start),
      intent: scene.intent,
      headline: scene.on_screen_text ?? "",
      subtext: scene.subtext ?? "",
      components: scene.components.map((c) => ({
        component: c.component,
        label: c.label ?? "",
        emphasis: c.emphasis,
        position: c.position,
        params: c.params,
      })),
      layout: scene.layout,
    })),
    captions,
    caption_style: {
      style: storyboard.captions.style,
      y: storyboard.captions.y,
      max_lines: storyboard.captions.max_lines,
      max_words_per_line: storyboard.captions.max_words_per_line,
      max_chars_per_line: storyboard.captions.max_chars_per_line,
    },
    audio,
    disclaimer: storyboard.metadata.disclaimer_full,
    cta: {
      enabled: storyboard.cta.enabled,
      kind: storyboard.cta.kind,
      text: storyboard.cta.text ?? "",
    },
  };
}
