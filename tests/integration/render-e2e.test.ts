// The whole loop, with a real voice and a real browser.
//
// The measured caffeine case is the one this exists for: a 55s brief whose words
// take 47.32s to say and whose track comes out at 57.71s. Nothing here may
// shorten that track. The finished file has to be at least as long as the
// narration, the shots have to tile it exactly, and the closing disclaimer has
// to survive to the last frame.
//
// SAPI and Chromium are both slow and both occasionally absent, so the run is
// skipped rather than faked when either is missing. A skipped test is honest; a
// mocked one would not be.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ensureDirAsync, pathExists, removeDir } from "@hc/core";
import { join } from "node:path";
import { Orchestrator, RunStore, hasBlockingIssue } from "@hc/orchestrator";
import { SapiTtsProvider, sapiAvailable, wavDurationSeconds } from "@hc/audio";
import { CachingRenderEngine, PlaywrightRenderEngine, plannedFrameCount, probeMedia, resolveGsapPath, renderCacheKeySlug } from "@hc/render";
import { HtmlFrameProvider } from "@hc/renderer";
import { asVerified, kbTopic, research, topicFor } from "../helpers/corpus.js";
import { writeScript } from "@hc/script";
import type { BuildStoryboardInput } from "@hc/storyboard";

const WORK_ROOT = join(process.cwd(), "temp", "e2e-render");
const RUN_ID = "e2e-caffeine";

/** The brief, and what the voice actually did about it. */
const TARGET_S = 55;

/**
 * The real engine, motion runtime included.
 *
 * A capture run without the motion runtime produces a folder of identical stills
 * that satisfies every duration check, so the loop is never tested without it.
 */
function engine(): PlaywrightRenderEngine {
  return new PlaywrightRenderEngine({ provider: new HtmlFrameProvider(), gsapPath: resolveGsapPath() ?? undefined });
}

