import { deterministicId, estimateSpeechMs, hashContent, RENDERER_VERSION } from "@hc/core";
import {
  CaptionSpecSchema,
  CtaSpecSchema,
  MetadataSchema,
  NarrationSchema,
  NarrationTimingSchema,
  parse,
  QaStateSchema,
  RightsSchema,
  StoryboardSchema,
  type Claim,
  type FormatId,
  type Source,
  type Storyboard,
} from "@hc/schemas";
import type { ScriptDraft } from "@hc/script";
import { planScenes, type PlanScenesOptions } from "./plan.js";
import { round2 } from "./timing.js";

/**
 * Shortest window a spoken line is given.
 *
 * A one-word line still needs long enough to be read at a glance; a zero-length
 * caption segment renders as a flash, which reads as a glitch rather than text.
 */
const MIN_NARRATION_SEGMENT_S = 0.4;

/** Three decimals: enough for a frame, and short enough to compare in a diff. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface BuildStoryboardInput {
  draft: ScriptDraft;
  claims: Claim[];
  sources: Source[];
  topic: string;
  question: string;
  category: Storyboard["category"];
  format: FormatId;
  templateId?: string;
  paletteId?: string;
  videoId?: string;
  voice?: { voice_id: string; provider: string; disclosure?: string };
  captionStyle?: Storyboard["captions"]["style"];
  ctaKind?: Storyboard["cta"]["kind"];
  ctaText?: string;
  keywords?: string[];
  sourceNote?: string;
  disclosure?: string;
  /** Full disclaimer wording for the end card; narration uses the short form. */
  disclaimerFull?: string;
  campaignId?: string;
  plan?: PlanScenesOptions;
  /**
   * Measured narration duration per scene, in scene order.
   *
   * Supplied by the TTS stage once real audio exists. Left out, the calibrated
   * estimator is used, which is accurate enough to plan a video and not accurate
   * enough to describe a finished one. The distinction is recorded on the
   * narration so nothing downstream mistakes one for the other.
   */
  narrationSpeechS?: number[];
  /**
   * Duration of the synthesised track in seconds.
   *
   * The audio is authoritative. When it is longer than the target, the video is
   * built to the audio rather than the audio trimmed to the target, because the
   * thing at the end of the track is the disclaimer.
   */
  trackDurationS?: number;
  /** Measured silence before the first word, in seconds. */
  leadS?: number;
  /** Measured silence after the last word, in seconds. */
  tailS?: number;
  /** Measured pause the engine inserts after a sentence, in seconds. */
  sentencePauseS?: number;
  /** Where the synthesised track was written. */
  audioPath?: string;
  /** Hash of the synthesised track, so a cached render can be invalidated. */
  audioHash?: string;
}

export interface BuildStoryboardResult {
  storyboard: Storyboard;
  warnings: string[];
}

/**
 * Assemble a full storyboard.
 *
 * The result is validated against the schema before it is returned. A storyboard
 * that does not parse is not a storyboard with problems, it is not a storyboard:
 * the renderer would happily draw a broken timeline, so the failure belongs here
 * where it can stop the pipeline.
 */
