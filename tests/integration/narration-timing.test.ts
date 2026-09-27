// Narration windows are what the captions and the audio are cut against.
//
// The original builder gave every line a flat one-second window. That was not
// visibly wrong in a schema check, and it was wrong everywhere it mattered: a
// sentence that takes seven seconds got a caption that left after one, so the
// captions and the voice disagreed for the entire video.

import { describe, expect, it } from "vitest";
import { asVerified, kbTopic, research, topicFor } from "../helpers/corpus.js";
import { writeScript } from "@hc/script";
import { buildStoryboard } from "@hc/storyboard";
import { estimateSpeechMs } from "@hc/core";

async function boardFor(slug: string, extra: Record<string, unknown> = {}) {
  const kb = kbTopic(slug);
  const { claims, sources } = await research(kb);
  const verified = asVerified(sources);
  const topic = topicFor(kb);
  const draft = writeScript(kb, topic.topic_id, { targetMs: 55_000 });
  return buildStoryboard({
    draft,
    claims,
    sources: verified,
    topic: kb.title,
    question: kb.question,
    category: kb.category,
    format: kb.format,
    ...extra,
  }).storyboard;
}

/**
 * A per-line measured track, in the shape a SAPI measurement takes: mostly
 * mid-length lines with one long one, and the sentence pause a speech engine adds
 * on top of the speech itself.
 *
 * The length comes from the script rather than from a literal. These fixtures used
 * to be eight-element arrays written for the eight-line script this topic had
 * before the standalone disclaimer was dropped, and when the line count changed to
 * seven they kept their length: the builder was handed eight measurements for
 * seven lines, and the timing block fell back to `estimated` — so the test that
 * exists to prove measured durations are used was quietly testing the estimate.
 * Deriving the length makes that class of drift impossible.
 */
function measuredTrackFor(
  storyboard: { narration: { segments: unknown[] } },
  { longIndex = 1, longSeconds = 9.8, shortSeconds = 3.2 } = {},
): number[] {
  return storyboard.narration.segments.map((_, index) => (index === longIndex ? longSeconds : shortSeconds));
}

/** The sentence pause a speech engine adds after each line. */
const SENTENCE_PAUSE_S = 1.389;

