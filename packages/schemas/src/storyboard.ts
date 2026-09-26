import { z } from "zod";
import { Category, Format, HookType, Platform } from "./primitives.js";
import { ClaimSchema, ScriptWordSchema, SourceSchema } from "./content.js";

/** Motion vocabulary. Every value maps to an implementation in @hc/visuals. */
export const ANIMATIONS = [
  "fade",
  "fade_out",
  "slide_left",
  "slide_right",
  "slide_up",
  "slide_down",
  "scale_in",
  "scale_out",
  "scale_punch",
  "camera_push",
  "camera_pull",
  "camera_pan_left",
  "camera_pan_right",
  "camera_tilt",
  "parallax",
  "morph",
  "pulse",
  "draw",
  "reveal_mask",
  "wipe",
  "particle_flow",
  "path_trace",
  "count_up",
  "counter_tick",
  "label_pop",
  "highlight_sweep",
  "rotate_slow",
  "breathe",
  "shake",
  "stagger_in",
  "grid_sweep",
  "typewriter",
  "underline_sweep",
  "grid_draw",
] as const;
export const Animation = z.enum(ANIMATIONS);
export type AnimationName = z.infer<typeof Animation>;

export const TRANSITIONS = [
  "cut",
  "fade",
  "dip_to_base",
  "wipe",
  "slide",
  "push",
  "zoom_blur",
  "match_move",
  "light_leak",
  "iris",
  "paper",
] as const;
export const Transition = z.enum(TRANSITIONS);
export type TransitionName = z.infer<typeof Transition>;

/**
 * Component library names. Kept as a closed union so a storyboard can never
 * reference a component the renderer does not implement — a missing component
 * is a schema error at authoring time, not a blank frame at render time.
 */
export const COMPONENT_NAMES = [
  // anatomy
  "Brain",
  "Heart",
  "Lungs",
  "Stomach",
  "Liver",
  "Kidney",
  "Intestine",
  "Muscle",
  "Pancreas",
  "Skin",
  "BloodVessel",
  "Cell",
  "Neuron",
  "BodySilhouette",
  "SkeletalFrame",
  // science
  "Molecule",
  "Particle",
  "Receptor",
  "Hormone",
  "Neurotransmitter",
  "BloodCell",
  "Nutrient",
  "Signal",
  "Membrane",
  "Pathway",
  "Enzyme",
  "DNAHelix",
  "ATP",
  // charts
  "BarChart",
  "LineChart",
  "ComparisonBars",
  "TimelineTrack",
  "Counter",
  "PercentageRing",
  "BeforeAfter",
  "RankingBars",
  "Callout",
  "StatTile",
  // layout
  "PaperCard",
  "GlassPanel",
  "GridField",
  "SoftBlob",
  "NoiseTexture",
  "Vignette",
  "Scrim",
  "Rule",
  "ProgressTrack",
  "Badge",
  // photo
  "PhotoFrame",
  // captions / type
  "CaptionLayer",
  "LowerThird",
  "SourceCard",
  "CtaCard",
  "Wordmark",
  "BigNumber",
  "KeyValueList",
  "QuoteMark",
] as const;
export const ComponentName = z.enum(COMPONENT_NAMES);
export type ComponentNameType = z.infer<typeof ComponentName>;

export const EASINGS = [
  "linear",
  "sine_in",
  "sine_out",
  "sine_in_out",
  "quad_in",
  "quad_out",
  "quad_in_out",
  "cubic_in",
  "cubic_out",
  "cubic_in_out",
  "quart_out",
  "expo_out",
  "back_out",
  "elastic_out",
  "bounce_out",
  "spring",
] as const;
export const Easing = z.enum(EASINGS);

export const Animated = z
  .object({
    animation: Animation,
    delay_s: z.number().min(0).max(30).default(0),
    duration_s: z.number().min(0.01).max(30).default(0.6),
    easing: Easing.default("cubic_out"),
    /** Repetition for continuous motion; 1 = play once. */
    iterations: z.number().min(0).max(100000).default(1),
    amplitude: z.number().default(1),
    from: z.number().optional(),
    to: z.number().optional(),
  })
  .strict();

