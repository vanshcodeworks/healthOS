import { z } from "zod";
import { Category, EvidenceLevel, Format, Platform, SourceType } from "./primitives.js";
import { IsoDateTime } from "./primitives.js";

export const LICENSE_KINDS = [
  "own_original",
  "generated_vector",
  "cc0",
  "public_domain",
  "pexels_license",
  "pixabay_content_license",
  "unsplash_license",
  "cc_by_4",
  "cc_by_nc_4",
  "cc_by_sa_4",
  "purchased_stock",
  "user_owned",
  "platform_audio_library",
  "unknown",
] as const;
export const LicenseKind = z.enum(LICENSE_KINDS);
export type LicenseKindType = z.infer<typeof LicenseKind>;

/** Licences that permit commercial use in monetised content. */
export const COMMERCIAL_LICENSES: ReadonlySet<LicenseKindType> = new Set([
  "own_original",
  "generated_vector",
  "cc0",
  "public_domain",
  "pexels_license",
  "pixabay_content_license",
  "unsplash_license",
  "cc_by_4",
  "cc_by_sa_4",
  "purchased_stock",
  "user_owned",
  "platform_audio_library",
]);

/** Licences usable only in non-commercial contexts — blocked for ad revenue. */
export const NON_COMMERCIAL_LICENSES: ReadonlySet<LicenseKindType> = new Set(["cc_by_nc_4"]);

export const AssetSchema = z
  .object({
    asset_id: z.string().min(3).max(80),
    provider: z.string().min(1).max(60),
    provider_ref: z.string().max(200).optional(),
    kind: z.enum(["photo", "video", "svg", "audio", "font", "generated"]),
    role: z.enum(["visual_layer", "background", "textural", "accent", "sfx", "music", "voice", "font"]),
    local_path: z.string().min(1),
    content_hash: z.string().length(64),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    duration_seconds: z.number().min(0).optional(),
    bytes: z.number().int().nonnegative().default(0),
    title: z.string().max(200).default(""),
    creator: z.string().max(160).optional(),
    source_url: z.string().max(600).optional(),
    license: LicenseKind,
    license_url: z.string().max(600).optional(),
    license_evidence: z
      .object({
        captured_at: z.string().max(40).default(""),
        snapshot_hash: z.string().max(64).default(""),
        note: z.string().max(400).default(""),
      })
      .strict()
      .default({ captured_at: "", snapshot_hash: "", note: "" }),
    attribution: z.string().max(400).default(""),
    commercial_use: z.boolean().default(false),
    redistribution: z.boolean().default(false),
    content_safety: z.enum(["verified", "flagged", "unknown"]).default("unknown"),
    downloaded_at: z.string().max(40).optional(),
    expires_at: z.string().max(40).optional(),
    tags: z.array(z.string().max(50)).max(30).default([]),
    /** Reuse counter for the asset planner. */
    use_count: z.number().int().nonnegative().default(0),
  })
  .strict();

export type Asset = z.infer<typeof AssetSchema>;

export const AssetPlanItemSchema = z
  .object({
    slot: z.string().min(1).max(60),
    scene_id: z.string().max(40),
    strategy: z.enum([
      "procedural",
      "component",
      "user_owned",
      "stock_photo",
      "stock_video",
      "scientific_illustration",
      "generated_art",
      "audio_synth",
    ]),
    /** Search intent for the asset agent, used by stock providers. */
    query: z.string().max(200).default(""),
    component: z.string().max(60).optional(),
    required: z.boolean().default(true),
    rationale: z.string().max(400).default(""),
    /** Whether a materially similar asset has been used in previous videos. */
    reuse_preference: z.enum(["prefer_reuse", "balanced", "must_be_unique"]).default("balanced"),
  })
  .strict();

export const AssetPlanSchema = z
  .object({
    video_id: z.string().min(3),
    items: z.array(AssetPlanItemSchema).max(200),
    /** Assets the plan expects to be available offline after acquisition. */
    required_external: z.array(z.string().max(80)).max(40).default([]),
    notes: z.array(z.string().max(300)).max(20).default([]),
  })
  .strict();