describe("narration timing", () => {
  it("gives a spoken line a window proportional to how long it takes to say", async () => {
    const storyboard = await boardFor("caffeine-and-the-brain");

    for (const segment of storyboard.narration.segments) {
      const scene = storyboard.scenes.find((s) => s.scene_id === segment.scene_id);
      if (!scene) continue;
      const spoken = estimateSpeechMs(scene.narration) / 1000;
      const window = segment.end_s - segment.start_s;
      // The window tracks the sentence, it is not a fixed guess, and it never
      // runs past the shot it belongs to.
      expect(window).toBeLessThanOrEqual(Math.round((scene.end - scene.start) * 1000) / 1000 + 0.001);
      if (spoken > 1) expect(window).toBeGreaterThan(0.5);
    }
  });

  it("does not use a flat one-second window for a long line", async () => {
    // The regression this file exists for.
    const storyboard = await boardFor("caffeine-and-the-brain");
    const long = storyboard.narration.segments.filter((s) => s.end_s - s.start_s > 4);
    expect(long.length).toBeGreaterThan(0);
  });

  it("never leaves a line with a shorter window than it needs to be read", async () => {
    const storyboard = await boardFor("sleep-duration-and-appetite");
    for (const segment of storyboard.narration.segments) {
      expect(segment.end_s).toBeGreaterThan(segment.start_s);
    }
  });

  it("keeps segments inside their scene, in order, without overlap", async () => {
    const storyboard = await boardFor("hydration-physiology");
    const segments = storyboard.narration.segments;
    for (let i = 1; i < segments.length; i += 1) {
      const prev = segments[i - 1];
      const cur = segments[i];
      if (!prev || !cur) throw new Error("expected a segment at every index");
      expect(cur.start_s).toBeGreaterThanOrEqual(prev.end_s - 0.001);
    }
    for (const segment of segments) {
      expect(segment.end_s).toBeLessThanOrEqual(storyboard.duration + 0.001);
    }
  });

  it("uses measured durations when they are supplied and says so", async () => {
    const estimated = await boardFor("protein-digestion");
    const measured = await boardFor("protein-digestion", {
      narrationSpeechS: estimated.scenes.map(() => 3),
    });
    expect(measured.narration.timing.source).toBe("measured");
    expect(estimated.narration.timing.source).toBe("estimated");
  });

  it("does not claim a recorded duration before any audio exists", async () => {
    const storyboard = await boardFor("fibre-and-digestion");
    // Zero means "no recording yet". Putting an estimate here would be a
    // statement about a file nobody has made.
    expect(storyboard.narration.duration_s).toBe(0);
    expect(storyboard.narration.timing.track_duration_s).toBe(0);
    expect(storyboard.narration.timing.content_duration_s).toBeGreaterThan(0);
    expect(storyboard.narration.timing.target_duration_s).toBe(55);
  });

  it("records every duration separately once a real track exists", async () => {
    // The whole point of the timing block: a reader can tell that this video is
    // longer than its target because the audio is, not because a field was
    // quietly reused to mean something else.
    const base = await boardFor("caffeine-and-the-brain");
    const measured = measuredTrackFor(base);
    expect(measured).toHaveLength(base.narration.segments.length);
    const track = measured.reduce((a, b) => a + b, 0) + SENTENCE_PAUSE_S * measured.length;
    const storyboard = await boardFor("caffeine-and-the-brain", {
      narrationSpeechS: measured,
      trackDurationS: track,
      leadS: 0.12,
      tailS: 0.78,
      sentencePauseS: SENTENCE_PAUSE_S,
      plan: { total_s: track },
    });

    const t = storyboard.narration.timing;
    expect(t.source, "a supplied per-line measurement is a measurement, not an estimate").toBe("measured");
    expect(t.target_duration_s).toBe(55);
    expect(t.track_duration_s).toBeCloseTo(track, 2);
    expect(storyboard.narration.duration_s).toBeCloseTo(track, 2);
    expect(t.lead_s).toBe(0.12);
    expect(t.tail_s).toBe(0.78);
    expect(t.sentence_pause_s).toBe(SENTENCE_PAUSE_S);
    expect(t.line_count).toBe(measured.length);
    // Speech is the spoken span, which is neither the content nor the whole file.
    expect(t.speech_duration_s).toBeCloseTo(track - 0.12 - 0.78, 2);
    expect(t.speech_duration_s).toBeGreaterThan(t.content_duration_s);
    expect(t.speech_duration_s).toBeLessThan(t.track_duration_s);
    // And the video was sized to the track, not to the brief.
    expect(storyboard.duration).toBeCloseTo(track, 1);
  });

  it("reports a track that overruns the target as an overrun", async () => {
    // A video longer than its target is not a failure of layout: it is the audio
    // being longer than the brief, and it has to be visible as such. The caffeine
    // script no longer covers this on its own — dropping the standalone disclaimer
    // took a spoken line out, so its real track lands under 55s — so the overrun
    // path is exercised with a deliberately slow track rather than by hoping the
    // corpus drifts back over the line.
    const base = await boardFor("caffeine-and-the-brain");
    const measured = base.narration.segments.map(() => 8.4);
    const track = measured.reduce((a, b) => a + b, 0) + SENTENCE_PAUSE_S * measured.length;
    expect(track, "this fixture has to actually overrun the target").toBeGreaterThan(55);

    const storyboard = await boardFor("caffeine-and-the-brain", {
      narrationSpeechS: measured,
      trackDurationS: track,
      plan: { total_s: track },
    });

    const t = storyboard.narration.timing;
    expect(t.target_duration_s).toBe(55);
    expect(t.track_duration_s).toBeCloseTo(track, 2);
    expect(storyboard.duration).toBeGreaterThan(t.target_duration_s);
    expect(storyboard.duration).toBeCloseTo(track, 1);
  });

  it("sizes shots to the real track so the last sentence is not cut off", async () => {
    // A speech engine adds a pause per sentence, so the rendered track is longer
    // than the sum of its lines. Measured on SAPI: content + 1.389s per line.
    // A video sized from the speech estimate alone runs out before the audio
    // does, and the closing line is what gets cut.
    const base = await boardFor("caffeine-and-the-brain");
    const measured = measuredTrackFor(base, { longSeconds: 12 });
    const track = measured.reduce((a, b) => a + b, 0) + SENTENCE_PAUSE_S * measured.length;
    const storyboard = await boardFor("caffeine-and-the-brain", {
      narrationSpeechS: measured,
      plan: { total_s: track },
    });

    expect(storyboard.duration).toBeCloseTo(track, 1);
    const last = storyboard.narration.segments[storyboard.narration.segments.length - 1];
    expect(last?.end_s).toBeLessThanOrEqual(storyboard.duration + 0.001);
    for (const segment of storyboard.narration.segments) {
      const scene = storyboard.scenes.find((s) => s.scene_id === segment.scene_id);
      expect(segment.end_s).toBeLessThanOrEqual((scene?.end ?? 0) + 0.01);
    }
  });

  it("sizes shots from measurements rather than from the estimate", async () => {
    // Same runtime, same script, different speech: the shot that holds a long
    // line has to grow, or the caption runs past the cut.
    const base = await boardFor("caffeine-and-the-brain");
    const lineCount = base.narration.segments.length;
    const withLongFirst = base.narration.segments.map((_, i) => (i === 0 ? 12 : 1));
    const withLongSecond = base.narration.segments.map((_, i) => (i === 1 ? 12 : 1));
    const options = { plan: { total_s: 40 } };
    const longFirst = await boardFor("caffeine-and-the-brain", { ...options, narrationSpeechS: withLongFirst });
    const shortFirst = await boardFor("caffeine-and-the-brain", { ...options, narrationSpeechS: withLongSecond });
    expect(withLongFirst).toHaveLength(lineCount);
    const firstOf = (b: typeof longFirst) => {
      const s = b.scenes[0];
      if (!s) throw new Error("expected a first scene");
      return s.end - s.start;
    };
    expect(firstOf(longFirst)).toBeGreaterThan(firstOf(shortFirst));
  });
});
