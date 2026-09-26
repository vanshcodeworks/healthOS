import { describe, expect, it } from "vitest";
import { hasBlockingIssue, validateFinal, validateTiming } from "@hc/orchestrator";
import type { SceneTiming } from "@hc/orchestrator";
import { StoryboardSchema, type Storyboard } from "@hc/schemas";
import { buildStoryboard } from "@hc/storyboard";
import { asVerified, kbTopic, research, topicFor } from "../helpers/corpus.js";
import { writeScript } from "@hc/script";

/** The eight measured caffeine line durations, and the track they produced. */
const CAFFEINE_LINES = [3.02, 9.8, 5.62, 7.34, 5.7, 7.36, 3.05, 5.43];
const SENTENCE_PAUSE_S = 1.389;
const CAFFEINE_TRACK_S = 57.71;
const CAFFEINE_TARGET_S = 55;

async function caffeineBoard(
  opts: { trackS?: number; planS?: number } = {},
): Promise<Storyboard> {
  const trackS = opts.trackS ?? CAFFEINE_TRACK_S;
  const planS = opts.planS ?? trackS;
  const kb = kbTopic("caffeine-and-the-brain");
  const { claims, sources } = await research(kb);
  const topic = topicFor(kb);
  const draft = writeScript(kb, topic.topic_id, { targetMs: CAFFEINE_TARGET_S * 1000 });
  return buildStoryboard({
    draft,
    claims,
    sources: asVerified(sources),
    topic: kb.title,
    question: kb.question,
    category: kb.category,
    format: kb.format,
    disclaimerFull: draft.disclaimer_full,
    narrationSpeechS: CAFFEINE_LINES,
    trackDurationS: trackS,
    sentencePauseS: SENTENCE_PAUSE_S,
    plan: { total_s: planS },
  }).storyboard;
}

/**
 * Rebuilds scenes from a duration list, keeping them contiguous.
 *
 * The schema refuses overlapping or gapped shots, so a test that wants one
 * awkward shot has to make the rest fit around it.
 */
function withSceneDurations(board: Storyboard, durations: number[]): Storyboard {
  let cursor = 0;
  const scenes = board.scenes.map((scene, index) => {
    const duration = durations[index] ?? 0;
    const start = cursor;
    cursor += duration;
    return { ...scene, start: Number(start.toFixed(3)), end: Number(cursor.toFixed(3)) };
  });
  return StoryboardSchema.parse({
    ...board,
    scenes,
    duration: Number(cursor.toFixed(3)),
  });
}

function timingsOf(board: Storyboard): SceneTiming[] {
  return board.scenes.map((scene, index) => ({
    scene_id: scene.scene_id,
    index,
    start_s: scene.start,
    end_s: scene.end,
    duration_s: Number((scene.end - scene.start).toFixed(3)),
    speech_s: CAFFEINE_LINES[index] ?? 0,
  }));
}

