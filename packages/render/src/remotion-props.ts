/**
 * The adapter.
 *
 * This is the only place a `Storyboard` becomes something a composition can read,
 * and it is the reason the scene graph and the Remotion tree cannot drift: the
 * tree has no opinion about content, and this file has no opinion about layout.
 *
 * Three things happen here and nothing else:
 *
 * 1. **Duration.** The video's length is the measured audio plus any deliberate
 *    hold. It is never a target and never trimmed to fit.
 * 2. **Grammar.** Each scene's *visual strategy* — what leads the frame — is
 *    resolved into a *composition* — how the frame is composed. The mapping is
 *    explicit and every fallback is recorded, because a video that quietly
 *    rendered six of its eight scenes as plain type is a video nobody reviewed
 *    correctly.
 * 3. **Beats.** The storyboard has no beat structure of its own; its narration
 *    segments are the beats. A segment's role comes from the scene's intent,
 *    which is truthful: within a scene, a sentence's purpose *is* the scene's.
 *
 * Note what is not here: no timing is invented, no caption is generated, no
 * number is rounded. Anything the composition needs that the storyboard does not
 * carry is left empty and reported by the QA gate, not filled in here.
 */

import { basename } from "node:path";
import type { BeatRef, HealthVideoProps } from "@hc/remotion-app/props";
import type { Storyboard } from "@hc/schemas";
import { DEFAULT_VIDEO_SPEC, type RenderAudio, type VideoSpec } from "./types.js";

type Composition = HealthVideoProps["scenes"][number]["composition"];

export interface AdapterInput {
  storyboard: Storyboard;
  audio: RenderAudio;
  video?: VideoSpec;
  /**
   * Seconds of deliberate hold after the last word, for the end card. Added to the
   * measured track; it is never taken out of it.
   */
  tailHold_s?: number;
}

export interface AdapterNote {
  scene_id: string;
  kind:
    | "grammar_fallback"
    | "chart_grammar"
    | "no_components"
    | "no_narration"
    | "unmapped_figure"
    | "chart_without_claims"
    | "scene_past_audio";
  detail: string;
}

export interface AdapterResult {
  props: HealthVideoProps;
  /** Every place the adapter could not honour the storyboard as written. */
  notes: AdapterNote[];
}

/**
 * `visual_strategy` to composition grammar.
 *
 * This is the visual-semantic decision, kept in one table on purpose. It is the
 * thing a director would argue about, so it must be legible, reviewable and
 * changeable in one place rather than scattered through components.
 *
 * The keys are the storyboard's closed `VisualStrategy` union, so this table
 * cannot drift from the schema without a type error.
 */
const STRATEGY_TO_GRAMMAR: Record<Storyboard["scenes"][number]["visual_strategy"], Composition> = {
  /** Type leads the frame and nothing else is on it. */
  title_card: "editorial_hook",
  /** One component, filling the frame, labelled. */
  component_only: "anatomy_focus",
  /** A drawn structure that carries the argument. */
  diagram_led: "scientific_diagram",
  /** Resolved from the chart's kind instead; see `grammarFor`. */
  chart_led: "big_stat",
  /** An existing illustration, cropped in. */
  photo_led: "zoom_reveal",
  /** Drawing and type together: the diagram grammar already composes both. */
  hybrid: "scientific_diagram",
  /** A set of parts with their relations, named in turn. */
  system_map: "molecular_breakdown",
  comparison_split: "comparison",
  timeline_track: "timeline",
  /** Resolved from the chart's kind instead; see `grammarFor`. */
  data_mosaic: "big_stat",
};

/** `intent` to grammar, used when a strategy needs a different frame. */
const INTENT_TO_GRAMMAR: Record<Storyboard["scenes"][number]["intent"], Composition> = {
  hook: "editorial_hook",
  setup: "editorial_hook",
  mechanism: "mechanism",
  process: "mechanism",
  evidence: "big_stat",
  myth_reveal: "cause_effect",
  comparison: "comparison",
  timeline_beat: "timeline",
  data_beat: "big_stat",
  payoff: "conclusion",
  caveat: "disclaimer",
  cta: "conclusion",
};

