import { ensureDirAsync, fileSize, pathExists } from "@hc/core";
import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { probeMedia } from "./ffmpeg.js";
import type { RenderEngine, RenderOutput, RenderProject, RenderResult } from "./types.js";

/**
 * Identity of a render.
 *
 * Covers everything that can change a pixel or a sample: the timeline, the audio
 * bytes, the geometry, and both renderer versions. The engine version matters
 * most: the art direction lives in the frame provider, so two renders of the
 * same storyboard by two providers are two different videos, and a key built
 * only from the storyboard hands back the old one.
 */
export function renderCacheKey(project: RenderProject, engineVersion = ""): string {
  return JSON.stringify({
    project_id: project.project_id,
    renderer_version: project.renderer_version,
    engine_version: engineVersion,
    video: project.video,
    audio_hash: project.audio.hash,
    audio_duration_s: project.audio.duration_s,
    scenes: project.scenes.map((s) => [
      s.scene_id,
      s.start_s,
      s.end_s,
      s.duration_s,
      s.headline,
      s.subtext,
      s.layout,
      s.components,
    ]),
    captions: project.captions.map((c) => [c.start_s, c.end_s, c.text]),
    caption_style: project.caption_style,
    disclaimer: project.disclaimer,
    cta: project.cta,
  });
}

/** A short, stable filename suffix. Not a security boundary. */
export function renderCacheKeySlug(project: RenderProject, engineVersion = ""): string {
  const key = renderCacheKey(project, engineVersion);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i += 1) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** How many frames the engine will capture for a project, from the project alone. */
export function plannedFrameCount(project: RenderProject): number {
  return project.scenes.reduce(
    (total, scene) => total + Math.max(1, Math.ceil(scene.duration_s * project.video.fps)),
    0,
  );
}

export interface CachingRenderEngineOptions {
  inner: RenderEngine;
  /**
   * Where finished videos are kept, named by content.
   *
   * Deliberately not derived from the caller's output path: a cache keyed by
   * where someone happened to ask for the file is not a cache, it is a lookup
   * table that misses the moment the destination changes.
   */
  cacheDir: string;
}

/**
 * Wraps an engine with a content-addressed cache.
 *
 * A hit still re-probes the file, so an entry that has been deleted or truncated
 * cannot masquerade as a finished render.
 */
export class CachingRenderEngine implements RenderEngine {
  readonly id: string;
  readonly version: string;

  private readonly inner: RenderEngine;
  private readonly cacheDir: string;

  constructor(options: CachingRenderEngineOptions) {
    this.inner = options.inner;
    this.cacheDir = options.cacheDir;
    this.id = `${options.inner.id}+cache`;
    this.version = options.inner.version;
  }

  async render(project: RenderProject, output: RenderOutput): Promise<RenderResult> {
    const cachedPath = join(this.cacheDir, `${renderCacheKeySlug(project, this.inner.version)}.mp4`);
    if (await pathExists(cachedPath)) {
      const hit = await this.probeHit(cachedPath, project);
      if (hit) {
        if (resolve(cachedPath) !== resolve(output.videoPath)) {
          await copyFile(cachedPath, output.videoPath);
          return { ...hit, video_path: output.videoPath };
        }
        return hit;
      }
    }

    await ensureDirAsync(this.cacheDir);
    const result = await this.inner.render(project, {
      workDir: output.workDir,
      videoPath: cachedPath,
    });
    if (resolve(result.video_path) === resolve(output.videoPath)) {
      return result;
    }
    await copyFile(result.video_path, output.videoPath);
    return { ...result, video_path: output.videoPath };
  }

  private async probeHit(
    cachedPath: string,
    project: RenderProject,
  ): Promise<RenderResult | null> {
    try {
      const media = await probeMedia(cachedPath);
      // A cached file shorter than its own narration is not a usable cache hit.
      if (media.duration_s + 0.05 < project.audio.duration_s) {
        return null;
      }
      return {
        video_path: cachedPath,
        video_duration_s: media.duration_s,
        audio_duration_s: project.audio.duration_s,
        width: media.width,
        height: media.height,
        bytes: await fileSize(cachedPath),
        // The same count the engine would have captured, derived from the
        // project rather than remembered: a cache hit that reports "one frame
        // per shot" describes a renderer this project was never rendered by.
        frames: plannedFrameCount(project),
        renderer_id: this.inner.id,
        renderer_version: this.inner.version,
        cache_hit: true,
        duration_ms: 0,
      };
    } catch {
      return null;
    }
  }
}
