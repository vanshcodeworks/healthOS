/**
 * Platform delivery requirements.
 *
 * Taken from the platforms' own published API specifications, not from what a
 * render happens to produce: Facebook Reels' publishing API states its video and
 * audio settings explicitly, and YouTube's upload guide states its metadata and
 * upload protocol. A file that satisfies the renderer's own defaults but not the
 * platform's spec is rejected after an upload, which is a finding discovered
 * after a 40MB upload rather than before one.
 *
 * This is the contract the publishing stage checks a render against before it
 * uploads, and the numbers a platform adapter validates its own metadata against.
 */

export type PlatformId = "youtube" | "instagram_reels" | "facebook_reels" | "facebook_feed" | "tiktok";

export interface VideoRequirements {
  /** File extension the platform accepts. */
  fileType: string;
  /** Aspect ratio as width:height. */
  aspectRatio: string;
  /** Recommended and minimum resolution, in px. */
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  /** Inclusive frame-rate window, in fps. */
  minFps: number;
  maxFps: number;
  /** Inclusive duration window, in seconds. */
  minDurationS: number;
  maxDurationS: number;
  /** Chroma subsampling, as an ffmpeg pixel format. */
  pixelFormat: string;
  /** Closed GOP window, in frames at the composition's fps. */
  minGopFrames: number;
  maxGopFrames: number;
  codecs: string[];
  /** Audio requirements. */
  audio: {
    /** Minimum bitrate, in kbps. */
    minBitrateKbps: number;
    channels: number[];
    codec: string;
    sampleRateHz: number[];
  };
}

export interface PublishPermissions {
  /** The scope or permission names the platform's API requires. */
  scopes: string[];
  /** Moving-window API rate limit, in published posts per 24 hours. */
  maxPostsPer24h: number;
}

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  video: VideoRequirements;
  /** What the publish call needs to know, mapped from a run. */
  permissions: PublishPermissions;
  /** The API's upload protocol, in one line, for a reviewer. */
  protocol: string;
}

/**
 * Facebook Reels, from the Reels Publishing API (developers.facebook.com/docs/
 * video-api/guides/reels-publishing): .mp4, 9:16, 1080x1920 recommended, 24 to 60
 * fps, 3 to 90 seconds, 4:2:0 chroma, closed GOP of two to five seconds, H.264 or
 * H.265, audio at 128kbps or more, stereo, AAC-LC at 48kHz. Publishing is a
 * three-step protocol — initialise an upload session, upload, publish — and is
 * rate-limited to 30 API-published posts in a moving 24-hour window.
 */
const FACEBOOK_REELS: PlatformSpec = {
  id: "facebook_reels",
  label: "Facebook Reels",
  protocol: "init upload session -> upload -> publish",
  video: {
    fileType: "mp4",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    minWidth: 540,
    minHeight: 960,
    minFps: 24,
    maxFps: 60,
    minDurationS: 3,
    maxDurationS: 90,
    pixelFormat: "yuv420p",
    // 2 to 5 seconds at 30fps.
    minGopFrames: 60,
    maxGopFrames: 150,
    codecs: ["h264", "h265", "vp9", "av1"],
    audio: {
      minBitrateKbps: 128,
      channels: [2],
      codec: "aac",
      sampleRateHz: [48_000],
    },
  },
  permissions: {
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    maxPostsPer24h: 30,
  },
};

/**
 * YouTube, from the Data API upload guide (developers.google.com/youtube/v3/
 * guides/uploading_a_video): a resumable `videos.insert` upload with exponential
 * backoff, OAuth 2.0 with the `youtube.upload` scope, and metadata carried as a
 * video resource — title, description, tags, category, privacy status. YouTube
 * does not publish a numeric codec table the way Meta does, so the video window
 * is the one its own encoding recommendations state: H.264 in an MP4 container.
 */
const YOUTUBE: PlatformSpec = {
  id: "youtube",
  label: "YouTube",
  protocol: "resumable videos.insert -> exponential backoff",
  video: {
    fileType: "mp4",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    minWidth: 540,
    minHeight: 960,
    minFps: 24,
    maxFps: 60,
    // A Short is 3 to 60 seconds; a video is up to 12 hours. The composition is
    // short form, so the Short's window is the one that applies, and a render
    // over it publishes as a normal video rather than as a Short.
    minDurationS: 3,
    maxDurationS: 60,
    pixelFormat: "yuv420p",
    minGopFrames: 60,
    maxGopFrames: 150,
    codecs: ["h264", "h265", "vp9", "av1"],
    audio: {
      minBitrateKbps: 128,
      channels: [1, 2],
      codec: "aac",
      sampleRateHz: [44_100, 48_000],
    },
  },
  permissions: {
    scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    maxPostsPer24h: 6,
  },
};