export type AnimatedSpec = z.infer<typeof Animated>;

export const ComponentRefSchema = z
  .object({
    component: ComponentName,
    params: z.record(z.string(), z.unknown()).default({}),
    emphasis: z.enum(["normal", "highlight", "dim", "focus"]).default("normal"),
    label: z.string().max(80).optional(),
    position: z
      .object({
        x: z.number().default(0.5),
        y: z.number().default(0.5),
        scale: z.number().min(0.05).max(4).default(1),
        rotate: z.number().min(-360).max(360).default(0),
      })
      .strict()
      .default({ x: 0.5, y: 0.5, scale: 1, rotate: 0 }),
    enter: Animated.optional(),
    exit: Animated.optional(),
    loop: Animated.optional(),
  })
  .strict();
export type ComponentRef = z.infer<typeof ComponentRefSchema>;

export const LAYER_TYPES = [
  "background",
  "texture",
  "photo",
  "component",
  "chart",
  "type",
  "overlay",
  "caption",
  "accent",
] as const;
export type LayerType = (typeof LAYER_TYPES)[number];
export const LayerType = z.enum(LAYER_TYPES);

export const LayerSchema = z
  .object({
    layer_id: z.string().min(1).max(60),
    type: LayerType,
    z: z.number().int().min(0).max(200).default(0),
    /** `component` layers use this, `photo` layers use an asset id. */
    ref: z.string().max(400).optional(),
    /** Normalised geometry within the 1080x1920 frame. */
    frame: z
      .object({
        x: z.number().min(-2).max(3).default(0.5),
        y: z.number().min(-2).max(3).default(0.5),
        w: z.number().min(0.01).max(4).default(1),
        h: z.number().min(0.01).max(4).default(1),
        anchor: z.enum(["center", "top_left", "top_center", "bottom_center", "bottom_left"]).default("center"),
      })
      .strict()
      .default({ x: 0.5, y: 0.5, w: 1, h: 1, anchor: "center" }),
    opacity: z.number().min(0).max(1).default(1),
    blend: z.enum(["normal", "multiply", "screen", "overlay", "soft_light", "color_dodge"]).default("normal"),
    /** Rounded-corner radius in px, or a percentage string of the frame width. */
    radius: z.union([z.number().min(0).max(600), z.string().max(12)]).default(0),
    params: z.record(z.string(), z.unknown()).default({}),
    enter: Animated.optional(),
    exit: Animated.optional(),
    loop: Animated.optional(),
    /** Multiplies a parent camera transform; drives parallax. */
    parallax: z.number().min(0).max(3).default(1),
  })
  .strict();
export type Layer = z.infer<typeof LayerSchema>;

export const VisualStrategy = z.enum([
  "title_card",
  "component_only",
  "diagram_led",
  "chart_led",
  "photo_led",
  "hybrid",
  "system_map",
  "comparison_split",
  "timeline_track",
  "data_mosaic",
]);
export type VisualStrategyType = z.infer<typeof VisualStrategy>;

export const SceneLayout = z.enum([
  "center",
  "lower_third",
  "upper_third",
  "left_stack",
  "right_stack",
  "split",
  "full_bleed",
  "mosaic",
  "card",
  "type_dominant",
]);
export type SceneLayoutType = z.infer<typeof SceneLayout>;

export const SceneIntent = z.enum([
  "hook",
  "setup",
  "mechanism",
  "process",
  "evidence",
  "myth_reveal",
  "comparison",
  "timeline_beat",
  "data_beat",
  "payoff",
  "caveat",
  "cta",
]);
export type SceneIntentType = z.infer<typeof SceneIntent>;