export function buildStoryboard(input: BuildStoryboardInput): BuildStoryboardResult {
  const warnings: string[] = [];
  const supplied = input.narrationSpeechS;
  const hasMeasured = Array.isArray(supplied) && supplied.length > 0;

  // Scene order is only knowable once the plan exists, and the measured
  // durations arrive indexed by scene. So the first pass establishes the order
  // with estimates, and the second pass re-plans the timeline against the real
  // audio. Without that second pass the shots are sized for an estimate while
  // the captions are sized for the recording, and the two disagree by however
  // much the estimate was wrong.
  let plan = planScenes(input.draft, input.claims, input.plan ?? {});
  if (hasMeasured && supplied.length === plan.scenes.length) {
    const measuredByText = new Map<string, number>();
    plan.scenes.forEach((scene, index) => {
      const seconds = supplied[index];
      if (seconds !== undefined && seconds > 0 && !measuredByText.has(scene.narration)) {
        measuredByText.set(scene.narration, seconds);
      }
    });
    const base = input.plan ?? {};
    plan = planScenes(input.draft, input.claims, {
      ...base,
      speechSeconds: (text) => measuredByText.get(text) ?? estimateSpeechMs(text) / 1000,
    });
  }
  warnings.push(...plan.warnings);

  if (plan.scenes.length < 2) {
    throw new Error(
      `Storyboard needs at least two scenes to be watchable; got ${plan.scenes.length}. The script has too little reviewed material.`,
    );
  }

  const usedClaimIds = new Set(plan.scenes.flatMap((s) => s.claim_ids));
  const usedClaims = input.claims.filter((c) => usedClaimIds.has(c.claim_id));
  const usedSourceIds = new Set(usedClaims.flatMap((c) => c.support));
  const usedSources = input.sources.filter((s) => usedSourceIds.has(s.source_id));

  const scriptHash = hashContent({
    draft: input.draft,
    claims: usedClaims,
    template: input.templateId ?? "editorial_v1",
    renderer: RENDERER_VERSION,
  });

  const videoId = input.videoId ?? deterministicId("vid", `${input.draft.slug}:${scriptHash.slice(0, 16)}`);
  const duration = round2(plan.scenes[plan.scenes.length - 1]?.end ?? 0);

  // Narration windows follow how long the line takes to say, not a flat guess.
  // A fixed one-second window made every caption cut before the sentence ended,
  // and a caption that desynchronises from the voice is worse than no caption.
  const measured = input.narrationSpeechS;
  const usingMeasured =
    Array.isArray(measured) && measured.length > 0 && measured.length === plan.scenes.length;
  const narrationSegments = plan.scenes.map((scene, index) => {
    const speech = usingMeasured
      ? (measured[index] ?? 0)
      : estimateSpeechMs(scene.narration) / 1000;
    return {
      segment_id: `${scene.scene_id}_seg`,
      scene_id: scene.scene_id,
      text: scene.narration,
      start_s: round2(scene.start),
      // Clipped to the scene so a caption never outlives its own shot, and given
      // a floor so an instantaneous line still gets a readable caption.
      end_s: round2(
        Math.min(scene.end, scene.start + Math.max(speech, MIN_NARRATION_SEGMENT_S)),
      ),
      rate: 1,
    };
  });

  // Every duration a narrated video has, recorded separately so a reader can see
  // exactly why the file is the length it is.
  const contentDurationS = round3(
    narrationSegments.reduce((sum, s) => sum + Math.max(0, s.end_s - s.start_s), 0),
  );
  const trackDurationS = input.trackDurationS ?? 0;
  const leadS = input.leadS ?? 0;
  const tailS = input.tailS ?? 0;
  const timing = NarrationTimingSchema.parse({
    source: usingMeasured ? "measured" : "estimated",
    target_duration_s: round3(input.draft.target_ms / 1000),
    content_duration_s: contentDurationS,
    // With a real track, the spoken span is what lies between the first and the
    // last word. Without one, the content sum is the best available answer.
    speech_duration_s: round3(
      trackDurationS > 0 ? Math.max(0, trackDurationS - leadS - tailS) : contentDurationS,
    ),
    track_duration_s: round3(trackDurationS),
    lead_s: round3(leadS),
    tail_s: round3(tailS),
    sentence_pause_s: round3(input.sentencePauseS ?? 0),
    line_count: narrationSegments.length,
  });

  const cta = CtaSpecSchema.parse({
    enabled: Boolean(input.ctaText ?? input.draft.cta),
    kind: input.ctaKind ?? (input.draft.cta ? "follow" : "none"),
    text: input.ctaText ?? input.draft.cta,
    ...(input.campaignId ? { campaign_id: input.campaignId } : {}),
  });

  const sourceNote =
    input.sourceNote ??
    `Sources: ${usedSources.map((s) => `${s.title} (${s.publisher})`).join("; ")}`.slice(0, 1200);

  const disclosure = input.disclosure ?? "";

  const raw = {
    storyboard_id: deterministicId("sb", scriptHash),
    video_id: videoId,
    version: 1,
    template_id: input.templateId ?? "editorial_v1",
    renderer_version: RENDERER_VERSION,
    title: input.draft.hook.slice(0, 200),
    topic_id: input.draft.topic_id,
    topic: input.topic,
    question: input.question,
    category: input.category,
    format: input.format,
    hook: input.draft.hook.slice(0, 300),
    hook_type: input.draft.hook_type,
    target_duration: round2(input.draft.target_ms / 1000),
    duration,
    palette_id: input.paletteId ?? plan.scenes[0]?.palette ?? "neutral",
    scenes: plan.scenes,
    assets: [],
    animations: [...new Set(plan.scenes.flatMap((s) => s.animations))],
    claims: usedClaims,
    sources: usedSources,
    narration: NarrationSchema.parse({
      voice_id: input.voice?.voice_id ?? "mock",
      provider: input.voice?.provider ?? "mock",
      // Zero until a track exists, and the real length once one does.
      duration_s: round3(input.trackDurationS ?? 0),
      segments: narrationSegments,
      disclosure: input.voice?.disclosure ?? "",
      audio_path: input.audioPath ?? "",
      audio_hash: input.audioHash ?? "",
      timing,
    }),
    captions: CaptionSpecSchema.parse({
      style: input.captionStyle ?? "editorial",
    }),
    cta,
    metadata: MetadataSchema.parse({
      slug: input.draft.slug,
      keywords: input.keywords ?? [],
  source_note: sourceNote,
  disclosure,
  // The spoken disclaimer is short; the end card carries the whole sentence.
  disclaimer_full: input.disclaimerFull ?? "",
      ...(input.campaignId ? { campaign_id: input.campaignId } : {}),
    }),
    rights: RightsSchema.parse({}),
    qa: QaStateSchema.parse({ decision: "pending" }),
    script_hash: scriptHash,
    created_at: new Date().toISOString(),
  };

  const storyboard = parse(StoryboardSchema, raw);
  return { storyboard, warnings };
}