export type AssetPlan = z.infer<typeof AssetPlanSchema>;

export const RightsAuditEntrySchema = z
  .object({
    id: z.string().min(3),
    subject_type: z.enum(["video", "asset"]),
    subject_id: z.string().min(3),
    event: z.enum(["registered", "verified", "rejected", "published", "expired", "flagged"]),
    decision: z.enum(["allow", "block", "review"]),
    reason: z.string().max(600),
    evidence: z.record(z.string(), z.unknown()).default({}),
    actor: z.string().max(60).default("system"),
    created_at: IsoDateTime,
  })
  .strict();

export type RightsAuditEntry = z.infer<typeof RightsAuditEntrySchema>;

export const JobSchema = z
  .object({
    job_id: z.string().min(3),
    kind: z.enum(["video", "topic", "system", "publish", "analytics"]),
    video_id: z.string().max(80).optional(),
    topic_id: z.string().max(80).optional(),
    stage: z.string().min(2).max(40),
    status: z.enum(["pending", "running", "retry_wait", "done", "failed", "cancelled"]),
    priority: z.number().int().min(0).max(1000).default(100),
    idempotency_key: z.string().min(4).max(200),
    payload: z.record(z.string(), z.unknown()).default({}),
    attempt: z.number().int().min(0).default(0),
    max_attempts: z.number().int().min(1).max(50).default(5),
    last_error: z
      .object({
        category: z.string().max(40),
        message: z.string().max(2000),
        remediation: z.string().max(600).default(""),
        details: z.record(z.string(), z.unknown()).default({}),
        at: z.string().max(40),
      })
      .nullable()
      .default(null),
    next_attempt_at: z.string().max(40).nullable().default(null),
    progress: z.number().min(0).max(1).default(0),
    result: z.record(z.string(), z.unknown()).default({}),
    created_at: IsoDateTime,
    updated_at: IsoDateTime,
    started_at: z.string().max(40).nullable().default(null),
    finished_at: z.string().max(40).nullable().default(null),
  })
  .strict();

export type Job = z.infer<typeof JobSchema>;

export const TrendSignalSchema = z
  .object({
    provider: z.string().min(1).max(60),
    label: z.string().max(200),
    strength: z.number().min(0).max(1),
    observed_at: IsoDateTime,
    detail: z.string().max(600).default(""),
  })
  .strict();

export type TrendSignal = z.infer<typeof TrendSignalSchema>;

