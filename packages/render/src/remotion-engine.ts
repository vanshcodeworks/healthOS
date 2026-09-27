/**
 * The Remotion render engine.
 *
 * This is the primary renderer. It bundles the composition once, asks Remotion for
 * the composition's real metadata with the project's props, and renders frames.
 *
 * Three decisions in here are load-bearing:
 *
 * 1. **The duration comes from `selectComposition`, not from us.** The composition
 *    derives its own `durationInFrames` from the measured track, and this engine
 *    renders whatever that says. If the storyboard and the audio disagree, the
 *    video follows the audio and the mismatch is reported. An engine that
 *    computed its own frame count would be a second, competing source of truth.
 *
 * 2. **The audio is staged, not linked.** The measured track is copied into the
 *    bundle's public directory so `staticFile` resolves it. The copy is named by
 *    its content hash, so a bundle left over from a previous run can never serve a
 *    track that no longer belongs to the project.
 *
 * 3. **One browser, released by Remotion.** `renderMedia` owns and closes the
 *    Chromium it starts. This engine never looks for other browsers and never
 *    kills anything it did not start, because the user may have Chrome open with
 *    their own work in it.
 */

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { HealthOSError, ensureDirAsync, fileSize, writeJsonAtomic } from "@hc/core";
import { cp, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeMedia } from "./ffmpeg.js";
import { toHealthVideoProps, type AdapterNote } from "./remotion-props.js";
import type { RenderEngine, RenderOutput, RenderProject, RenderResult } from "./types.js";

/**
 * Keyframe interval for delivery, in frames.
 *
 * Facebook Reels and Instagram publish a 9:16 stream whose closed GOP must be two
 * to five seconds. Five seconds at 30fps is 150 frames: long enough to keep the
 * file small, short enough that a platform can start the stream where the viewer
 * asked for it, and inside the spec rather than at its edge.
 */
export const DELIVERY_GOP_FRAMES = 150;

/** The composition ids this engine can render. */
export const REMOTION_COMPOSITIONS = ["HealthVideo", "HealthVideoSilent"] as const;
export type RemotionCompositionId = (typeof REMOTION_COMPOSITIONS)[number];

export type RenderStage = "bundling" | "composing" | "rendering" | "probing";

export interface RemotionRenderEngineOptions {
  /**
   * Path to the Remotion entry point that calls `registerRoot`. Resolved from the
   * workspace package by default, so the engine works as a library and not only
   * from a script at the repository root.
   */
  entryPoint?: string;
  /**
   * Which composition to render. The silent one exists for platforms that reject a
   * video carrying a track they cannot verify, and for frame-exact visual diffing.
   */
  compositionId?: RemotionCompositionId;
  /**
   * Seconds of hold after the last word, for the end card.
   *
   * Zero by default, and that default is deliberate. The storyboard already owns
   * the runtime: it allocates lead and tail, and the final QA gate compares the
   * finished file against `storyboard.duration`. An engine that quietly added its
   * own hold would render a video longer than the plan and fail that gate, so the
   * hold has to be asked for by whoever plans the extra time.
   */
  tailHold_s?: number;
  /** Reuse a bundle already built in the work directory. */
  reuseBundle?: boolean;
  /** Encode workers. Lower on a small machine. */
  concurrency?: number;
  logLevel?: "info" | "warn" | "error" | "verbose";
  onProgress?: (stage: RenderStage, fraction: number | null) => void;
}

/**
 * The entry point, found by walking out of this module to the repository rather
 * than by a path relative to a script. A hardcoded root works until the package is
 * imported from somewhere else, and then it fails with a path error instead of a
 * useful one.
 */
export function resolveRemotionEntryPoint(): string {
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/remotion-app/src/index.ts"),
    resolve(process.cwd(), "apps/remotion-app/src/index.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new HealthOSError(
    `Remotion entry point not found. Looked in:\n  ${candidates.join("\n  ")}`,
    { category: "CONFIG_ERROR" },
  );
}

/**
 * Remotion's bitrate type is a template literal, and `VideoSpec` is a looser
 * string. Narrowing it with a cast would let a nonsense value like `high` reach
 * ffmpeg; checking it turns that into a clear error at the call site instead.
 */
