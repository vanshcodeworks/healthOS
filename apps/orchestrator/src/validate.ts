import { estimateSpeechMs } from "@hc/core";
import type { Storyboard } from "@hc/schemas";
import type { SceneTiming, ValidationIssue, ValidationReport } from "./run-schema.js";

/**
 * Grace allowed when comparing a video against its audio, in seconds.
 *
 * A frame at 30fps is 0.033s and an AAC frame is 0.023s, so half a frame of
 * slack absorbs container rounding without ever hiding a real shortfall: a
 * truncated disclaimer is seconds long, not milliseconds.
 */
export const DEFAULT_TOLERANCE_S = 0.05;

/** A caption shorter than this cannot be read, so it is treated as a defect. */
export const MIN_CAPTION_S = 0.2;

/**
 * Words per second a burned-in caption may run at before it is a warning.
 *
 * Adult captioning guidance puts the readable ceiling around three to four words a
 * second. Above it, a viewer is reading faster than they can look away from the
 * line, and shrinking the type to fit makes it worse rather than better.
 */
export const MAX_CAPTION_WORDS_PER_S = 4;

export interface TimingPolicy {
  /** Hard ceiling on a single shot. */
  maxSceneS: number;
  /** Hard ceiling on the whole video, measured against the audio. */
  maxTotalS: number;
  /** How far the video may exceed the audio before it counts as a defect. */
  toleranceS: number;
  /** Overrun allowed on a caption relative to its own scene. */
  captionSlackS: number;
}

export const DEFAULT_TIMING_POLICY: TimingPolicy = {
  maxSceneS: 14,
  maxTotalS: 180,
  toleranceS: DEFAULT_TOLERANCE_S,
  captionSlackS: 0.05,
};

function report(issues: ValidationIssue[], facts: Record<string, number | string | boolean>): ValidationReport {
  return {
    ok: issues.every((i) => i.severity !== "error"),
    checked_at: new Date().toISOString(),
    issues,
    facts,
  };
}

export function hasBlockingIssue(r: ValidationReport): boolean {
  return r.issues.some((i) => i.severity === "error");
}

/**
 * Checks the rebuilt timeline against the audio that will be laid under it.
 *
 * The rule that matters: the shots must cover the narration. Everything else
 * here is about finding out *why* they might not, early, while it is still
 * cheap to change the words rather than the file.
 */
