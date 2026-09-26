import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { hashFile, shortHash } from "@hc/core";
import type { TrackResult, TtsProvider, VoiceProfile } from "./types.js";

const run = promisify(execFile);

/**
 * Windows SAPI, for local builds and tests.
 *
 * Chosen because it is present on the machines this is developed on, needs no
 * credentials, and produces a real WAV whose length can be measured rather than
 * guessed. It is not the shipping voice: a hosted voice is better quality and
 * more consistent across machines. The point is that timing is *measured* by
 * default on a developer's machine, so a bad estimate is caught before render.
 */

/**
 * Measured on Microsoft Zira Desktop: every sentence adds this much silence.
 *
 * It was first measured on one-word utterances and read as a flat per-call pad.
 * That reading was wrong, and wrong in a way that survived a two-line sample.
 * Re-measured across 1, 2, 4 and 8 line tracks, the surplus time is exactly
 * `1.389s x line_count` in every case, which means the silence belongs to the
 * sentence, not to the call. A per-line pause is what `measureAll` has to
 * subtract, and what a continuous track puts back between the lines.
 */
export const SAPI_SENTENCE_PAUSE_S = 1.389;

/** Measured pace for plain prose, after numbers and units are expanded. */
export const SAPI_WORDS_PER_MINUTE = 165;

/**
 * Read a WAV's duration from its header.
 *
 * The data chunk size divided by the byte rate is exact, and unlike decoding the
 * audio it costs nothing, which matters when a build measures fourteen lines.
 */
export interface WavInfo {
  duration_s: number;
  sample_rate: number;
  channels: number;
  bits_per_sample: number;
  bytes: number;
}

/**
 * Reads a RIFF/WAVE header.
 *
 * The sample rate and channel count are facts about the file, and the storyboard
 * records them. Guessing 48kHz mono because that is the usual case would put an
 * unverified claim in a document other tools trust.
 */
export function readWavInfo(path: string): WavInfo {
  const buffer = readFileSync(path);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error(`not a RIFF file: ${path}`);
  }
  if (buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`RIFF file is not WAVE: ${path}`);
  }
  const dataIndex = buffer.indexOf(Buffer.from("data", "ascii"), 12);
  if (dataIndex < 0) throw new Error(`no data chunk in ${path}`);
  const byteRate = buffer.readUInt32LE(28);
  const dataSize = buffer.readUInt32LE(dataIndex + 4);
  if (byteRate === 0) throw new Error(`zero byte rate in ${path}`);
  return {
    duration_s: dataSize / byteRate,
    sample_rate: buffer.readUInt32LE(24),
    channels: buffer.readUInt16LE(22),
    bits_per_sample: buffer.readUInt16LE(34),
    bytes: buffer.length,
  };
}

export function wavDurationSeconds(path: string): number {
  const buffer = readFileSync(path);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error(`not a RIFF file: ${path}`);
  }
  const dataIndex = buffer.indexOf(Buffer.from("data", "ascii"), 12);
  if (dataIndex < 0) throw new Error(`no data chunk in ${path}`);
  const byteRate = buffer.readUInt32LE(28);
  const dataSize = buffer.readUInt32LE(dataIndex + 4);
  if (byteRate === 0) throw new Error(`zero byte rate in ${path}`);
  return dataSize / byteRate;
}