/** Storyboard component names this renderer can draw as a figure. */
const DRAWABLE = new Set([
  "Stomach",
  "Intestine",
  "Kidney",
  "BloodVessel",
  "Heart",
  "Brain",
  "Lungs",
  "Cell",
  "Receptor",
  "Molecule",
  "BloodCell",
  "Pathway",
  "Neuron",
  "Membrane",
]);

export function toHealthVideoProps(input: AdapterInput): AdapterResult {
  const { storyboard, audio } = input;
  const video = input.video ?? DEFAULT_VIDEO_SPEC;
  const notes: AdapterNote[] = [];
  const speech = audio.duration_s + Math.max(0, input.tailHold_s ?? 0);
  const lastSceneEnd = storyboard.scenes.at(-1)?.end ?? 0;
  // The video is the measured track plus the hold, and it is never shorter than the
  // last scene. If the track came out short, the video holds past the audio with
  // silence rather than truncating the sentence that carries the caveat. The
  // alternative is a disclaimer that stops halfway through being read, which is
  // exactly the failure this pipeline exists to prevent.
  const duration = Math.max(speech, lastSceneEnd);

  const scenes = storyboard.scenes.map((scene, index) => {
    const isLast = index === storyboard.scenes.length - 1;
    const grammar = grammarFor(scene, isLast, notes);
    if (scene.end > speech + 0.05 && audio.duration_s > 0) {
      notes.push({
        scene_id: scene.scene_id,
        kind: "scene_past_audio",
        detail:
          `scene ends at ${scene.end.toFixed(3)}s but the measured track plus hold is ${speech.toFixed(3)}s; ` +
          "nothing is cut, the video runs long and ends in silence",
      });
    }

    if (scene.components.length === 0) {
      notes.push({ scene_id: scene.scene_id, kind: "no_components", detail: "scene has no components; drawn as type" });
    } else if (!scene.chart && !scene.components.some((c) => DRAWABLE.has(c.component))) {
      // A scene whose only components are chart furniture is drawn by the chart
      // grammar, so the figure check does not apply to it. Reporting it there would
      // train a reviewer to ignore the note.
      notes.push({
        scene_id: scene.scene_id,
        kind: "unmapped_figure",
        detail: `no drawable figure among: ${scene.components.map((c) => c.component).join(", ")}`,
      });
    }

    const beats = beatsFor(scene, storyboard, index);
    if (beats.length === 0) {
      notes.push({ scene_id: scene.scene_id, kind: "no_narration", detail: "no narration segment inside this scene's window" });
    }

    return {
      scene_id: scene.scene_id,
      index,
      start_s: scene.start,
      end_s: scene.end,
      duration_s: Math.max(0, scene.end - scene.start),
      intent: scene.intent,
      visual_strategy: scene.visual_strategy,
      layout: scene.layout,
      narration: scene.narration,
      headline: scene.on_screen_text ?? "",
      subtext: scene.subtext ?? "",
      components: scene.components.map((c) => ({
        component: c.component,
        label: c.label ?? "",
        emphasis: c.emphasis,
        position: c.position,
        params: c.params,
        ...(c.enter ? { enter: c.enter } : {}),
        ...(c.exit ? { exit: c.exit } : {}),
        ...(c.loop ? { loop: c.loop } : {}),
      })),
      layers: scene.layers.map((l) => ({
        layer_id: l.layer_id,
        type: l.type,
        z: l.z,
        ...(l.ref !== undefined ? { ref: l.ref } : {}),
        frame: l.frame,
        opacity: l.opacity,
        blend: l.blend,
        radius: l.radius,
        params: l.params,
        ...(l.enter ? { enter: l.enter } : {}),
        ...(l.exit ? { exit: l.exit } : {}),
        ...(l.loop ? { loop: l.loop } : {}),
        parallax: l.parallax,
      })),
      ...(scene.chart ? { chart: chartFor(scene, notes) } : {}),
      beats,
      camera: scene.camera,
      transition_in: scene.transition_in,
      transition_out: scene.transition_out,
      captions_enabled: scene.captions && storyboard.captions.enabled,
      composition: grammar,
      // Deterministic per scene: the same storyboard always warps the same way.
      seed: seedFor(storyboard.storyboard_id, scene.scene_id),
    };
  });

  const captions = storyboard.narration.segments
    .filter((s) => s.text.trim().length > 0)
    .map((segment, index) => ({
      index,
      start_s: segment.start_s,
      end_s: segment.end_s,
      scene_id: sceneIdAt(storyboard, segment) ?? "",
      text: segment.text,
      // The storyboard carries segment times, not word alignment. The caption band
      // splits proportionally and labels the result as approximate, which is
      // better than inventing word times that look precise and are not.
      words: [],
    }))
    .filter((cue) => cue.scene_id !== "" || storyboard.scenes.length === 0);

  return {
    props: {
      project_id: storyboard.storyboard_id,
      video_id: storyboard.video_id,
      // Identity, not content: the render cache hashes the full project separately.
      storyboard_hash: `${storyboard.storyboard_id}@${storyboard.version}`,
      title: storyboard.title,
      topic: storyboard.topic,
      duration_s: duration,
      geometry: { width: video.width, height: video.height, fps: video.fps },
      palette_id: storyboard.palette_id,
      // The format is authored, so the family's motion character is authored too.
      style_family: storyboard.format,
      scenes,
      captions,
      caption_style: {
        style: storyboard.captions.style,
        y: storyboard.captions.y,
        max_lines: storyboard.captions.max_lines,
        max_words_per_line: storyboard.captions.max_words_per_line,
        max_chars_per_line: storyboard.captions.max_chars_per_line,
      },
      audio: {
        /** Resolved against the bundle's staged public directory by the engine. */
        src: basename(audio.path),
        duration_s: audio.duration_s,
        hash: audio.hash,
        sample_rate: audio.sample_rate,
        channels: audio.channels,
      },
      disclaimer: storyboard.metadata.disclaimer_full,
      cta: {
        enabled: storyboard.cta.enabled,
        kind: storyboard.cta.kind,
        text: storyboard.cta.text ?? "",
      },
      renderer_version: storyboard.renderer_version,
      seed: seedFor(storyboard.storyboard_id, "project"),
    },
    notes,
  };
}

