import { z } from "zod";

/**
 * The run's life, in order.
 *
 * A run is a document: it records what was asked for, what was measured, and
 * what was produced. Everything needed to resume lives in it, which is why the
 * states are persisted rather than inferred from whatever files happen to exist.
 */
export const RUN_STATES = [
  "PLANNED",
  "AUDIO_SYNTHESIZED",
  "AUDIO_MEASURED",
  "STORYBOARD_REBUILT",
  "TIMING_VALIDATED",
  "RENDERING",
  "RENDERED",
  "FINAL_VALIDATED",
  "READY",
  "FAILED",
] as const;
export type RunState = (typeof RUN_STATES)[number];

/** Legal forward transitions. Anything else is a bug, not a recovery. */
export const RUN_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  PLANNED: ["AUDIO_SYNTHESIZED", "FAILED"],
  AUDIO_SYNTHESIZED: ["AUDIO_MEASURED", "FAILED"],
  AUDIO_MEASURED: ["STORYBOARD_REBUILT", "FAILED"],
  STORYBOARD_REBUILT: ["TIMING_VALIDATED", "FAILED"],
  TIMING_VALIDATED: ["RENDERING", "FAILED"],
  // A render can be retried, which is the whole reason audio is not resynthesised.
  RENDERING: ["RENDERED", "FAILED", "RENDERING"],
  RENDERED: ["FINAL_VALIDATED", "FAILED"],
  FINAL_VALIDATED: ["READY", "FAILED"],
  READY: [],
  // A failed run re-enters at the step that failed, which is any step up to and
  // including rendering. It cannot re-enter past RENDERING: a file that has been
  // rendered is re-validated or discarded, never silently un-made.
  FAILED: [
    "PLANNED",
    "AUDIO_SYNTHESIZED",
    "AUDIO_MEASURED",
    "STORYBOARD_REBUILT",
    "TIMING_VALIDATED",
    "RENDERING",
  ],
};

export function canTransition(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function nextState(from: RunState): RunState | null {
  const order: RunState[] = [
    "PLANNED",
    "AUDIO_SYNTHESIZED",
    "AUDIO_MEASURED",
    "STORYBOARD_REBUILT",
    "TIMING_VALIDATED",
    "RENDERING",
    "RENDERED",
    "FINAL_VALIDATED",
    "READY",
  ];
  const i = order.indexOf(from);
  if (i < 0 || i === order.length - 1) {
    return null;
  }
  return order[i + 1] ?? null;
}

export const ValidationIssueSchema = z
  .object({
    code: z.string().min(2).max(60),
    severity: z.enum(["error", "warning"]),
    message: z.string().min(1).max(400),
    scene_id: z.string().max(40).optional(),
    at_s: z.number().min(0).optional(),
  })
  .strict();
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationReportSchema = z
  .object({
    ok: z.boolean(),
    checked_at: z.string().max(40),
    issues: z.array(ValidationIssueSchema).max(200),
    facts: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  })
  .strict();
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

export const SceneTimingSchema = z
  .object({
    scene_id: z.string().min(3).max(40),
    index: z.number().int().min(0),
    start_s: z.number().min(0),
    end_s: z.number().min(0),
    /** end - start, persisted so a reader never has to subtract to find it. */
    duration_s: z.number().min(0),
    speech_s: z.number().min(0),
  })
  .strict();
export type SceneTiming = z.infer<typeof SceneTimingSchema>;

/** Everything measured about the audio, kept apart for the same reason as the schema. */
export const RunAudioSchema = z
  .object({
    path: z.string().min(1),
    hash: z.string().min(8).max(64),
    sample_rate: z.number().int().positive(),
    channels: z.number().int().positive(),
    /** Per line, in scene order. Length must equal the scene count. */
    line_content_s: z.array(z.number().min(0)).max(60),
    content_duration_s: z.number().min(0),
    speech_duration_s: z.number().min(0),
    track_duration_s: z.number().min(0),
    lead_s: z.number().min(0),
    tail_s: z.number().min(0),
    sentence_pause_s: z.number().min(0),
  })
  .strict();
export type RunAudio = z.infer<typeof RunAudioSchema>;

export const RunRenderSchema = z
  .object({
    renderer_id: z.string().min(1).max(60),
    renderer_version: z.string().min(1).max(40),
    video_path: z.string().min(1),
    video_duration_s: z.number().min(0),
    audio_duration_s: z.number().min(0),
    width: z.number().int().min(0),
    height: z.number().int().min(0),
    bytes: z.number().int().min(0),
    frames: z.number().int().min(0),
    cache_hit: z.boolean(),
  })
  .strict();
export type RunRender = z.infer<typeof RunRenderSchema>;

export const RunAttemptSchema = z
  .object({
    state: z.enum(RUN_STATES),
    started_at: z.string().max(40),
    finished_at: z.string().max(40).optional(),
    ok: z.boolean().optional(),
    error: z.string().max(600).optional(),
  })
  .strict();
export type RunAttempt = z.infer<typeof RunAttemptSchema>;

export const OrchestratorRunSchema = z
  .object({
    run_id: z.string().min(8).max(80),
    video_id: z.string().min(3).max(80),
    topic_id: z.string().min(3).max(80),
    topic: z.string().min(1).max(300),
    state: z.enum(RUN_STATES),
    /** Bumped whenever the inputs change, so a stale artifact cannot be reused. */
    storyboard_version: z.number().int().min(0),
    script_hash: z.string().max(64).default(""),
    target_duration_s: z.number().min(0),
    storyboard_path: z.string().max(600).default(""),
    storyboard_hash: z.string().max(64).default(""),
    audio: RunAudioSchema.optional(),
    scene_timings: z.array(SceneTimingSchema).max(24).default([]),
    timing_validation: ValidationReportSchema.optional(),
    final_validation: ValidationReportSchema.optional(),
    render: RunRenderSchema.optional(),
    attempts: z.array(RunAttemptSchema).max(200).default([]),
    /** How many times the audio has been made. A retry must not increment it. */
    synth_count: z.number().int().min(0).default(0),
    render_count: z.number().int().min(0).default(0),
    work_dir: z.string().min(1).max(600),
    error: z.string().max(600).default(""),
    created_at: z.string().max(40),
    updated_at: z.string().max(40),
  })
  .strict();
export type OrchestratorRun = z.infer<typeof OrchestratorRunSchema>;