export const ChartSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("bar"),
      title: z.string().max(120).default(""),
      unit: z.string().max(40).default(""),
      data: z
        .array(
          z
            .object({
              label: z.string().max(80),
              value: z.number(),
              display: z.string().max(40).optional(),
              highlight: z.boolean().default(false),
            })
            .strict(),
        )
        .min(1)
        .max(8),
    })
    .strict(),
  z
    .object({
      kind: z.literal("line"),
      title: z.string().max(120).default(""),
      unit: z.string().max(40).default(""),
      xLabels: z.array(z.string().max(24)).min(2).max(12),
      series: z
        .array(
          z
            .object({
              name: z.string().max(60),
              color: z.string().max(40).optional(),
              values: z.array(z.number()).min(2).max(40),
            })
            .strict(),
        )
        .min(1)
        .max(3),
      /** Markers carry meaning (inflection points, thresholds). */
      markers: z
        .array(
          z.object({ at: z.number().int().min(0), label: z.string().max(60) }).strict(),
        )
        .max(6)
        .default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("comparison"),
      left: z.object({ label: z.string().max(60), value: z.number(), display: z.string().max(40).optional() }).strict(),
      right: z.object({ label: z.string().max(60), value: z.number(), display: z.string().max(40).optional() }).strict(),
      unit: z.string().max(40).default(""),
      verdict: z.string().max(160).default(""),
    })
    .strict(),
  z
    .object({
      kind: z.literal("counter"),
      value: z.number(),
      display: z.string().max(40).default(""),
      label: z.string().max(120).default(""),
      sublabel: z.string().max(160).default(""),
      prefix: z.string().max(8).default(""),
      suffix: z.string().max(12).default(""),
    })
    .strict(),
  z
    .object({
      kind: z.literal("percentage"),
      value: z.number().min(0).max(100),
      label: z.string().max(120).default(""),
      sublabel: z.string().max(200).default(""),
    })
    .strict(),
  z
    .object({
      kind: z.literal("stat_tile"),
      tiles: z
        .array(
          z
            .object({
              value: z.string().max(40),
              label: z.string().max(80),
              note: z.string().max(120).default(""),
            })
            .strict(),
        )
        .min(1)
        .max(4),
    })
    .strict(),
]);

export type ChartSpec = z.infer<typeof ChartSpecSchema>;

export const SfxName = z.enum([
  "whoosh_soft",
  "whoosh_down",
  "pop",
  "click",
  "tick",
  "whoosh_reveal",
  "impact_soft",
  "rise",
  "ambient_bed",
  "success_chime",
  "low_pulse",
  "typewriter",
]);

export const SceneSchema = z
  .object({
    scene_id: z.string().min(3).max(40),
    index: z.number().int().min(0).max(200),
    start: z.number().min(0).max(600),
    end: z.number().min(0.1).max(600),
    intent: SceneIntent,
    visual_strategy: VisualStrategy,
    layout: SceneLayout,
    palette: z.string().max(40).default("neutral"),
    narration: z.string().max(800).default(""),
    on_screen_text: z.string().max(120).nullable().default(null),
    subtext: z.string().max(200).nullable().default(null),
    /** Which claim ids this scene is allowed to speak. Empty = no claim gate. */
    claim_ids: z.array(z.string().max(60)).max(10).default([]),
    components: z.array(ComponentRefSchema).max(24).default([]),
    assets: z.array(z.string().max(80)).max(12).default([]),
    layers: z.array(LayerSchema).max(32).default([]),
    chart: ChartSpecSchema.optional(),
    animations: z.array(Animation).max(16).default([]),
    camera: z
      .object({
        push: z.number().min(0).max(1).default(0),
        pull: z.number().min(0).max(1).default(0),
        panX: z.number().min(-1).max(1).default(0),
        panY: z.number().min(-1).max(1).default(0),
        rotate: z.number().min(-15).max(15).default(0),
        /** Depth of the parallax stack, 0 = locked. */
        depth: z.number().min(0).max(2).default(0),
        easing: Easing.default("sine_in_out"),
      })
      .strict()
      .default({ push: 0, pull: 0, panX: 0, panY: 0, rotate: 0, depth: 0, easing: "sine_in_out" }),
    transition_in: Transition.default("fade"),
    transition_out: Transition.default("fade"),
    sfx: z.array(SfxName).max(6).default([]),
    /** Caption suppression for scenes where on-screen type carries the meaning. */
    captions: z.boolean().default(true),
    notes: z.string().max(600).default(""),
  })
  .strict()
  .superRefine((scene, ctx) => {
    if (scene.end <= scene.start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: `scene ${scene.scene_id}: end (${scene.end}) must be greater than start (${scene.start})`,
      });
    }
    // Scene windows are stored to two decimals, and the difference of two such
    // floats is not itself two decimals: 14.62 - 0.62 is 14.000000000000002, which
    // is greater than 14. A scene the planner had put exactly on the ceiling was
    // rejected for exceeding it, and the topic could not be built at all. The
    // tolerance is a millisecond, far below anything the pacing rule is about.
    const duration = Math.round((scene.end - scene.start) * 100) / 100;
    if (duration < 0.6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: `scene ${scene.scene_id}: duration below the 0.6s readability floor`,
      });
    }
    if (duration > 14) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: `scene ${scene.scene_id}: duration above the 14s pacing ceiling for short form`,
      });
    }
    const ids = new Set<string>();
    for (const layer of scene.layers) {
      if (ids.has(layer.layer_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers"],
          message: `duplicate layer_id "${layer.layer_id}" in ${scene.scene_id}`,
        });
      }
      ids.add(layer.layer_id);
    }
  });