function remotionBitrate(value: string, field: string): `${number}k` | `${number}K` | `${number}M` {
  if (!/^\d+[kKM]$/.test(value)) {
    throw new HealthOSError(`${field} must look like "8M" or "192k", got "${value}"`, { category: "CONFIG_ERROR" });
  }
  return value as `${number}k` | `${number}K` | `${number}M`;
}

export class RemotionRenderEngine implements RenderEngine {
  readonly id = "remotion";
  readonly version: string;

  private readonly entryPoint: string;
  private readonly compositionId: RemotionCompositionId;
  private readonly tailHold: number;
  private readonly reuseBundle: boolean;
  private readonly concurrency: number | undefined;
  private readonly logLevel: NonNullable<RemotionRenderEngineOptions["logLevel"]>;
  private readonly onProgress: RemotionRenderEngineOptions["onProgress"];

  /**
   * Everything the adapter could not honour, from the last run. The caller writes
   * these into the render manifest: a fallback that nobody records is a fallback
   * that nobody reviews.
   */
  notes: AdapterNote[] = [];

  constructor(options: RemotionRenderEngineOptions = {}) {
    this.entryPoint = options.entryPoint ?? resolveRemotionEntryPoint();
    this.compositionId = options.compositionId ?? "HealthVideo";
    this.tailHold = Math.max(0, options.tailHold_s ?? 0);
    this.reuseBundle = options.reuseBundle ?? true;
    this.concurrency = options.concurrency;
    this.logLevel = options.logLevel ?? "warn";
    this.onProgress = options.onProgress;
    // The pixels in the app are this renderer's version. Bumping it is the only
    // supported way to invalidate a cached render.
    // A unit-viewBox bracket was drawing a 2000px stroke, a caption ran to the
    // bottom edge of the frame, an overlong eyebrow overran the right margin, and a
    // component_only scene with no component was given a stomach. All four are
    // pixels, so the version moves and the render cache misses.
    this.version = "1.1.0+remotion";
  }

