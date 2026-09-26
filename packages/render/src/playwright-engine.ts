import { HealthOSError, ensureDirAsync, fileSize, removeDir } from "@hc/core";
import { chromium, type Page } from "playwright";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { encodeTimeline, probeMedia } from "./ffmpeg.js";
import type {
  FrameProvider,
  RenderEngine,
  RenderOutput,
  RenderProject,
  RenderResult,
  RenderScene,
} from "./types.js";

/**
 * The local gsap build, resolved as a declared dependency.
 *
 * The motion runtime is resolved rather than hardcoded: a relative path from the
 * repository root works in a script and breaks the moment the factory is used
 * as a library from somewhere else.
 */
export function resolveGsapPath(): string | null {
  try {
    return createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js");
  } catch {
    return null;
  }
}

export interface PlaywrightRenderEngineOptions {
  provider: FrameProvider;
  /** Path to a local gsap build. Resolved from the dependency when omitted. */
  gsapPath?: string;
  /** Reuse frames already on disk. Off by default so a run is never a lie. */
  reuseFrames?: boolean;
  /** Keep frames for inspection. A render nobody can look at is a rumour. */
  keepFrames?: boolean;
  headless?: boolean;
}

/**
 * Draws each shot in a real browser and muxes the results under the narration.
 *
 * A shot with a boot script is captured at the project's frame rate by seeking
 * a paused GSAP timeline, so motion is deterministic: the same project JSON
 * reproduces the same frames. A shot without one is captured as a single still,
 * which is the honest fallback for a provider that has not declared motion.
 */
export class PlaywrightRenderEngine implements RenderEngine {
  readonly id = "playwright";
  readonly version: string;

  private readonly provider: FrameProvider;
  private readonly gsapPath: string | undefined;
  private readonly reuseFrames: boolean;
  private readonly keepFrames: boolean;
  private readonly headless: boolean;

  constructor(options: PlaywrightRenderEngineOptions) {
    this.provider = options.provider;
    this.gsapPath = options.gsapPath ?? resolveGsapPath() ?? undefined;
    this.reuseFrames = options.reuseFrames ?? false;
    this.keepFrames = options.keepFrames ?? true;
    this.headless = options.headless ?? true;
    this.version = `2.0.0+${options.provider.id}@${options.provider.version}`;
  }

  async render(project: RenderProject, output: RenderOutput): Promise<RenderResult> {
    const startedAt = Date.now();
    const framesRoot = join(output.workDir, "frames");
    await ensureDirAsync(framesRoot);
    if (!this.reuseFrames) {
      await removeDir(framesRoot);
      await ensureDirAsync(framesRoot);
    }
    await this.provider.prepare?.(project, output.workDir);

    const fps = project.video.fps;
    let totalFrames = 0;
    const sceneFrameCounts: number[] = [];

    const browser = await chromium.launch({ headless: this.headless });
    try {
      const page = await browser.newPage({
        viewport: { width: project.video.width, height: project.video.height },
        deviceScaleFactor: 1,
      });
      for (let index = 0; index < project.scenes.length; index += 1) {
        const scene = project.scenes[index];
        if (!scene) {
          continue;
        }
        const sceneDir = join(framesRoot, `scene-${String(index + 1).padStart(3, "0")}`);
        const count = Math.max(1, Math.ceil(scene.duration_s * fps));
        sceneFrameCounts[index] = count;

        if (this.reuseFrames && existsSync(join(sceneDir, "frame-0001.png"))) {
          totalFrames += count;
          continue;
        }
        await ensureDirAsync(sceneDir);
        totalFrames += await this.captureScene(page, project, scene, sceneDir, count, fps);
      }
    } finally {
      await browser.close();
    }

    const media = await encodeTimeline({
      scenes: project.scenes,
      sceneFrameCounts,
      framesRoot,
      audioPath: project.audio.path,
      audioDurationS: project.audio.duration_s,
      outPath: output.videoPath,
      spec: project.video,
    });
    const audio = await probeMedia(project.audio.path);

    if (media.duration_s + 0.05 < audio.duration_s) {
      throw new HealthOSError(
        `rendered video is ${media.duration_s.toFixed(3)}s but narration is ${audio.duration_s.toFixed(
          3,
        )}s`,
        { category: "INTERNAL" },
      );
    }

    if (!this.keepFrames) {
      await removeDir(framesRoot);
    }

    return {
      video_path: output.videoPath,
      video_duration_s: media.duration_s,
      audio_duration_s: audio.duration_s,
      width: media.width,
      height: media.height,
      bytes: await fileSize(output.videoPath),
      frames: totalFrames,
      renderer_id: this.id,
      renderer_version: this.version,
      cache_hit: false,
      duration_ms: Date.now() - startedAt,
    };
  }