/** Quote a PowerShell single-quoted string. */
function ps(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const SCRIPT_HEADER = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($env:HC_SAPI_VOICE)
$synth.Rate = [int]$env:HC_SAPI_RATE
`;

export interface SapiOptions {
  voice?: string;
  /** -10 to 10, as SAPI defines it. */
  rate?: number;
  /**
   * Scratch directory for per-line measurement files.
   *
   * Optional: without it the provider uses a temporary directory keyed by the
   * text being measured, so two concurrent builds cannot overwrite each other.
   */
  workDir?: string;
}

export class SapiTtsProvider implements TtsProvider {
  readonly profile: VoiceProfile;

  private readonly rate: number;
  /** Optional; a temporary directory is derived per measurement batch. */
  private readonly workDir: string | undefined;

  /** Every field has a default, so the plain provider needs no configuration. */
  constructor(options: SapiOptions = {}) {
    const voice = options.voice ?? "Microsoft Zira Desktop";
    this.rate = options.rate ?? 0;
    this.workDir = options.workDir;
    this.profile = {
      voice_id: voice,
      provider: "windows_sapi",
      words_per_minute: SAPI_WORDS_PER_MINUTE,
      utterance_overhead_s: SAPI_SENTENCE_PAUSE_S,
      disclosure: "Narration synthesised with a local text-to-speech voice.",
    };
  }

  private get voice(): string {
    return this.profile.voice_id;
  }

  /**
   * Synthesise one batch, each line to its own file, in a single engine load.
   *
   * `scratchDir` is where per-line measurement files go. It defaults to the
   * directory of the track being produced, because that directory is guaranteed
   * to exist and to be somewhere the caller already owns.
   */
  private async speakBatch(
    lines: string[],
    outPaths: string[],
    scratchDir: string,
  ): Promise<void> {
    mkdirSync(scratchDir, { recursive: true });
    // One PowerShell process for the whole batch: engine start-up costs more than
    // the synthesis does, and a build measures every line of every video.
    const script = `
${SCRIPT_HEADER}
$paths = @(${outPaths.map((p) => ps(p)).join(",")})
$lines = @(${lines.map((l) => ps(l)).join(",")})
for ($i = 0; $i -lt $lines.Count; $i++) {
  $synth.SetOutputToWaveFile($paths[$i])
  $synth.Speak($lines[$i])
}
$synth.Dispose()
`;
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, HC_SAPI_VOICE: this.voice, HC_SAPI_RATE: String(this.rate) },
      maxBuffer: 1024 * 1024 * 32,
      timeout: 180_000,
    });
  }

  async measureAll(texts: string[]): Promise<number[]> {
    if (texts.length === 0) return [];
    // One scratch directory per batch, so two runs cannot collide on
    // `measure-0.wav` while both are in flight.
    const scratch = this.workDir
      ? join(this.workDir, `measure-${shortHash(texts.join("|"), 8)}`)
      : join(tmpdir(), `hc-sapi-measure-${shortHash(texts.join("|"), 8)}`);
    const paths = texts.map((_, i) => join(scratch, `measure-${i}.wav`));
    try {
      await this.speakBatch(texts, paths, scratch);
      return paths.map((path) => {
        const measured = wavDurationSeconds(path);
        // The pad is per utterance, so a line measured on its own carries exactly
        // one of them. Subtracting it leaves the content another engine would
        // speak with no padding at all.
        return Math.max(0, Math.round((measured - this.profile.utterance_overhead_s) * 1000) / 1000);
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  async synthesiseTrack(texts: string[], outPath: string): Promise<TrackResult> {
    // One utterance for the whole narration. This is the whole reason the track
    // API exists: a call per line would add ~1.4s of silence per scene.
    const joined = texts.filter((t) => t.trim().length > 0).join(" ");
    if (joined.length === 0) throw new Error("cannot synthesise an empty narration");
    mkdirSync(dirname(outPath), { recursive: true });
    await this.speakBatch([joined], [outPath], dirname(outPath));
    return {
      audio_path: outPath,
      duration_s: Math.round(wavDurationSeconds(outPath) * 1000) / 1000,
      audio_hash: await hashFile(outPath),
    };
  }
}

/** Whether a local SAPI voice is usable, so callers can fall back deliberately. */
export async function sapiAvailable(voice = "Microsoft Zira Desktop"): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($env:HC_SAPI_VOICE)
$name = $synth.Voice.Name
$synth.Dispose()
Write-Output $name
`;
  try {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, HC_SAPI_VOICE: voice },
      timeout: 30_000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