async function caffeineInput(): Promise<BuildStoryboardInput> {
  const kb = kbTopic("caffeine-and-the-brain");
  const { claims, sources } = await research(kb);
  const draft = writeScript(kb, topicFor(kb).topic_id, { targetMs: TARGET_S * 1000 });
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

describe("end-to-end render", () => {
  let available = false;
  let outcome: Awaited<ReturnType<Orchestrator["run"]>> | null = null;
  let store: RunStore;

  beforeAll(async () => {
    await removeDir(WORK_ROOT);
    await ensureDirAsync(WORK_ROOT);
    store = new RunStore(WORK_ROOT);
    available = await sapiAvailable();
    if (!available) return;
    const tts = new SapiTtsProvider();
    const render = new CachingRenderEngine({
      inner: engine(),
      cacheDir: join(WORK_ROOT, "cache"),
    });
    outcome = await new Orchestrator({ store, tts, engine: render }).run({
      runId: RUN_ID,
      build: await caffeineInput(),
    });
  }, 900_000);

  afterAll(async () => {
    if (process.env.HC_KEEP_E2E !== "1") {
      await removeDir(WORK_ROOT);
    }
  });

  it("either produces a finished file or says why it could not", (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    expect(outcome).not.toBeNull();
  });

  it("reaches READY with both validations clean", (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    const run = outcome?.run;
    expect(run?.state).toBe("READY");
    expect(hasBlockingIssue(outcome!.timing)).toBe(false);
    expect(hasBlockingIssue(outcome!.final)).toBe(false);
    expect(run?.synth_count).toBe(1);
    expect(run?.render_count).toBe(1);
  });

  it("sizes the video to the recording, not to the brief", (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    const timing = outcome!.storyboard.narration.timing;
    // Whatever the voice did, the video is that long. This is the invariant, and
    // it holds in both directions: sizing the video to the brief instead would
    // either cut the end of the track off or hold a silent tail.
    expect(timing.source, "a synthesised track is a measurement, not an estimate").toBe("measured");
    expect(timing.target_duration_s).toBe(TARGET_S);
    expect(timing.track_duration_s).toBeGreaterThan(0);
    expect(outcome!.storyboard.duration).toBeCloseTo(timing.track_duration_s, 1);
    // The report states the relationship rather than concealing it in either
    // direction. This used to assert a specific overrun, because the caffeine
    // script spoke a line more than it does now and the real track came in over
    // 55s. Dropping the standalone disclaimer took a spoken line out, so the real
    // track is now *under* the brief — and a test that insists on an overrun
    // measures the script, not the renderer. What has to hold is that the report
    // agrees with the numbers: an overrun issue exactly when the track is longer
    // than the target, and none when it is shorter.
    const overrun = outcome!.storyboard.duration > TARGET_S;
    expect(outcome!.timing.issues.some((i) => i.code === "audio.over_target")).toBe(overrun);
    if (overrun) {
      expect(outcome!.timing.facts.over_target_s).toBeGreaterThan(0);
      expect(outcome!.timing.facts.over_target_s).toBeCloseTo(timing.track_duration_s - TARGET_S, 1);
    } else {
      expect(outcome!.timing.facts.over_target_s).toBe(0);
    }
  });

  it("tiles the shots across the whole track with no gaps", (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    const scenes = outcome!.storyboard.scenes;
    expect(scenes.length).toBeGreaterThanOrEqual(2);
    expect(scenes[0]?.start).toBe(0);
    for (let i = 1; i < scenes.length; i += 1) {
      const prev = scenes[i - 1];
      const cur = scenes[i];
      if (!prev || !cur) continue;
      expect(Math.abs(cur.start - prev.end)).toBeLessThanOrEqual(0.05);
    }
    expect(scenes.at(-1)?.end).toBeCloseTo(outcome!.storyboard.narration.timing.track_duration_s, 1);
  });

  it("gives every line a caption that sits inside its own shot", (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    const { scenes, narration } = outcome!.storyboard;
    const track = narration.timing.track_duration_s;
    for (const segment of narration.segments) {
      const owner = scenes.find((s) => s.scene_id === segment.scene_id);
      expect(owner, `no shot for ${segment.scene_id}`).toBeDefined();
      expect(segment.text.length).toBeGreaterThan(0);
      // Long enough to read, inside its shot, and inside the file.
      expect(segment.end_s - segment.start_s).toBeGreaterThan(0.2);
      expect(segment.end_s).toBeLessThanOrEqual((owner?.end ?? 0) + 0.1);
      expect(segment.end_s).toBeLessThanOrEqual(track + 0.1);
    }
  });

  it("produces a real file that is not shorter than its narration", async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    const videoPath = outcome!.run.render?.video_path ?? "";
    expect(await pathExists(videoPath)).toBe(true);

    const media = await probeMedia(videoPath);
    const audio = wavDurationSeconds(outcome!.run.audio!.path);
    expect(media.width).toBe(1080);
    expect(media.height).toBe(1920);
    expect(media.has_audio).toBe(true);
    // The rule the whole pipeline exists to protect.
    expect(media.duration_s).toBeGreaterThanOrEqual(audio - 0.05);
    expect(media.duration_s).toBeGreaterThanOrEqual(audio - 1 / 30);
    expect(media.video_codec).toBe("h264");
    expect(media.audio_codec).toBe("aac");
  });

  it("captures every frame of every shot and leaves them for inspection", async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    const frames = store.framesDir(RUN_ID);
    const fps = 30;
    let expectedFrames = 0;
    for (const [i, scene] of outcome!.storyboard.scenes.entries()) {
      const dir = join(frames, `scene-${String(i + 1).padStart(3, "0")}`);
      const count = Math.max(1, Math.ceil((scene.end - scene.start) * fps));
      expectedFrames += count;
      const first = join(dir, "frame-0001.png");
      const last = join(dir, `frame-${String(count).padStart(4, "0")}.png`);
      expect(await pathExists(first), `missing ${first}`).toBe(true);
      expect(await pathExists(last), `missing ${last}`).toBe(true);
    }
    // The frame count the run reports is the one the timeline asked for, not one
    // still per shot.
    expect(outcome!.run.render?.frames).toBe(expectedFrames);
    expect(expectedFrames).toBeGreaterThan(outcome!.storyboard.scenes.length * 10);
  });

  it("animates the shots rather than holding one picture", (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    // Identical bytes at the start and end of a shot mean the timeline never
    // moved: a still video passes every duration check in this file.
    const frames = store.framesDir(RUN_ID);
    const longest = outcome!.storyboard.scenes.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    const index = outcome!.storyboard.scenes.indexOf(longest) + 1;
    const dir = join(frames, `scene-${String(index).padStart(3, "0")}`);
    const first = readFileSync(join(dir, "frame-0001.png"));
    const middle = readFileSync(join(dir, `frame-${String(Math.floor(longest.end - longest.start > 3 ? 60 : 20)).padStart(4, "0")}.png`));
    expect(first.equals(middle), "frame 60 is identical to frame 1: nothing moved").toBe(false);
  });

  it("carries the caveat into the deliverable, and does not spend a shot on it", (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    // The video no longer ends on a spoken disclaimer — that shot was removed,
    // because a footnote does not get six seconds of a fifty-second video. This
    // test used to assert the opposite, that the last shot's narration was the
    // disclaimer, and it was the one place the removal was actually verified.
    //
    // The requirement it should have been checking is the one that matters: the
    // caveat still reaches the viewer. It is not in the spoken track any more, so
    // it has to be in the metadata the publisher builds the description and the
    // end card from. A health video with the caveat only in a field nobody reads is
    // a health video with no caveat.
    const last = outcome!.storyboard.scenes.at(-1);
    expect(last?.intent, "the video ends on the call to action").toBe("cta");
    const scenes = outcome!.storyboard.scenes;
    // The caveat is not spoken anywhere in the track. `caveat` remains a valid
    // scene intent — a qualified claim earns one — so this cannot be asserted as
    // "no scene has that intent". What must not exist is a shot whose job is to
    // read the footnote aloud.
    expect(
      scenes.filter((s) => /not medical advice|general information/i.test(s.narration)),
      "the caveat is not spoken in any shot",
    ).toEqual([]);
    const full = outcome!.storyboard.metadata.disclaimer_full;
    expect(full.length, "the full caveat reaches the publisher").toBeGreaterThan(20);
    expect(full.toLowerCase()).toMatch(/not medical advice|general information/);
  });

  it("resumes a finished run without touching the voice again", async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    const tts = new SapiTtsProvider();
    let synthesised = 0;
    const original = tts.synthesiseTrack.bind(tts);
    tts.synthesiseTrack = async (texts: string[], out: string) => {
      synthesised += 1;
      return original(texts, out);
    };
    const cached = new CachingRenderEngine({
      inner: engine(),
      cacheDir: join(WORK_ROOT, "cache"),
    });
    const again = await new Orchestrator({ store, tts, engine: cached }).resume(RUN_ID);
    expect(again.run.state).toBe("READY");
    expect(synthesised).toBe(0);
  });

  it("serves a second identical render from cache", async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    const cached = new CachingRenderEngine({
      inner: engine(),
      cacheDir: join(WORK_ROOT, "cache"),
    });
    const { toRenderProject } = await import("@hc/render");
    const audio = outcome!.run.audio!;
    const project = toRenderProject(outcome!.storyboard, {
      path: audio.path,
      duration_s: audio.track_duration_s,
      hash: audio.hash,
      sample_rate: audio.sample_rate,
      channels: audio.channels,
    });
    const result = await cached.render(project, {
      workDir: store.runDir(RUN_ID),
      videoPath: join(WORK_ROOT, "cache-check.mp4"),
    });
    expect(result.cache_hit).toBe(true);
    expect(result.video_duration_s).toBeGreaterThanOrEqual(audio.track_duration_s - 0.05);
    // A cache hit reports the frame count the engine would have captured, not a
    // round number of shots.
    expect(result.frames).toBe(plannedFrameCount(project));
    expect(result.frames).toBeGreaterThan(project.scenes.length);
  });

  it("keys the cache on the renderer, not only on the storyboard", async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    // The art direction lives in the provider, so a key that ignores the engine
    // version hands back the previous renderer's frames.
    const { toRenderProject } = await import("@hc/render");
    const audio = outcome!.run.audio!;
    const project = toRenderProject(outcome!.storyboard, {
      path: audio.path,
      duration_s: audio.track_duration_s,
      hash: audio.hash,
      sample_rate: audio.sample_rate,
      channels: audio.channels,
    });
    const here = renderCacheKeySlug(project, "2.0.0+editorial_html@2.0.0");
    const other = renderCacheKeySlug(project, "2.0.0+editorial_html@2.1.0");
    expect(here).not.toBe(other);
  });
});