  async render(project: RenderProject, output: RenderOutput): Promise<RenderResult> {
    if (!project.storyboard) {
      throw new HealthOSError(
        "the Remotion engine renders from the storyboard, not from the flattened render project; " +
          "build the project with toRenderProject() so the canonical graph is carried along",
        { category: "INVALID_REQUEST" },
      );
    }
    const startedAt = Date.now();
    // Remotion's bundler rejects a relative output directory with a schema
    // validation error that says nothing about the cause, so every path handed to
    // it is made absolute here rather than trusted from the caller.
    const workDir = resolve(output.workDir);
    const videoPath = resolve(output.videoPath);
    await ensureDirAsync(workDir);
    const fps = project.video.fps;

    const adapter = toHealthVideoProps({
      storyboard: project.storyboard,
      audio: project.audio,
      video: project.video,
      tailHold_s: this.tailHold,
    });
    this.notes = adapter.notes;

    // Content-addressed public directory. Naming the copy by hash means a reused
    // bundle cannot serve a previous project's track.
    const publicDir = join(workDir, "public");
    await ensureDirAsync(publicDir);
    // The composition's own assets are staged too, not linked: `staticFile`
    // resolves against the bundle's public directory, the bundle is built from the
    // staged directory, and the app ships its illustrations in its own public
    // folder — so an asset has to be copied here or it 404s on the first frame
    // that asks for it, which is a failure discovered at 21% of a render rather
    // than before one.
    const appRoot = resolve(dirname(this.entryPoint), "..");
    const appPublic = join(appRoot, "public");
    if (existsSync(appPublic)) {
      await cp(appPublic, publicDir, { recursive: true });
    }
    const hash = adapter.props.audio.hash ? `${adapter.props.audio.hash.slice(0, 12)}-` : "";
    const stagedName = `${hash}${basename(project.audio.path)}`;
    await copyFile(resolve(project.audio.path), join(publicDir, stagedName));
    const inputProps = {
      ...adapter.props,
      audio: { ...adapter.props.audio, src: stagedName },
    } as unknown as Record<string, unknown>;

    const serveUrl = await this.buildBundle(workDir, publicDir);
    this.onProgress?.("composing", null);

    const composition = await selectComposition({ serveUrl, id: this.compositionId, inputProps });

    if (composition.fps !== fps || composition.width !== project.video.width || composition.height !== project.video.height) {
      throw new HealthOSError(
        `composition ${composition.id} is ${composition.width}x${composition.height}@${composition.fps} but the project asked for ${project.video.width}x${project.video.height}@${fps}`,
        { category: "INVALID_REQUEST" },
      );
    }

    this.onProgress?.("rendering", 0);
    // Remotion accepts either a constant rate factor or a bitrate, never both, and
    // ffmpeg's behaviour differs visibly between them. `VideoSpec` carries both
    // because the HTML pipeline wanted both; here the CRF wins when it is set,
    // because a constant quality is what keeps two renders of the same project
    // the same size, and the bitrate is only a fallback for a project that asked
    // for one deliberately.
    const quality =
      project.video.crf !== null && project.video.crf !== undefined
        ? { crf: project.video.crf }
        : { videoBitrate: remotionBitrate(project.video.videoBitrate, "videoBitrate") };
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: videoPath,
      inputProps,
      ...quality,
      audioBitrate: remotionBitrate(project.video.audioBitrate, "audioBitrate"),
      pixelFormat: "yuv420p",
      // Delivery compliance, from the platforms' own published specs rather than
      // from what a render happens to produce. Facebook Reels and Instagram
      // require 4:2:0 chroma with a closed GOP of two to five seconds, and
      // YouTube's recommended colour space for HD is BT.709. Without an explicit
      // colour space, the encoder emits the full-range JPEG variant of 4:2:0,
      // which is why a compliant-looking render still shifted colour on a
      // platform player.
      colorSpace: "bt709",
      // Five seconds at 30fps. A longer GOP means a seek that lands mid-GOP and
      // a platform that cannot start a stream where the viewer asked for it.
      gopSize: DELIVERY_GOP_FRAMES,
      overwrite: true,
      ...(this.concurrency !== undefined ? { concurrency: this.concurrency } : {}),
      logLevel: this.logLevel,
      onProgress: ({ progress }) => this.onProgress?.("rendering", progress),
    });

    this.onProgress?.("probing", null);
    const probed = await probeMedia(videoPath);
    const bytes = await fileSize(videoPath);

    await writeJsonAtomic(join(workDir, "remotion-render.json"), {
      renderer: this.id,
      renderer_version: this.version,
      composition: composition.id,
      durationInFrames: composition.durationInFrames,
      fps: composition.fps,
      width: composition.width,
      height: composition.height,
      measured_audio_s: adapter.props.audio.duration_s,
      video_duration_s: adapter.props.duration_s,
      tail_hold_s: this.tailHold,
      quality,
      staged_audio: stagedName,
      notes: adapter.notes,
    });

    return {
      video_path: videoPath,
      video_duration_s: probed.duration_s,
      audio_duration_s: adapter.props.audio.duration_s,
      width: composition.width,
      height: composition.height,
      bytes,
      frames: composition.durationInFrames,
      renderer_id: this.id,
      renderer_version: this.version,
      // The content-addressed cache in front of this engine decides this. Reporting
      // a hit from inside the engine would be a guess.
      cache_hit: false,
      duration_ms: Date.now() - startedAt,
    };
  }

  private async buildBundle(workDir: string, publicDir: string): Promise<string> {
    const bundleDir = join(workDir, "remotion-bundle");
    if (this.reuseBundle && existsSync(join(bundleDir, "index.html"))) {
      this.onProgress?.("bundling", 1);
      return bundleDir;
    }
    await ensureDirAsync(bundleDir);
    this.onProgress?.("bundling", 0);
    return bundle({
      entryPoint: this.entryPoint,
      outDir: bundleDir,
      publicDir,
      onProgress: (progress) => this.onProgress?.("bundling", progress / 100),
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          // Every package in this workspace imports relatively as "./x.js", which is
          // what `tsc` under NodeNext requires and what the rest of the repo already
          // does. Webpack does not rewrite a `.js` specifier to the `.tsx` file that
          // is actually there, so it is told to. Without this the bundle fails on
          // the first import with "Root.js doesn't exist", which reads like a missing
          // file rather than a resolver mismatch.
          extensionAlias: {
            ".js": [".ts", ".tsx", ".js"],
            ".mjs": [".mts", ".mjs"],
          },
        },
      }),
    });
  }
}