/**
 * Grammar selection.
 *
 * Four rules, in order:
 *
 * - The end card is never improvised. A scene whose intent is a caveat is the
 *   disclaimer and one whose intent is a call to action is the conclusion,
 *   wherever it sits in the video, because the legal wording and the outro are the
 *   two things a channel must not vary. A CTA in the second-to-last position is
 *   still a CTA.
 * - A strategy that leads with a chart resolves to the grammar that *kind* of
 *   chart needs. A bar chart and a single number are both "chart led" upstream
 *   and are entirely different frames, and pretending otherwise is what produces
 *   a bar chart rendered as a giant number.
 * - Otherwise the visual strategy decides.
 * - Otherwise the intent decides, and a fallback is recorded.
 */
function grammarFor(
  scene: Storyboard["scenes"][number],
  isLast: boolean,
  notes: AdapterNote[],
): Composition {
  if (scene.intent === "caveat") return "disclaimer";
  if (scene.intent === "cta" || scene.intent === "payoff") return "conclusion";
  // The final frame closes the video. If it carries evidence it stays as it is;
  // if it carries nothing, it is an outro.
  if (isLast && !scene.chart && scene.components.length === 0) return "conclusion";

  const kind = scene.chart?.kind;
  if (scene.visual_strategy === "chart_led" || scene.visual_strategy === "data_mosaic") {
    if (!kind) {
      notes.push({ scene_id: scene.scene_id, kind: "grammar_fallback", detail: `${scene.visual_strategy} with no chart; drawn as a figure` });
      return "scientific_diagram";
    }
    if (kind === "bar" || kind === "line" || kind === "comparison") {
      return "comparison";
    }
    return "big_stat";
  }

  const byStrategy = STRATEGY_TO_GRAMMAR[scene.visual_strategy];
  if (byStrategy) {
    // A figure grammar needs something to draw. With no chart and no drawable
    // component there is nothing to draw, and picking a figure anyway would put an
    // organ in the video that the storyboard never named. `scientific_diagram`
    // already has a typographic branch for a frame with no figure, so a scene
    // that lost its figure lands there instead of on a guess. The `no_components`
    // or `unmapped_figure` note above is what makes this visible in review.
    const needsFigure =
      byStrategy === "anatomy_focus" || byStrategy === "zoom_reveal" || byStrategy === "scientific_diagram";
    if (needsFigure && !scene.chart && !scene.components.some((c) => DRAWABLE.has(c.component))) {
      return "scientific_diagram";
    }
    return byStrategy;
  }

  notes.push({
    scene_id: scene.scene_id,
    kind: "grammar_fallback",
    detail: `no grammar for visual_strategy "${scene.visual_strategy}"; used intent "${scene.intent}"`,
  });
  return INTENT_TO_GRAMMAR[scene.intent] ?? "editorial_hook";
}