export type Scene = z.infer<typeof SceneSchema>;

export const NarrationSegmentSchema = z
  .object({
    segment_id: z.string().min(2).max(40),
    scene_id: z.string().max(40),
    text: z.string().min(1).max(800),
    start_s: z.number().min(0),
    end_s: z.number().min(0),
    rate: z.number().min(0.5).max(2).default(1),
  })
  .strict();

/**
 * The five durations a narrated video actually has, kept apart on purpose.
 *
 * They are genuinely different numbers and collapsing any two of them produces a
 * bug that only shows up in a finished file. A caffeine script targets 55s, its
 * lines take 47.32s to say, the voice runs from 0.12s to 57.05s, and the WAV is
 * 57.71s long. Overloading one field to mean "the runtime" makes the gap
 * between them invisible, and the gap is exactly what decides whether the
 * closing disclaimer survives the render.
 */
export const NarrationTimingSchema = z
  .object({
    /**
     * Where `content_duration_s` came from. An estimate is a planning input and
     * a measurement is a fact; nothing downstream may confuse the two.
     */
    source: z.enum(["estimated", "measured"]).default("estimated"),
    /** What the brief asked for. A target, never an authority. */
    target_duration_s: z.number().min(0).default(0),
    /** Sum of the spoken lines, with no pauses and no silence. */
    content_duration_s: z.number().min(0).default(0),
    /** First word to last word: content plus the pauses between sentences. */
    speech_duration_s: z.number().min(0).default(0),
    /** The synthesised file. Authoritative for how long the video must be. */
    track_duration_s: z.number().min(0).default(0),
    /** Measured silence before the first word. */
    lead_s: z.number().min(0).default(0),
    /** Measured silence after the last word. */
    tail_s: z.number().min(0).default(0),
    /** Measured pause the engine inserts after a sentence. */
    sentence_pause_s: z.number().min(0).default(0),
    line_count: z.number().int().min(0).default(0),
  })
  .strict();
export type NarrationTiming = z.infer<typeof NarrationTimingSchema>;

export const NarrationSchema = z
  .object({
    voice_id: z.string().min(1).max(80),
    provider: z.string().min(1).max(40),
    /** Recorded duration of the synthesised track. */
    duration_s: z.number().min(0),
    sample_rate: z.number().int().default(48_000),
    channels: z.number().int().default(1),
    segments: z.array(NarrationSegmentSchema).max(60),
    audio_path: z.string().max(600).default(""),
    audio_hash: z.string().max(64).default(""),
    timing: NarrationTimingSchema.default({}),
    settings: z.record(z.string(), z.unknown()).default({}),
    disclosure: z.string().max(300).default(""),
  })
  .strict();