/**
 * Every number that will appear on screen, and whether a reviewer approved it.
 *
 * Two different standards apply, because quoting and asserting are different acts.
 *
 * On-screen type is a shortened quotation of the reviewed sentence, so a number
 * that appears in that sentence is approved by the sentence itself. What is *not*
 * approved is promoting a number into a data point: a chart, counter or stat
 * tile states the figure as a measurement, so every value there must match a
 * figure the reviewer declared with a unit. That is the boundary a fabricated
 * chart would cross, and it is checked rather than assumed.
 */
export function onScreenNumbers(storyboard: Storyboard): OnScreenNumber[] {
  const out: OnScreenNumber[] = [];
  for (const scene of storyboard.scenes) {
    const claims = storyboard.claims.filter((c) => scene.claim_ids.includes(c.claim_id));
    const approvedFigures = new Set<string>();
    for (const claim of claims) {
      for (const f of claim.figures) {
        approvedFigures.add(String(f.value));
        const n = normaliseNumber(f.display);
        if (n !== null) approvedFigures.add(n);
      }
    }
    const claimProse = claims.map((c) => c.text).join(" ");

    const record = (raw: string, source: "type" | "chart") => {
      const value = normaliseNumber(raw);
      if (value === null) return;
      const isFigure = approvedFigures.has(value) || approvedFigures.has(String(Number(value)));
      // Type is approved by the reviewed prose; charts need a declared figure.
      const ok = source === "chart" ? isFigure : isFigure || claimProse.includes(raw);
      out.push({
        scene_id: scene.scene_id,
        value: raw,
        source,
        approved_by: ok ? (claims[0]?.claim_id ?? null) : null,
      });
    };

    for (const t of [scene.on_screen_text ?? "", scene.subtext ?? ""]) {
      for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) record(m[0], "type");
    }

    const chart = scene.chart;
    if (chart) {
      if (chart.kind === "counter") record(chart.display || String(chart.value), "chart");
      if (chart.kind === "percentage") record(String(chart.value), "chart");
      if (chart.kind === "bar") for (const d of chart.data) record(d.display ?? String(d.value), "chart");
      if (chart.kind === "comparison") {
        record(chart.left.display ?? String(chart.left.value), "chart");
        record(chart.right.display ?? String(chart.right.value), "chart");
      }
      if (chart.kind === "stat_tile") for (const t of chart.tiles) record(t.value, "chart");
    }
  }
  return out;
}

export interface OnScreenNumber {
  scene_id: string;
  value: string;
  source: "type" | "chart";
  /** The claim whose approved figure this number matches, or null if none does. */
  approved_by: string | null;
}

function normaliseNumber(raw: string): string | null {
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (cleaned === "") return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? String(n) : null;
}