export function validateTiming(
  storyboard: Storyboard,
  sceneTimings: SceneTiming[],
  policy: TimingPolicy = DEFAULT_TIMING_POLICY,
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const timing = storyboard.narration.timing;
  const trackS = timing.track_duration_s;
  const targetS = timing.target_duration_s;
  const timelineS = sceneTimings.reduce((sum, s) => sum + s.duration_s, 0);

  if (trackS <= 0) {
    issues.push({
      code: "audio.missing",
      severity: "error",
      message: "no synthesised track to time against",
    });
  }
  if (storyboard.duration + policy.toleranceS < trackS) {
    issues.push({
      code: "timeline.shorter_than_audio",
      severity: "error",
      message: `video is ${storyboard.duration.toFixed(
        3,
      )}s but narration is ${trackS.toFixed(3)}s; the tail would be cut`,
    });
  }
  if (timelineS > 0 && timelineS + policy.toleranceS < trackS) {
    issues.push({
      code: "scenes.shorter_than_audio",
      severity: "error",
      message: `shots cover ${timelineS.toFixed(3)}s but narration is ${trackS.toFixed(3)}s`,
    });
  }

  // Overrunning the brief is allowed and must be visible, not fatal: the audio
  // is a fact and the target was a hope.
  if (trackS > 0 && targetS > 0 && trackS > targetS + policy.toleranceS) {
    issues.push({
      code: "audio.over_target",
      severity: "warning",
      message: `narration is ${trackS.toFixed(2)}s against a ${targetS.toFixed(
        0,
      )}s target (+${(trackS - targetS).toFixed(2)}s)`,
    });
  }
  if (timelineS > policy.maxTotalS) {
    issues.push({
      code: "timeline.too_long",
      severity: "error",
      message: `video is ${timelineS.toFixed(2)}s, over the ${policy.maxTotalS}s ceiling`,
    });
  }

  sceneTimings.forEach((scene) => {
    if (scene.duration_s > policy.maxSceneS + policy.toleranceS) {
      issues.push({
        code: "scene.too_long",
        severity: "error",
        message: `shot ${scene.index} runs ${scene.duration_s.toFixed(2)}s, over the ${policy.maxSceneS}s ceiling`,
        scene_id: scene.scene_id,
      });
    }
    if (scene.duration_s <= 0) {
      issues.push({
        code: "scene.zero_duration",
        severity: "error",
        message: `shot ${scene.index} has no duration and would flash past`,
        scene_id: scene.scene_id,
      });
    }
    if (scene.end_s < scene.start_s) {
      issues.push({
        code: "scene.reversed",
        severity: "error",
        message: `shot ${scene.index} ends before it starts`,
        scene_id: scene.scene_id,
      });
    }
  });

  // Shots must be contiguous, or the concat demuxer leaves a gap of silence.
  for (let i = 1; i < sceneTimings.length; i += 1) {
    const prev = sceneTimings[i - 1];
    const cur = sceneTimings[i];
    if (!prev || !cur) continue;
    if (Math.abs(cur.start_s - prev.end_s) > policy.toleranceS) {
      issues.push({
        code: "scene.gap",
        severity: "error",
        message: `gap or overlap of ${(cur.start_s - prev.end_s).toFixed(3)}s between shots ${i - 1} and ${i}`,
        scene_id: cur.scene_id,
        at_s: cur.start_s,
      });
    }
  }

  storyboard.narration.segments.forEach((segment) => {
    const owner = sceneTimings.find((s) => s.scene_id === segment.scene_id);
    if (segment.end_s - segment.start_s < MIN_CAPTION_S) {
      issues.push({
        code: "caption.too_short",
        severity: "error",
        message: `caption for ${segment.scene_id} lasts ${(segment.end_s - segment.start_s).toFixed(
          2,
        )}s, too short to read`,
        scene_id: segment.scene_id,
        at_s: segment.start_s,
      });
    }
    if (trackS > 0 && segment.end_s > trackS + policy.toleranceS) {
      issues.push({
        code: "caption.past_audio",
        severity: "error",
        message: `caption for ${segment.scene_id} ends at ${segment.end_s.toFixed(
          2,
        )}s, past the narration`,
        scene_id: segment.scene_id,
        at_s: segment.end_s,
      });
    }
    if (owner) {
      const limit = owner.end_s + policy.captionSlackS;
      if (segment.end_s > limit + policy.toleranceS) {
        issues.push({
          code: "caption.outside_scene",
          severity: "error",
          message: `caption for ${segment.scene_id} outlives its shot by ${(
            segment.end_s - owner.end_s
          ).toFixed(2)}s`,
          scene_id: segment.scene_id,
          at_s: segment.end_s,
        });
      }
    }
    // Only worth checking while the timing is still an estimate: once it is
    // measured, the caption window *is* the measurement, and second-guessing a
    // fact with the estimator is noise rather than a finding.
    if (
      timing.source === "estimated" &&
      estimateSpeechMs(segment.text) / 1000 > segment.end_s - segment.start_s + 1.5
    ) {
      issues.push({
        code: "caption.too_fast",
        severity: "warning",
        message: `caption for ${segment.scene_id} is likely faster than the voice`,
        scene_id: segment.scene_id,
      });
    }
    // A caption may not drop the words that do not fit: losing the tail of a
    // sentence is content loss, so an overrun is flagged here for the writer rather
    // than trimmed in the renderer. What has to be measured is the *pace*, not the
    // length of the segment: the band reveals words as they are spoken and re-breaks
    // the line to fit the screen, so a twenty-word sentence is not twenty words on
    // screen. Comparing a segment's total against a per-screen-line budget measured
    // every ordinary sentence in the corpus as over budget, which is a rule that
    // fires on everything and so reports nothing.
    //
    // Four words a second is the ceiling: above that an adult reader loses the line
    // in a two-line band at caption size, and no amount of fitting makes it
    // readable. The corpus runs 2.1 to 3.4 words a second.
    const words = segment.text.split(/\s+/).filter(Boolean).length;
    const span = segment.end_s - segment.start_s;
    const wordsPerSecond = words / Math.max(0.001, span);
    if (wordsPerSecond > MAX_CAPTION_WORDS_PER_S) {
      issues.push({
        code: "caption.over_budget",
        severity: "warning",
        message:
          `caption for ${segment.scene_id} runs ${words} words in ${span.toFixed(2)}s ` +
          `(${wordsPerSecond.toFixed(1)} words/s, over the ${MAX_CAPTION_WORDS_PER_S}-word/s reading pace); ` +
          "the renderer will scale it rather than drop it",
        scene_id: segment.scene_id,
      });
    }
  });

  return report(issues, {
    target_duration_s: targetS,
    track_duration_s: trackS,
    content_duration_s: timing.content_duration_s,
    speech_duration_s: timing.speech_duration_s,
    timeline_s: Number(timelineS.toFixed(3)),
    video_duration_s: storyboard.duration,
    scene_count: sceneTimings.length,
    lead_s: timing.lead_s,
    tail_s: timing.tail_s,
    over_target_s: Number(Math.max(0, trackS - targetS).toFixed(3)),
  });
}

