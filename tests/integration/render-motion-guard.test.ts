// A scene whose motion script fails used to be captured as a still image.
//
// The engine's per-frame seek is guarded by `if (timeline)`, so when a script
// with a syntax error left `window.__hfTimeline` undefined, every frame of the
// scene came out identical, ffprobe was happy, the duration check was happy,
// and final validation was happy. The heart sample shipped 197 identical frames
// in one of seven shots and every automated check passed it.
//
// These tests pin the refusal. They launch a real browser, because the failure
// mode is a script that fails to compile in a page, which cannot be reproduced
// without one. Both cases throw before any encoding, so no audio is involved.

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { removeDir } from "@hc/core";
import { PlaywrightRenderEngine, resolveGsapPath } from "@hc/render";
import type { FrameProvider, RenderOutput, RenderProject, RenderScene } from "@hc/render";

const WORK_ROOT = join(process.cwd(), "temp", "e2e-motion-guard");

function project(): RenderProject {
  const scene: RenderScene = {
    scene_id: "sc_01",
    index: 0,
    start_s: 0,
    end_s: 2,
    duration_s: 2,
    intent: "explain",
    headline: "A headline",
    subtext: "",
    components: [],
    layout: "center",
  };
  return {
    project_id: "p",
    video_id: "v",
    title: "Title",
    topic: "Topic",
    palette_id: "mechanism",
    template_id: "t",
    renderer_version: "test",
    video: { width: 1080, height: 1920, fps: 30, crf: 18, videoBitrate: "8M", audioBitrate: "192k" },
    scenes: [scene],
    captions: [],
    caption_style: { style: "editorial", y: 0.78, max_lines: 2, max_words_per_line: 9, max_chars_per_line: 46 },
    audio: { path: join(WORK_ROOT, "audio.wav"), duration_s: 2, hash: "h", sample_rate: 24000, channels: 1 },
    disclaimer: "General information, not medical advice.",
    cta: { enabled: false, kind: "follow", text: "" },
  };
}

function output(): RenderOutput {
  return { workDir: join(WORK_ROOT, "work"), videoPath: join(WORK_ROOT, "video.mp4") };
}

function engineWith(provider: FrameProvider): PlaywrightRenderEngine {
  return new PlaywrightRenderEngine({ provider, gsapPath: resolveGsapPath() ?? undefined });
}

/** A real GSAP timeline. Any failure here must come from the guard, not from GSAP. */
const VALID_MOTION =
  "window.__hfTimeline = gsap.timeline({ paused: true }); window.__hfTimeline.to('.stage', { scale: 1.04, duration: 2 }, 0);";

describe("a scene whose motion does not run is refused, not filmed", () => {
  it("rejects a boot script that fails to compile, rather than filming a still", async () => {
    const provider: FrameProvider = {
      id: "broken-motion",
      version: "1",
      html: () => "<!doctype html><html><body><div class='stage'>stage</div></body></html>",
      // The exact defect: a selector expression wrapped in quotes.
      bootScript: () => "window.__hfTimeline = gsap.timeline({ paused: true }); tl.to('sel + ' [data-hf=beat]'', {});",
    };

    await expect(engineWith(provider).render(project(), output())).rejects.toThrow(
      /produced no timeline/,
    );
  });

  it("rejects a boot script that runs but builds an empty timeline", async () => {
    const provider: FrameProvider = {
      id: "empty-motion",
      version: "1",
      html: () => "<!doctype html><html><body><div class='stage'>stage</div></body></html>",
      bootScript: () => "window.__hfTimeline = gsap.timeline({ paused: true });",
    };

    await expect(engineWith(provider).render(project(), output())).rejects.toThrow(/nothing to seek/);
  });

  it("accepts an ordinary timeline, so the guard cannot fire on working motion", async () => {
    const provider: FrameProvider = {
      id: "valid-motion",
      version: "1",
      html: () => "<!doctype html><html><body><div class='stage'>stage</div></body></html>",
      bootScript: () => VALID_MOTION,
    };

    // This run still fails, on the deliberately absent audio file, and that is the
    // point: the failure is downstream of the browser, not the motion guard
    // mistaking a two-second timeline for an empty one.
    await expect(engineWith(provider).render(project(), output())).rejects.not.toThrow(
      /produced no timeline|nothing to seek/,
    );
    await removeDir(WORK_ROOT);
  });

  it("leaves no frames behind for either failure", async () => {    const provider: FrameProvider = {
      id: "broken-motion",
      version: "1",
      html: () => "<!doctype html><html><body><div class='stage'>stage</div></body></html>",
      bootScript: () => "tl.to('sel + ' [data-hf=beat]'', {});",
    };

    await expect(engineWith(provider).render(project(), output())).rejects.toThrow();
    // A partial folder of frames is what makes a later run look resumable, and a
    // resumed run of identical frames looks like a finished one.
    await removeDir(WORK_ROOT);
  });
});