export type Narration = z.infer<typeof NarrationSchema>;

export const CaptionStyle = z.enum(["editorial", "karaoke_pop", "lower_band", "outline_slam"]);

export const CaptionSpecSchema = z
  .object({
    enabled: z.boolean().default(true),
    style: CaptionStyle.default("editorial"),
    max_words_per_line: z.number().int().min(1).max(8).default(4),
    max_chars_per_line: z.number().int().min(8).max(42).default(24),
    max_lines: z.number().int().min(1).max(3).default(2),
    /** Normalised y of the caption block centre; kept clear of platform UI. */
    y: z.number().min(0.05).max(0.95).default(0.78),
    show_speaker_label: z.boolean().default(false),
  })
  .strict();
export type CaptionSpec = z.infer<typeof CaptionSpecSchema>;

export const CaptionCueSchema = z
  .object({
    index: z.number().int().min(0),
    start_s: z.number().min(0),
    end_s: z.number().min(0),
    scene_id: z.string().max(40).optional(),
    text: z.string().min(1).max(160),
    words: z
      .array(
        z
          .object({
            text: z.string().max(60),
            start_s: z.number().min(0),
            end_s: z.number().min(0),
          })
          .strict(),
      )
      .max(12)
      .default([]),
  })
  .strict();
export type CaptionCue = z.infer<typeof CaptionCueSchema>;

export const CtaSpecSchema = z
  .object({
    enabled: z.boolean().default(true),
    text: z.string().max(200).default(""),
    kind: z.enum(["none", "follow", "save", "comment_question", "link", "series_next"]).default("none"),
    campaign_id: z.string().max(80).default(""),
    url: z.string().max(600).default(""),
    /** Platforms that require a synthetic-media disclosure on the post. */
    disclosure_required: z.array(Platform).max(4).default([]),
    disclosure_text: z.string().max(300).default(""),
  })
  .strict();
export type CtaSpec = z.infer<typeof CtaSpecSchema>;

export const PlatformMetadataSchema = z
  .object({
    platform: Platform,
    title: z.string().max(180).default(""),
    description: z.string().max(4000).default(""),
    caption: z.string().max(2200).default(""),
    hashtags: z.array(z.string().max(40)).max(12).default([]),
    category: z.string().max(60).default(""),
    disclosure: z.string().max(400).default(""),
    thumbnail_text: z.string().max(40).default(""),
    call_to_action: z.string().max(120).default(""),
    link: z.string().max(600).default(""),
  })
  .strict();
export type PlatformMetadata = z.infer<typeof PlatformMetadataSchema>;

export const MetadataSchema = z
  .object({
    slug: z.string().min(1).max(140),
    keywords: z.array(z.string().max(40)).max(20).default([]),
    source_note: z.string().max(1200).default(""),
    disclosure: z.string().max(400).default(""),
    /**
     * Complete disclaimer wording for the end card.
     *
     * The spoken narration uses a shortened form; this is the full text, so the
     * video still carries every word even though it does not speak them all.
     */
    disclaimer_full: z.string().max(600).default(""),
    per_platform: z.array(PlatformMetadataSchema).max(4).default([]),
    campaign_id: z.string().max(80).default(""),
  })
  .strict();
export type Metadata = z.infer<typeof MetadataSchema>;

export const RightsSchema = z
  .object({
    state: z.enum(["unchecked", "allowed", "review", "blocked"]).default("unchecked"),
    asset_ids: z.array(z.string()).max(200).default([]),
    disclosure_required: z.array(Platform).max(4).default([]),
    third_party_audio: z.boolean().default(false),
    licensed_stock_count: z.number().int().nonnegative().default(0),
    original_vector_count: z.number().int().nonnegative().default(0),
    third_party_voice: z.boolean().default(false),
    notes: z.array(z.string().max(400)).max(20).default([]),
  })
  .strict();
export type Rights = z.infer<typeof RightsSchema>;