export interface FinalArtifact {
  videoPath: string;
  videoDurationS: number;
  audioPath: string;
  audioDurationS: number;
  /** Duration the timeline asked for, which may legitimately exceed the file. */
  plannedDurationS: number;
  sceneCount: number;
  frameCount: number;
  captionCount: number;
}

/**
 * The last gate before a file is called finished.
 *
 * It re-probes the media rather than trusting anything upstream, because the
 * only claim worth making about a finished video is one measured from the
 * finished video.
 */
export function validateFinal(
  storyboard: Storyboard,
  artifact: FinalArtifact,
  policy: TimingPolicy = DEFAULT_TIMING_POLICY,
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const { videoDurationS, audioDurationS } = artifact;

  if (videoDurationS <= 0) {
    issues.push({ code: "final.no_video", severity: "error", message: "no video was produced" });
  }
  if (audioDurationS <= 0) {
    issues.push({ code: "final.no_audio", severity: "error", message: "no narration in the file" });
  }
  // The headline rule: a video shorter than its own audio is a truncated file.
  if (videoDurationS + policy.toleranceS < audioDurationS) {
    issues.push({
      code: "final.audio_truncated",
      severity: "error",
      message: `video is ${videoDurationS.toFixed(3)}s but narration is ${audioDurationS.toFixed(
        3,
      )}s; audio was cut`,
    });
  }
  if (Math.abs(videoDurationS - artifact.plannedDurationS) > 0.5) {
    issues.push({
      code: "final.duration_drift",
      severity: "warning",
      message: `file is ${videoDurationS.toFixed(2)}s against a planned ${artifact.plannedDurationS.toFixed(
        2,
      )}s`,
    });
  }
  if (artifact.frameCount < artifact.sceneCount) {
    issues.push({
      code: "final.missing_frames",
      severity: "error",
      message: `${artifact.sceneCount} shots planned but ${artifact.frameCount} rendered`,
    });
  }
  if (artifact.captionCount < artifact.sceneCount) {
    issues.push({
      code: "final.missing_captions",
      severity: "error",
      message: `${artifact.sceneCount} shots but only ${artifact.captionCount} captions`,
    });
  }
  const lastScene = storyboard.scenes.at(-1);
  if (!lastScene || lastScene.narration.trim().length === 0) {
    issues.push({
      code: "final.no_closing_narration",
      severity: "error",
      message: "the closing shot has nothing to say, so the video ends mid-sentence",
    });
  }
  if (storyboard.metadata.disclaimer_full.trim().length === 0) {
    issues.push({
      code: "final.no_disclaimer",
      severity: "error",
      message: "the disclaimer is missing from the metadata",
    });
  }
  if (storyboard.narration.timing.track_duration_s <= 0) {
    issues.push({
      code: "final.no_measured_audio",
      severity: "error",
      message: "the run never recorded a real audio duration",
    });
  }
  if (storyboard.narration.segments.length === 0) {
    issues.push({
      code: "final.no_captions",
      severity: "error",
      message: "no caption segments were produced",
    });
  }

  return report(issues, {
    video_duration_s: Number(videoDurationS.toFixed(3)),
    audio_duration_s: Number(audioDurationS.toFixed(3)),
    planned_duration_s: Number(artifact.plannedDurationS.toFixed(3)),
    slack_s: Number((videoDurationS - audioDurationS).toFixed(3)),
    target_duration_s: storyboard.narration.timing.target_duration_s,
    scenes: artifact.sceneCount,
    frames: artifact.frameCount,
    captions: artifact.captionCount,
  });
}