function chartFor(
  scene: Storyboard["scenes"][number],
  notes: AdapterNote[],
): NonNullable<HealthVideoProps["scenes"][number]["chart"]> {
  const chart = scene.chart!;
  // Every number on screen is bound to a claim. A chart that arrives unbound is
  // reported, and the claim list stays empty so the QA gate can refuse the frame
  // rather than this adapter refusing to render it.
  if (scene.claim_ids.length === 0) {
    notes.push({
      scene_id: scene.scene_id,
      kind: "chart_without_claims",
      detail: "chart has no claim ids; the numbers on screen are not evidence-bound",
    });
  }
  return { ...chart, claim_ids: scene.claim_ids };
}

function beatsFor(scene: Storyboard["scenes"][number], storyboard: Storyboard, sceneIndex: number) {
  const inside = storyboard.narration.segments.filter(
    (s) => s.text.trim().length > 0 && s.start_s >= scene.start - 0.01 && s.start_s < scene.end,
  );
  return inside.map((segment, i) => ({
    beat_id: `${scene.scene_id}-b${i + 1}`,
    text: segment.text,
    start_s: segment.start_s,
    end_s: segment.end_s,
    local_start_s: Math.max(0, segment.start_s - scene.start),
    local_end_s: Math.max(0, segment.end_s - scene.start),
    role: roleFor(scene.intent, i, inside.length, sceneIndex),
    // No reviewed emphasis signal exists upstream, so none is claimed here.
    emphasis_words: [],
    pause_after_s: 0,
  }));
}

function roleFor(intent: string, i: number, total: number, sceneIndex: number): BeatRef["role"] {
  if (intent === "caveat" || intent === "cta") return "conclusion";
  if (i === 0) return sceneIndex === 0 ? "hook" : "setup";
  if (i === total - 1) return "reveal";
  if (intent === "comparison") return "contrast";
  if (intent === "evidence" || intent === "data_beat") return "statistic";
  return "explanation";
}

function sceneIdAt(storyboard: Storyboard, segment: Storyboard["narration"]["segments"][number]): string | null {
  // The segment carries the scene it belongs to. The time lookup is the fallback
  // for a segment whose scene id no longer exists in the scene list.
  if (storyboard.scenes.some((s) => s.scene_id === segment.scene_id)) return segment.scene_id;
  for (const scene of storyboard.scenes) {
    if (segment.start_s >= scene.start - 0.01 && segment.start_s < scene.end) return scene.scene_id;
  }
  return null;
}

/** FNV-1a. Small, stable, and identical on every platform. */
export function seedFor(projectId: string, sceneId: string): number {
  let hash = 0x811c9dc5;
  const input = `${projectId}:${sceneId}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100000;
}