export const GateFindingSchema = z
  .object({
    gate: z.enum(["technical", "visual", "content", "originality", "rights", "metadata"]),
    severity: z.enum(["critical", "major", "minor", "info"]),
    code: z.string().max(60),
    message: z.string().max(600),
    scene_id: z.string().max(40).optional(),
    remediation: z.string().max(600).default(""),
    frame_index: z.number().int().optional(),
  })
  .strict();
export type GateFinding = z.infer<typeof GateFindingSchema>;

export const QaStateSchema = z
  .object({
    decision: z.enum(["pending", "pass", "reject"]).default("pending"),
    version: z.number().int().min(1).default(1),
    findings: z.array(GateFindingSchema).max(200).default([]),
    metrics: z.record(z.string(), z.number()).default({}),
    checked_at: z.string().max(40).default(""),
  })
  .strict();
export type QaState = z.infer<typeof QaStateSchema>;

export const StoryboardSchema = z
  .object({
    storyboard_id: z.string().min(3),
    video_id: z.string().min(3),
    version: z.number().int().min(1).default(1),
    template_id: z.string().min(2).max(60),
    renderer_version: z.string().max(20),
    title: z.string().min(3).max(200),
    topic_id: z.string().min(3),
    topic: z.string().min(3).max(300),
    question: z.string().min(3).max(300),
    category: Category,
    format: Format,
    hook: z.string().min(4).max(300),
    hook_type: HookType,
    target_duration: z.number().min(10).max(120),
    duration: z.number().min(10).max(120),
    palette_id: z.string().max(40).default("neutral"),
    scenes: z.array(SceneSchema).min(2).max(24),
    assets: z.array(z.string().max(80)).max(200).default([]),
    animations: z.array(Animation).max(64).default([]),
    claims: z.array(ClaimSchema).max(40).default([]),
    sources: z.array(SourceSchema).max(30).default([]),
    narration: NarrationSchema,
    captions: CaptionSpecSchema,
    cta: CtaSpecSchema,
    metadata: MetadataSchema,
    rights: RightsSchema,
    qa: QaStateSchema,
    script_hash: z.string().length(64),
    created_at: z.string().max(40),
  })
  .strict()
  .superRefine((board, ctx) => {
    const claimIds = new Set(board.claims.map((c) => c.claim_id));
    const sourceIds = new Set(board.sources.map((s) => s.source_id));
    let cursor = 0;
    for (const [index, scene] of board.scenes.entries()) {
      if (scene.index !== index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenes", index, "index"],
          message: `scene index must match array position (${index})`,
        });
      }
      const gap = scene.start - cursor;
      if (Math.abs(gap) > 0.05) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenes", index, "start"],
          message: `scene ${scene.scene_id} starts at ${scene.start} but the previous scene ends at ${cursor.toFixed(2)} (gap ${gap.toFixed(2)}s)`,
        });
      }
      cursor = scene.end;
      for (const claimId of scene.claim_ids) {
        if (!claimIds.has(claimId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["scenes", index, "claim_ids"],
            message: `scene ${scene.scene_id} references unknown claim ${claimId}`,
          });
        }
      }
    }
    if (Math.abs(board.duration - cursor) > 0.1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["duration"],
        message: `storyboard duration ${board.duration} does not match final scene end ${cursor.toFixed(2)}`,
      });
    }
    for (const [index, claim] of board.claims.entries()) {
      for (const sourceId of claim.support) {
        if (!sourceIds.has(sourceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["claims", index, "support"],
            message: `claim ${claim.claim_id} cites unknown source ${sourceId}`,
          });
        }
      }
    }
    for (const [index, scene] of board.scenes.entries()) {
      for (const assetId of scene.assets) {
        if (!board.assets.includes(assetId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["scenes", index, "assets"],
            message: `scene ${scene.scene_id} uses asset ${assetId} that is not declared on the storyboard`,
          });
        }
      }
    }
  });

export type Storyboard = z.infer<typeof StoryboardSchema>;

export const ScriptWordList = ScriptWordSchema;


