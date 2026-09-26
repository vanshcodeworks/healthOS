// A run has to survive the two failures that actually happen in practice: the
// process dies, and the browser fails on the last frame. Both are tested here
// with a fake voice and a fake engine, because the point is the state machine's
// behaviour and not whether PowerShell can speak.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDirAsync, removeDir } from "@hc/core";
import { join } from "node:path";
import { Orchestrator, RunStore } from "@hc/orchestrator";
import type { RenderEngine, RenderOutput, RenderProject, RenderResult } from "@hc/render";
import type { TrackResult, TtsProvider, VoiceProfile } from "@hc/audio";
import { asVerified, kbTopic, research, topicFor } from "../helpers/corpus.js";
import { writeScript } from "@hc/script";
import type { BuildStoryboardInput } from "@hc/storyboard";

const WORK_ROOT = join(process.cwd(), "temp", "runs-test");

/** Line durations chosen so the track overruns the 55s brief, as caffeine does. */
const LINES_S = [3.02, 9.8, 5.62, 7.34, 5.7, 7.36, 3.05, 5.43];
const SENTENCE_PAUSE_S = 1.389;
const TRACK_S = 57.71;

class FakeTts implements TtsProvider {
  readonly profile: VoiceProfile = {
    voice_id: "fake",
    provider: "fake",
    words_per_minute: 165,
    utterance_overhead_s: SENTENCE_PAUSE_S,
    disclosure: "",
  };
  synthCalls = 0;
  measureCalls = 0;

  measureAll(texts: string[]): Promise<number[]> {
    this.measureCalls += 1;
    return Promise.resolve(texts.map((_t, i) => LINES_S[i] ?? 1));
  }

  async synthesiseTrack(_texts: string[], outPath: string): Promise<TrackResult> {
    this.synthCalls += 1;
    await ensureDirAsync(join(outPath, ".."));
    // A real WAV header, so readWavInfo has something true to read.
    const dataBytes = Math.round(TRACK_S * 48_000 * 2);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + dataBytes, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(48_000, 24);
    header.writeUInt32LE(96_000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(dataBytes, 40);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(outPath, Buffer.concat([header, Buffer.alloc(dataBytes)]));
    return { audio_path: outPath, duration_s: TRACK_S, audio_hash: "a".repeat(64) };
  }
}

class FakeEngine implements RenderEngine {
  readonly id = "fake";
  readonly version = "0.0.0";
  renderCalls = 0;
  /** Set to make the next render blow up the way a browser does. */
  failNext = false;
  videoDurationS = TRACK_S;