  /**
   * Captures one shot, frame by frame.
   *
   * The timeline is sought rather than played: a real clock and a screenshot
   * call disagree by enough to drop frames, and a dropped frame is a visible
   * stutter. Seeking a paused timeline gives the same pixels every time.
   */
  private async captureScene(
    page: Page,
    project: RenderProject,
    scene: RenderScene,
    sceneDir: string,
    frameCount: number,
    fps: number,
  ): Promise<number> {
    await page.setContent(this.provider.html(project, scene), { waitUntil: "load" });
    const boot = this.provider.bootScript?.(project, scene);
    // A provider that declares motion without a motion runtime produces a page
    // of thrown scripts and a folder of identical frames: a still video that
    // passes every duration check. That is a failure, so it is reported as one.
    if (boot && !this.gsapPath) {
      throw new HealthOSError(
        `provider "${this.provider.id}" declares motion but no gsap build could be resolved`,
        {
          category: "CONFIG_ERROR",
          details: { provider: this.provider.id },
          remediation: "Install gsap, or pass gsapPath to PlaywrightRenderEngine.",
        },
      );
    }
    if (this.gsapPath) {
      await page.addScriptTag({ path: this.gsapPath });
    }
    if (boot) {
      await page.addScriptTag({ content: boot });
    }
    // Deterministic output: no screenshot is taken until webfonts settle,
    // because a fallback face is a different picture.
    await page.evaluate(() => document.fonts.ready);

    // The timeline has to exist, and it has to have a duration, before a single
    // frame is captured. A motion script that fails to parse leaves no timeline
    // behind, the per-frame seek then does nothing because it is guarded by
    // `if (timeline)`, and the result is one still frame repeated for the length
    // of the scene: a video that passes ffprobe, passes the duration check, and
    // passes final validation while one shot is a photograph of nothing moving.
    // A syntax error in generated motion is exactly as likely as a missing gsap,
    // so it is reported the same way.
    if (boot) {
      const timeline = await page.evaluate(() => {
        const tl = (window as unknown as { __hfTimeline?: { duration: () => number } }).__hfTimeline;
        return tl ? Number(tl.duration()) : null;
      });
      if (timeline === null) {
        throw new HealthOSError(
          `scene "${scene.scene_id}" declared motion but produced no timeline, so every frame would be identical`,
          {
            category: "RENDER_ERROR",
            details: { provider: this.provider.id, scene: scene.scene_id },
            remediation:
              "The provider's boot script threw before assigning window.__hfTimeline. Open the scene HTML in a browser and read the console error.",
          },
        );
      }
      if (!(timeline > 0)) {
        throw new HealthOSError(
          `scene "${scene.scene_id}" produced a timeline of duration ${timeline}, so it has nothing to seek`,
          {
            category: "RENDER_ERROR",
            details: { provider: this.provider.id, scene: scene.scene_id, duration: timeline },
            remediation: "Check the scene duration and the motion the provider attached to it.",
          },
        );
      }
    }

    for (let f = 0; f < frameCount; f += 1) {
      const t = f / fps;
      await page.evaluate((time) => {
        const timeline = (window as unknown as { __hfTimeline?: { seek: (t: number, includeChildren?: boolean) => void; pause: () => void } }).__hfTimeline;
        if (timeline) {
          timeline.seek(time, false);
          timeline.pause();
        }
      }, t);
      await page.screenshot({
        path: join(sceneDir, `frame-${String(f + 1).padStart(4, "0")}.png`),
        type: "png",
      });
    }
    return frameCount;
  }
}