export const DiscoveredTopicSchema = z
  .object({
    title: z.string().min(3).max(200),
    question: z.string().min(3).max(300),
    category: Category,
    suggested_format: Format,
    origin: z.string().min(1).max(60),
    origin_ref: z.string().max(500).optional(),
    keywords: z.array(z.string().max(60)).max(20).default([]),
    trend: TrendSignalSchema.optional(),
    evidence_hint: z
      .object({
        evidence_level: EvidenceLevel.default("unrated"),
        source_url: z.string().max(600).optional(),
        source_title: z.string().max(300).optional(),
        publisher: z.string().max(120).optional(),
        source_type: SourceType.optional(),
        study_design: z.string().max(60).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type DiscoveredTopic = z.infer<typeof DiscoveredTopicSchema>;

export const AnalyticsRowSchema = z
  .object({
    platform_post_id: z.string().min(3),
    video_id: z.string().min(3),
    platform: Platform,
    measured_at: IsoDateTime,
    window_start: IsoDateTime,
    window_end: IsoDateTime,
    views: z.number().nonnegative().default(0),
    watch_time_seconds: z.number().nonnegative().default(0),
    avg_percent_viewed: z.number().nullable().default(null),
    retention_25: z.number().nullable().default(null),
    retention_50: z.number().nullable().default(null),
    retention_75: z.number().nullable().default(null),
    completion_rate: z.number().nullable().default(null),
    likes: z.number().nonnegative().default(0),
    shares: z.number().nonnegative().default(0),
    saves: z.number().nonnegative().default(0),
    comments: z.number().nonnegative().default(0),
    profile_visits: z.number().nonnegative().default(0),
    follows: z.number().nonnegative().default(0),
    link_clicks: z.number().nonnegative().default(0),
    revenue_micros: z.number().nonnegative().default(0),
    /** Platform-native extras preserved verbatim for later analysis. */
    raw: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type AnalyticsRow = z.infer<typeof AnalyticsRowSchema>;

export const NormalisedMetricsSchema = z
  .object({
    views: z.number().nonnegative(),
    watch_time_seconds: z.number().nonnegative(),
    avg_percent_viewed: z.number().nullable(),
    completion_rate: z.number().nullable(),
    share_rate: z.number().nullable(),
    save_rate: z.number().nullable(),
    like_rate: z.number().nullable(),
    comment_rate: z.number().nullable(),
    follow_conversion: z.number().nullable(),
    profile_visit_rate: z.number().nullable(),
    link_click_rate: z.number().nullable(),
    revenue_micros: z.number().nonnegative(),
    /** Blended engagement: the cross-platform comparable signal. */
    engagement_rate: z.number().nullable(),
  })
  .strict();

export type NormalisedMetrics = z.infer<typeof NormalisedMetricsSchema>;

export const PublishPlanSchema = z
  .object({
    video_id: z.string().min(3),
    mode: z.literal("AUTO_PUBLISH_AFTER_ALL_GATES").or(z.literal("MANUAL")).or(z.literal("DRY_RUN")),
    platforms: z.array(Platform).max(4),
    disclosure: z.string().max(400).default(""),
    scheduled_at: z.string().max(40).optional(),
    campaign_id: z.string().max(80).default(""),
  })
  .strict();

export type PublishPlan = z.infer<typeof PublishPlanSchema>;

export const PublishResultSchema = z
  .object({
    video_id: z.string().min(3),
    platform: Platform,
    status: z.enum(["published", "skipped", "failed", "dry_run"]),
    remote_id: z.string().max(200).default(""),
    permalink: z.string().max(600).default(""),
    disclosure_applied: z.boolean().default(false),
    error: z.string().max(600).default(""),
    attempt: z.number().int().min(0).default(0),
  })
  .strict();

export type PublishResult = z.infer<typeof PublishResultSchema>;

export const FormatPerformanceSchema = z
  .object({
    format: Format,
    sample_size: z.number().int().nonnegative(),
    median_views: z.number().nonnegative(),
    avg_percent_viewed: z.number().nullable(),
    share_rate: z.number().nullable(),
    save_rate: z.number().nullable(),
    follow_conversion: z.number().nullable(),
    engagement_rate: z.number().nullable(),
    percentile: z.number().min(0).max(100),
    recommendation: z.enum(["scale", "improve_hook", "improve_shareability", "reduce_priority", "insufficient_data"]),
    detail: z.string().max(600).default(""),
  })
  .strict();

export type FormatPerformance = z.infer<typeof FormatPerformanceSchema>;

export const ExperimentSchema = z
  .object({
    experiment_id: z.string().min(3),
    name: z.string().min(3).max(120),
    hypothesis: z.string().min(3).max(600),
    variable: z.string().min(2).max(60),
    variants: z
      .array(
        z
          .object({
            id: z.string().min(1).max(20),
            description: z.string().max(300),
            payload: z.record(z.string(), z.unknown()).default({}),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    metric: z.string().min(2).max(60),
    status: z.enum(["running", "concluded", "cancelled"]).default("running"),
    allocation: z.record(z.string(), z.number()).default({}),
    results: z.record(z.string(), z.unknown()).default({}),
    started_at: IsoDateTime,
    ended_at: z.string().max(40).nullable().default(null),
  })
  .strict();

export type Experiment = z.infer<typeof ExperimentSchema>;
