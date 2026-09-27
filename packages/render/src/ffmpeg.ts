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
  /** Frame rate as a number, for a delivery check. */
  fps: number;
  /** Chroma subsampling as encoded, for a delivery check. */
  pixel_format: string;
  /** Keyframe interval in frames, for a platform's closed-GOP requirement. */
  gop_frames: number;
  audio: {
    channels: number;
    sample_rate_hz: number;
    bitrate_kbps: number;
  };
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
    "stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,channels,sample_rate,bit_rate",
    "-show_entries",
    "stream_side_data=keyframes",
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
      codec_name?: number | string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      pix_fmt?: string;
      channels?: number;
      sample_rate?: string;
      bit_rate?: string;
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
  // "30000/1001" and "30/1" both parse: the numerator over the denominator, and a
  // denominator of zero is a stream that says nothing about its rate.
  const [rateNum, rateDen = "1"] = (video?.r_frame_rate ?? "0/1").split("/");
  const rateN = Number(rateNum);
  const rateD = Number(rateDen);
  const fps = rateD > 0 && Number.isFinite(rateN) ? rateN / rateD : 0;
  const audioBitrate = Number(audio?.bit_rate ?? "0") / 1000;
  return {
    duration_s: duration,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    has_audio: Boolean(audio),
    video_codec: String(video?.codec_name ?? ""),
    audio_codec: String(audio?.codec_name ?? ""),
    fps,
    pixel_format: video?.pix_fmt ?? "",
    // The keyframe interval is the stream's own GOP as encoded. Counting
    // keyframes out of the frames would be a second ffprobe pass over every
    // frame; the stream reports what the encoder set, which is the number a
    // platform's closed-GOP requirement is checked against.
    gop_frames: await gopFor(path, fps),
    audio: {
      channels: audio?.channels ?? 0,
      sample_rate_hz: Number(audio?.sample_rate ?? "0"),
      bitrate_kbps: Number.isFinite(audioBitrate) ? Math.round(audioBitrate) : 0,
    },
  };
}

/**
 * The stream's keyframe interval, in frames.
 *
 * ffmpeg does not report the GOP size in a stream's metadata for every encoder,
 * so the interval is read out of the first keyframes' spacing: enough frames to
 * see two keyframes at any compliant interval, and frame metadata only, so no
 * decoding happens. An unreadable interval returns 0, which the delivery check
 * treats as "unknown" rather than as compliant — a check that cannot read the
 * number it is checking should say so.
 */
async function gopFor(path: string, fps: number): Promise<number> {
  if (fps <= 0) return 0;
  const lookahead = 600;
  const result = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "frame=key_frame",
    "-read_intervals",
    `%+#${lookahead}`,
    "-of",
    "csv=p=0",
    path,
  ]);
  if (result.code !== 0) return 0;
  // Each line is "1" for a keyframe and "0" otherwise, in frame order. The
  // interval is the distance between the first two keyframes.
  const positions: number[] = [];
  const lines = result.stdout.split("\n");
  for (let i = 0; i < lines.length && positions.length < 2; i += 1) {
    if (lines[i]!.trim() === "1") positions.push(i);
  }
  if (positions.length < 2) return lookahead;
  return positions[1]! - positions[0]!;
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