describe("timing validation", () => {
  it("accepts a video sized to its audio, even when it overruns the target", async () => {
    const board = await caffeineBoard();
    const report = validateTiming(board, timingsOf(board));
    expect(hasBlockingIssue(report)).toBe(false);
    // Overrunning the brief is reported, not forbidden: the audio is a fact.
    const overrun = report.issues.find((i) => i.code === "audio.over_target");
    expect(overrun?.severity).toBe("warning");
    expect(report.facts.over_target_s).toBeCloseTo(CAFFEINE_TRACK_S - CAFFEINE_TARGET_S, 1);
  });

  it("rejects a video shorter than its narration instead of trimming the audio", async () => {
    // A 55s video under a 57.71s track is the exact bug this gate exists for:
    // the last scene, which holds the disclaimer, would be cut off mid-word.
    const board = await caffeineBoard({ trackS: CAFFEINE_TRACK_S, planS: 55 });
    expect(board.narration.timing.track_duration_s).toBeCloseTo(CAFFEINE_TRACK_S, 2);
    expect(board.duration).toBeCloseTo(55, 1);
    const report = validateTiming(board, timingsOf(board));
    expect(hasBlockingIssue(report)).toBe(true);
    expect(report.issues.some((i) => i.code === "timeline.shorter_than_audio")).toBe(true);
  });

  it("rejects a shot that outruns the pacing ceiling", async () => {
    const board = await caffeineBoard();
    const timings = timingsOf(board);
    const first = timings[0];
    if (!first) throw new Error("expected at least one scene");
    // Collapse everything into one long shot and one zero-length shot.
    timings[0] = { ...first, start_s: 0, end_s: 20, duration_s: 20 };
    const report = validateTiming(board, timings);
    expect(report.issues.some((i) => i.code === "scene.too_long")).toBe(true);
  });

  it("rejects a zero-length shot", async () => {
    const board = await caffeineBoard();
    const timings = timingsOf(board);
    const first = timings[0];
    const second = timings[1];
    if (!first || !second) throw new Error("expected at least two scenes");
    timings[0] = { ...first, start_s: 0, end_s: 0, duration_s: 0 };
    timings[1] = { ...second, start_s: 0, end_s: second.end_s, duration_s: second.end_s };
    const report = validateTiming(board, timings);
    expect(report.issues.some((i) => i.code === "scene.zero_duration")).toBe(true);
  });

  it("rejects a gap between shots, which the encoder would render as silence", async () => {
    const board = await caffeineBoard();
    const timings = timingsOf(board);
    const second = timings[1];
    if (!second) throw new Error("expected at least two scenes");
    timings[1] = { ...second, start_s: second.start_s + 1.5 };
    const report = validateTiming(board, timings);
    expect(report.issues.some((i) => i.code === "scene.gap")).toBe(true);
  });

  it("rejects a caption that outlives the shot it belongs to", async () => {
    const board = await caffeineBoard();
    // Shrink the first shot to just above the schema's readability floor and
    // hand the time to the next one, so the document stays contiguous and the
    // only thing wrong is the caption.
    const shrunk = withSceneDurations(board, [0.7, ...board.scenes.slice(1).map((s) => s.end - s.start)]);
    const first = shrunk.narration.segments[0];
    if (!first) throw new Error("expected a caption for the first scene");
    const broken = StoryboardSchema.parse({
      ...shrunk,
      narration: {
        ...shrunk.narration,
        segments: [{ ...first, end_s: 40 }, ...shrunk.narration.segments.slice(1)],
      },
    });
    const report = validateTiming(broken, timingsOf(broken));
    expect(report.issues.some((i) => i.code === "caption.outside_scene")).toBe(true);
  });

  it("rejects a caption too short to read", async () => {
    const board = await caffeineBoard();
    const broken = StoryboardSchema.parse({
      ...board,
      narration: {
        ...board.narration,
        segments: board.narration.segments.map((segment, i) =>
          i === 0 ? { ...segment, start_s: segment.start_s, end_s: segment.start_s + 0.05 } : segment,
        ),
      },
    });
    const report = validateTiming(broken, timingsOf(broken));
    expect(report.issues.some((i) => i.code === "caption.too_short")).toBe(true);
  });

  it("rejects a caption that runs past the end of the audio", async () => {
    const board = await caffeineBoard();
    const last = board.narration.segments.at(-1);
    if (!last) throw new Error("expected caption segments");
    const broken = StoryboardSchema.parse({
      ...board,
      narration: {
        ...board.narration,
        segments: [
          ...board.narration.segments.slice(0, -1),
          { ...last, end_s: CAFFEINE_TRACK_S + 4 },
        ],
      },
    });
    const report = validateTiming(broken, timingsOf(broken));
    expect(report.issues.some((i) => i.code === "caption.past_audio")).toBe(true);
  });

  it("keeps every duration separate on the way through", async () => {
    const board = await caffeineBoard();
    const t = board.narration.timing;
    const content = CAFFEINE_LINES.reduce((a, b) => a + b, 0);
    expect(t.source).toBe("measured");
    expect(t.target_duration_s).toBe(CAFFEINE_TARGET_S);
    expect(t.track_duration_s).toBeCloseTo(CAFFEINE_TRACK_S, 2);
    expect(t.content_duration_s).toBeLessThan(t.speech_duration_s);
    expect(t.speech_duration_s).toBeLessThanOrEqual(t.track_duration_s);
    expect(t.line_count).toBe(CAFFEINE_LINES.length);
    // The words cannot take longer than the file that contains them.
    expect(content).toBeLessThan(CAFFEINE_TRACK_S);
  });
});

