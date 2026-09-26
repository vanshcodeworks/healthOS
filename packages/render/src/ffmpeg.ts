import { HealthOSError, ensureDirAsync, run, writeFileAtomic } from "@hc/core";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { RenderScene, VideoSpec } from "./types.js";

export interface MediaInfo {
  duration_s: number;
  width: number;
  height: number;
  has_audio: boolean;
  video_codec: string;
  audio_codec: string;
}

function seconds(value: number): string {
  return value.toFixed(3);
}

/** Reads real numbers out of a finished file instead of trusting the plan. */
export async function probeMedia(path: string): Promise<MediaInfo> {
  const result = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-show_entries",
    "stream=codec_type,codec_name,width,height",
    "-of",
    "json",
    path,
  ]);
  if (result.code !== 0) {
    throw new HealthOSError(`ffprobe failed for ${path}: ${result.stderr.trim()}`, {
      category: "INTERNAL",
    });
  }
  const parsed = JSON.parse(result.stdout) as {
    format?: { duration?: string };
    streams?: {
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
    }[];
  };
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const duration = Number(parsed.format?.duration ?? "0");
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new HealthOSError(`ffprobe reported no usable duration for ${path}`, {
      category: "INTERNAL",
    });
  }
  return {
    duration_s: duration,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    has_audio: Boolean(audio),
    video_codec: video?.codec_name ?? "",
    audio_codec: audio?.codec_name ?? "",
  };
}

export interface EncodeOptions {
  scenes: RenderScene[];
  /** Captured frame count per scene, in scene order. */
  sceneFrameCounts: number[];
  /** Directory holding `scene-NNN/frame-NNNN.png` sequences. */
  framesRoot: string;
  audioPath: string;
  audioDurationS: number;
  outPath: string;
  spec: VideoSpec;
  /**
   * Grace allowed when comparing video against audio, in seconds. A frame is
   * 1/30s, so anything under that is a rounding artefact rather than clipping.
   */
  toleranceS?: number;
}

/**
 * Encodes the captured frames and lays the existing narration under them.
 *
 * Each scene's PNG sequence becomes its own segment, and the segments are
 * joined with `-c copy` so nothing is re-encoded twice. The audio is never
 * re-timed: there is no `-shortest` and no trim here on purpose, because both
 * of those shorten a track to fit a picture, and the track holds the spoken
 * disclaimer. If the shots do not cover the audio, that is a timeline bug to
 * fix upstream, and this function throws rather than hiding it.
 */
export async function encodeTimeline(options: EncodeOptions): Promise<MediaInfo> {
  const tolerance = options.toleranceS ?? 0.05;
  if (options.scenes.length !== options.sceneFrameCounts.length) {
    throw new HealthOSError("frame count table does not match scene count", {
      category: "INVALID_REQUEST",
    });
  }
  if (options.scenes.length === 0) {
    throw new HealthOSError("cannot encode a video with no shots", {
      category: "INVALID_REQUEST",
    });
  }
  const timelineS = options.scenes.reduce((sum, s) => sum + Math.max(0, s.duration_s), 0);
  if (timelineS + tolerance < options.audioDurationS) {
    throw new HealthOSError(
      `shots cover ${seconds(timelineS)}s but the narration is ${seconds(
        options.audioDurationS,
      )}s; refusing to cut audio to fit`,
      { category: "INVALID_REQUEST" },
    );
  }

  const workRoot = `${options.outPath}.work`;
  await ensureDirAsync(workRoot);

  // One segment per scene, each exactly as long as its shot.
  const segmentPaths: string[] = [];
  for (let i = 0; i < options.scenes.length; i += 1) {
    const scene = options.scenes[i];
    const count = options.sceneFrameCounts[i];
    if (!scene || !count) {
      throw new HealthOSError(`missing captured frames for scene ${scene?.scene_id ?? i}`, {
        category: "INVALID_REQUEST",
      });
    }
    const sceneDir = join(options.framesRoot, `scene-${String(i + 1).padStart(3, "0")}`);
    if (!existsSync(join(sceneDir, "frame-0001.png"))) {
      throw new HealthOSError(`scene ${scene.scene_id} has no captured frames`, {
        category: "INVALID_REQUEST",
      });
    }
    const segmentPath = join(workRoot, `seg-${String(i + 1).padStart(3, "0")}.mp4`);
    const result = await run(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-framerate",
        String(options.spec.fps),
        "-start_number",
        "1",
        "-i",
        join(sceneDir, "frame-%04d.png"),
        "-frames:v",
        String(count),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        String(options.spec.crf),
        "-maxrate",
        options.spec.videoBitrate,
        "-bufsize",
        "16M",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(options.spec.fps),
        "-g",
        String(options.spec.fps * 2),
        segmentPath,
      ],
      { timeoutMs: 15 * 60_000 },
    );
    if (result.code !== 0) {
      throw new HealthOSError(
        `ffmpeg failed on scene ${scene.scene_id}: ${result.stderr.trim().slice(0, 400)}`,
        { category: "INTERNAL" },
      );
    }
    segmentPaths.push(segmentPath);
  }

  // Segments are joined losslessly: every file carries its own exact duration,
  // so the concat demuxer is reliable here in a way it never is for stills.
  const listPath = join(workRoot, "concat.txt");
  await writeFileAtomic(
    listPath,
    `${segmentPaths.map((p) => `file '${basename(p)}'`).join("\n")}\n`,
  );
  const silentPath = join(workRoot, "silent.mp4");
  const concat = await run(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      silentPath,
    ],
    { timeoutMs: 10 * 60_000 },
  );
  if (concat.code !== 0) {
    throw new HealthOSError(`ffmpeg concat failed: ${concat.stderr.trim().slice(0, 400)}`, {
      category: "INTERNAL",
    });
  }

  const { spec } = options;
  const mux = await run(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      silentPath,
      "-i",
      options.audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      spec.audioBitrate,
      "-ar",
      "48000",
      "-ac",
      "2",
      // `-shortest` is intentionally absent. See the note above.
      "-movflags",
      "+faststart",
      options.outPath,
    ],
    { timeoutMs: 10 * 60_000 },
  );
  if (mux.code !== 0) {
    throw new HealthOSError(`ffmpeg mux failed: ${mux.stderr.trim().slice(0, 400)}`, {
      category: "INTERNAL",
    });
  }
  return probeMedia(options.outPath);
}