  async render(project: RenderProject, output: RenderOutput): Promise<RenderResult> {
    this.renderCalls += 1;
    if (this.failNext) {
      this.failNext = false;
      throw new Error("browser closed unexpectedly");
    }
    const { writeFile } = await import("node:fs/promises");
    await ensureDirAsync(join(output.videoPath, ".."));
    await writeFile(output.videoPath, "not really a video");
    return {
      video_path: output.videoPath,
      video_duration_s: this.videoDurationS,
      audio_duration_s: project.audio.duration_s,
      width: project.video.width,
      height: project.video.height,
      bytes: 18,
      frames: project.scenes.length,
      renderer_id: this.id,
      renderer_version: this.version,
      cache_hit: false,
      duration_ms: 1,
    };
  }
}

async function caffeineInput(): Promise<BuildStoryboardInput> {
  const kb = kbTopic("caffeine-and-the-brain");
  const { claims, sources } = await research(kb);
  const draft = writeScript(kb, topicFor(kb).topic_id, { targetMs: 55_000 });
  return {
    draft,
    claims,
    sources: asVerified(sources),
    topic: kb.title,
    question: kb.question,
    category: kb.category,
    format: kb.format,
    disclaimerFull: draft.disclaimer_full,
  };
}

describe("orchestrator", () => {
  let store: RunStore;
  let tts: FakeTts;
  let engine: FakeEngine;

  beforeEach(async () => {
    await removeDir(WORK_ROOT);
    await ensureDirAsync(WORK_ROOT);
    store = new RunStore(WORK_ROOT);
    tts = new FakeTts();
    engine = new FakeEngine();
  });

  afterEach(async () => {
    await removeDir(WORK_ROOT);
  });

  const orchestrator = (): Orchestrator => new Orchestrator({ store, tts, engine });

  it("walks a run from plan to ready", async () => {
    const outcome = await orchestrator().run({ runId: "run-happy", build: await caffeineInput() });
    expect(outcome.run.state).toBe("READY");
    expect(outcome.run.synth_count).toBe(1);
    expect(outcome.run.render_count).toBe(1);
    expect(outcome.final.ok).toBe(true);
    // The video is built to the recording, not to the brief.
    expect(outcome.storyboard.duration).toBeCloseTo(TRACK_S, 1);
    expect(outcome.storyboard.narration.timing.track_duration_s).toBeCloseTo(TRACK_S, 1);
    expect(outcome.storyboard.narration.timing.target_duration_s).toBe(55);
    // The overrun is recorded rather than hidden.
    expect(outcome.timing.issues.some((i) => i.code === "audio.over_target")).toBe(true);
  });

  it("records every state it passed through", async () => {
    const outcome = await orchestrator().run({ runId: "run-states", build: await caffeineInput() });
    const states = outcome.run.attempts.map((a) => a.state);
    expect(states).toEqual([
      "PLANNED",
      "AUDIO_SYNTHESIZED",
      "AUDIO_MEASURED",
      "STORYBOARD_REBUILT",
      "TIMING_VALIDATED",
      "RENDERING",
      "RENDERED",
      "FINAL_VALIDATED",
      "READY",
    ]);
  });

  it("lays shots onto the recording so pauses fall inside shots", async () => {
    const outcome = await orchestrator().run({ runId: "run-layout", build: await caffeineInput() });
    const { scenes, narration } = outcome.storyboard;
    // Shots tile the file with no gaps, which is what the encoder needs.
    for (let i = 1; i < scenes.length; i += 1) {
      const prev = scenes[i - 1];
      const cur = scenes[i];
      if (!prev || !cur) continue;
      expect(Math.abs(cur.start - prev.end)).toBeLessThanOrEqual(0.05);
    }
    expect(scenes[0]?.start).toBe(0);
    expect(scenes.at(-1)?.end).toBeCloseTo(TRACK_S, 1);
    // Every caption sits inside the shot it belongs to and is readable.
    for (const segment of narration.segments) {
      const owner = scenes.find((s) => s.scene_id === segment.scene_id);
      expect(owner).toBeDefined();
      expect(segment.start_s).toBeGreaterThanOrEqual((owner?.start ?? 0) - 0.05);
      expect(segment.end_s).toBeLessThanOrEqual((owner?.end ?? 0) + 0.1);
      expect(segment.end_s - segment.start_s).toBeGreaterThan(0.2);
    }
  });

  it("does not resynthesise audio when a render fails", async () => {
    const build = await caffeineInput();
    engine.failNext = true;
    const first = orchestrator();
    await expect(first.run({ runId: "run-retry", build })).rejects.toThrow(
      /browser closed/,
    );
    expect(tts.synthCalls).toBe(1);

    // The retry picks up at rendering, with the audio already on disk.
    engine.failNext = false;
    const outcome = await orchestrator().run({ runId: "run-retry", build });
    expect(outcome.run.state).toBe("READY");
    expect(tts.synthCalls).toBe(1);
    expect(tts.measureCalls).toBe(1);
    expect(engine.renderCalls).toBe(2);
  });

  it("records a render failure and resumes from rendering", async () => {
    const build = await caffeineInput();
    engine.failNext = true;
    await expect(orchestrator().run({ runId: "run-crash", build })).rejects.toThrow(
      /browser closed/,
    );
    // The failure is durable, and the audio it got as far as making is kept.
    const failed = await store.load("run-crash");
    expect(failed?.state).toBe("FAILED");
    expect(failed?.error).toMatch(/browser closed/);
    expect(failed?.audio?.track_duration_s).toBeCloseTo(TRACK_S, 1);
    expect(failed?.render_count).toBe(0);

    const outcome = await orchestrator().run({ runId: "run-crash", build });
    expect(outcome.run.state).toBe("READY");
    expect(tts.synthCalls).toBe(1);
    expect(tts.measureCalls).toBe(1);
    expect(engine.renderCalls).toBe(2);
  });

  it("resumes a run left mid-flight without redoing finished work", async () => {
    const build = await caffeineInput();
    await orchestrator().run({ runId: "run-midflight", build });
    const done = await store.load("run-midflight");
    expect(done?.state).toBe("READY");
    const callsBefore = { synth: tts.synthCalls, measure: tts.measureCalls, render: engine.renderCalls };

    // Resuming a finished run is a no-op, not a rerun.
    const again = await orchestrator().resume("run-midflight");
    expect(again.run.state).toBe("READY");
    expect(tts.synthCalls).toBe(callsBefore.synth);
    expect(tts.measureCalls).toBe(callsBefore.measure);
    expect(engine.renderCalls).toBe(callsBefore.render);
  });

  it("refuses to declare a finished file whose video is shorter than its audio", async () => {
    engine.videoDurationS = 55;
    const failing = orchestrator();
    await expect(
      failing.run({ runId: "run-tooshort", build: await caffeineInput() }),
    ).rejects.toThrow(/rejected/);
    const stored = await store.load("run-tooshort");
    expect(stored?.state).toBe("FAILED");
    expect(stored?.final_validation?.issues.some((i) => i.code === "final.audio_truncated")).toBe(
      true,
    );
  });

  it("keeps a run's measurements across a reload", async () => {
    await orchestrator().run({ runId: "run-durable", build: await caffeineInput() });
    const reloaded = await store.load("run-durable");
    expect(reloaded?.audio?.line_content_s).toHaveLength(LINES_S.length);
    expect(reloaded?.audio?.track_duration_s).toBeCloseTo(TRACK_S, 1);
    expect(reloaded?.scene_timings.length).toBe(reloaded?.storyboard_version ? 8 : 0);
    expect(reloaded?.final_validation?.ok).toBe(true);
    expect(reloaded?.render?.video_duration_s).toBeCloseTo(TRACK_S, 1);
  });

  it("refuses an illegal state change", async () => {
    const { OrchestratorRunSchema } = await import("@hc/orchestrator");
    const run = OrchestratorRunSchema.parse({
      run_id: "run-guard",
      video_id: "vid-guard",
      topic_id: "topic-guard",
      topic: "topic",
      state: "PLANNED",
      storyboard_version: 1,
      target_duration_s: 55,
      work_dir: WORK_ROOT,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await store.create(run);
    await expect(store.transition(run, "READY")).rejects.toThrow(/illegal run transition/);
  });
});