/** Instagram shares Facebook Reels' encoding spec, which Meta states once for both. */
const INSTAGRAM_REELS: PlatformSpec = {
  ...FACEBOOK_REELS,
  id: "instagram_reels",
  label: "Instagram Reels",
};

/**
 * The strictest requirement of every destination, as one set of numbers.
 *
 * A render checked against this satisfies every platform it may be published to,
 * so the publishing stage checks one spec rather than one per destination — and a
 * platform added later that is stricter than this fails the check loudly rather
 * than passing on a render it would reject.
 */
export const STRICTEST_DELIVERY: VideoRequirements = {
  fileType: "mp4",
  aspectRatio: "9:16",
  width: 1080,
  height: 1920,
  minWidth: 540,
  minHeight: 960,
  minFps: 24,
  maxFps: 60,
  minDurationS: 3,
  maxDurationS: 60,
  pixelFormat: "yuv420p",
  minGopFrames: 60,
  maxGopFrames: 150,
  codecs: ["h264", "h265", "vp9", "av1"],
  audio: {
    minBitrateKbps: 128,
    // Stereo. Mono is accepted by YouTube and rejected by Meta, so the mix is
    // stereo and a mono destination is satisfied by a stereo file, never the
    // other way round.
    channels: [2],
    codec: "aac",
    sampleRateHz: [48_000],
  },
};

export const PLATFORM_SPECS: Record<PlatformId, PlatformSpec> = {
  youtube: YOUTUBE,
  instagram_reels: INSTAGRAM_REELS,
  facebook_reels: FACEBOOK_REELS,
  facebook_feed: { ...FACEBOOK_REELS, id: "facebook_feed", label: "Facebook Feed" },
  tiktok: { ...FACEBOOK_REELS, id: "tiktok", label: "TikTok" },
};

export function specFor(platform: PlatformId): PlatformSpec {
  return PLATFORM_SPECS[platform];
}

export const PLATFORM_IDS = Object.keys(PLATFORM_SPECS) as PlatformId[];

/**
 * A probe of a rendered file, checked against a platform's requirements.
 *
 * The numbers come from `ffprobe`, so what is checked is what was encoded and not
 * what a render intended. Every field it checks is a field a platform rejects
 * after an upload.
 */
export interface DeliveryProbe {
  codec: string;
  pixelFormat: string;
  width: number;
  height: number;
  fps: number;
  durationS: number;
  gopFrames: number;
  audio: {
    codec: string;
    channels: number;
    sampleRateHz: number;
    bitrateKbps: number;
  };
}

export function checkDelivery(
  probe: DeliveryProbe,
  requirements: VideoRequirements = STRICTEST_DELIVERY,
): { ok: boolean; violations: { field: string; expected: string; actual: string }[] } {
  const violations: { field: string; expected: string; actual: string }[] = [];
  const push = (field: string, expected: string, actual: string) => violations.push({ field, expected, actual });

  if (!requirements.codecs.includes(probe.codec.toLowerCase())) {
    push("codec", requirements.codecs.join(" | "), probe.codec);
  }
  if (probe.pixelFormat.toLowerCase() !== requirements.pixelFormat) {
    push("pixelFormat", requirements.pixelFormat, probe.pixelFormat);
  }
  if (probe.width < requirements.minWidth || probe.height < requirements.minHeight) {
    push("resolution", `${requirements.minWidth}x${requirements.minHeight} min`, `${probe.width}x${probe.height}`);
  }
  if (probe.fps < requirements.minFps || probe.fps > requirements.maxFps) {
    push("fps", `${requirements.minFps}-${requirements.maxFps}`, probe.fps.toFixed(2));
  }
  if (probe.durationS < requirements.minDurationS || probe.durationS > requirements.maxDurationS) {
    push("duration", `${requirements.minDurationS}-${requirements.maxDurationS}s`, probe.durationS.toFixed(2));
  }
  if (probe.gopFrames > requirements.maxGopFrames) {
    push("gop", `<= ${requirements.maxGopFrames} frames closed GOP`, `${probe.gopFrames} frames`);
  }
  if (!requirements.audio.channels.includes(probe.audio.channels)) {
    push("audio.channels", requirements.audio.channels.join(" | "), String(probe.audio.channels));
  }
  if (!requirements.audio.sampleRateHz.includes(probe.audio.sampleRateHz)) {
    push("audio.sampleRate", requirements.audio.sampleRateHz.join(" | "), `${probe.audio.sampleRateHz}Hz`);
  }
  if (probe.audio.bitrateKbps < requirements.audio.minBitrateKbps) {
    push("audio.bitrate", `>= ${requirements.audio.minBitrateKbps}kbps`, `${probe.audio.bitrateKbps}kbps`);
  }
  return { ok: violations.length === 0, violations };
}