describe("final validation", () => {
  it("rejects a file whose video is shorter than its own audio", async () => {
    const board = await caffeineBoard();
    const report = validateFinal(board, {
      videoPath: "video.mp4",
      videoDurationS: 55,
      audioPath: "narration.wav",
      audioDurationS: CAFFEINE_TRACK_S,
      plannedDurationS: CAFFEINE_TRACK_S,
      sceneCount: board.scenes.length,
      frameCount: board.scenes.length,
      captionCount: board.narration.segments.length,
    });
    expect(hasBlockingIssue(report)).toBe(true);
    expect(report.issues.some((i) => i.code === "final.audio_truncated")).toBe(true);
  });

  it("accepts a file that covers its audio within one frame", async () => {
    const board = await caffeineBoard();
    const report = validateFinal(board, {
      videoPath: "video.mp4",
      videoDurationS: CAFFEINE_TRACK_S,
      audioPath: "narration.wav",
      audioDurationS: CAFFEINE_TRACK_S,
      plannedDurationS: CAFFEINE_TRACK_S,
      sceneCount: board.scenes.length,
      frameCount: board.scenes.length,
      captionCount: board.narration.segments.length,
    });
    expect(hasBlockingIssue(report)).toBe(false);
  });

  it("rejects a file with a missing shot or caption", async () => {
    const board = await caffeineBoard();
    const report = validateFinal(board, {
      videoPath: "video.mp4",
      videoDurationS: CAFFEINE_TRACK_S,
      audioPath: "narration.wav",
      audioDurationS: CAFFEINE_TRACK_S,
      plannedDurationS: CAFFEINE_TRACK_S,
      sceneCount: board.scenes.length,
      frameCount: board.scenes.length - 1,
      captionCount: board.narration.segments.length - 1,
    });
    expect(report.issues.some((i) => i.code === "final.missing_frames")).toBe(true);
    expect(report.issues.some((i) => i.code === "final.missing_captions")).toBe(true);
  });

  it("rejects a video whose closing shot has nothing to say", async () => {
    const board = await caffeineBoard();
    const scenes = board.scenes.map((scene, i) =>
      i === board.scenes.length - 1 ? { ...scene, narration: "" } : scene,
    );
    const broken = StoryboardSchema.parse({ ...board, scenes });
    const report = validateFinal(broken, {
      videoPath: "video.mp4",
      videoDurationS: CAFFEINE_TRACK_S,
      audioPath: "narration.wav",
      audioDurationS: CAFFEINE_TRACK_S,
      plannedDurationS: CAFFEINE_TRACK_S,
      sceneCount: broken.scenes.length,
      frameCount: broken.scenes.length,
      captionCount: broken.narration.segments.length,
    });
    expect(report.issues.some((i) => i.code === "final.no_closing_narration")).toBe(true);
  });

  it("rejects a video with no disclaimer recorded", async () => {
    const board = await caffeineBoard();
    const broken = StoryboardSchema.parse({
      ...board,
      metadata: { ...board.metadata, disclaimer_full: "" },
    });
    const report = validateFinal(broken, {
      videoPath: "video.mp4",
      videoDurationS: CAFFEINE_TRACK_S,
      audioPath: "narration.wav",
      audioDurationS: CAFFEINE_TRACK_S,
      plannedDurationS: CAFFEINE_TRACK_S,
      sceneCount: broken.scenes.length,
      frameCount: broken.scenes.length,
      captionCount: broken.narration.segments.length,
    });
    expect(report.issues.some((i) => i.code === "final.no_disclaimer")).toBe(true);
  });

  it("tolerates container rounding but not a real shortfall", async () => {
    const board = await caffeineBoard();
    const artifact = {
      videoPath: "video.mp4",
      audioPath: "narration.wav",
      audioDurationS: CAFFEINE_TRACK_S,
      plannedDurationS: CAFFEINE_TRACK_S,
      sceneCount: board.scenes.length,
      frameCount: board.scenes.length,
      captionCount: board.narration.segments.length,
    };
    // A few milliseconds of AAC padding is not a truncated file.
    const rounded = validateFinal(board, {
      ...artifact,
      videoDurationS: CAFFEINE_TRACK_S - 0.03,
    });
    expect(hasBlockingIssue(rounded)).toBe(false);
    // A fifth of a second is: the file really is shorter than its own audio.
    const short = validateFinal(board, { ...artifact, videoDurationS: CAFFEINE_TRACK_S - 0.2 });
    expect(hasBlockingIssue(short)).toBe(true);
    expect(short.issues.some((i) => i.code === "final.audio_truncated")).toBe(true);
    // Running long is safe, but it is worth a note.
    const long = validateFinal(board, { ...artifact, videoDurationS: CAFFEINE_TRACK_S + 3 });
    expect(hasBlockingIssue(long)).toBe(false);
    expect(long.issues.some((i) => i.code === "final.duration_drift")).toBe(true);
  });
});
