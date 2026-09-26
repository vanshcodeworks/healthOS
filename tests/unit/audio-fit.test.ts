// Segment fitting decides where every caption sits in the finished video.
//
// The rule it has to hold: the segments tile the track with no gap and no
// overlap, in order, whatever the individual measurements were. A caption that
// starts early or ends late is a caption on the wrong words.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fitSegments, measureLines, wavDurationSeconds } from "@hc/audio";
import type { FittedSegment, TtsProvider, VoiceProfile } from "@hc/audio";

const dir = mkdtempSync(join(tmpdir(), "hc-audio-"));
afterAll(() => {
  for (const f of wavFiles) writeFileSync(f, Buffer.alloc(0));
});

/** Build a minimal canonical RIFF header with a given data size and byte rate. */
function wav(dataSize: number, byteRate: number): string {
  const path = join(dir, `wav-${wavFiles.length}.wav`);
  wavFiles.push(path);
  const b = Buffer.alloc(44);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + dataSize, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt32LE(1, 20);
  b.writeUInt32LE(1, 22);
  b.writeUInt32LE(byteRate, 28);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(dataSize, 40);
  writeFileSync(path, b);
  return path;
}

const wavFiles: string[] = [];

const profile: VoiceProfile = {
  voice_id: "stub",
  provider: "stub",
  words_per_minute: 165,
  utterance_overhead_s: 0,
  disclosure: "",
};

/** A provider that reports the requested duration instead of speaking. */
const stub = (durationFor: (text: string) => number): TtsProvider => ({
  profile,
  synthesiseTrack() {
    return Promise.resolve({ audio_path: "", duration_s: 0, audio_hash: "0".repeat(64) });
  },
  measureAll(lines) {
    return Promise.resolve(lines.map(durationFor));
  },
});

/** A provider whose every call fails, as a missing voice would. */
const failing: TtsProvider = {
  profile,
  synthesiseTrack() {
    return Promise.reject(new Error("no voice available"));
  },
  measureAll() {
    return Promise.reject(new Error("no voice available"));
  },
};

describe("wavDurationSeconds", () => {
  it("derives duration from the data chunk and byte rate", () => {
    expect(wavDurationSeconds(wav(32_000, 32_000))).toBe(1);
    expect(wavDurationSeconds(wav(16_000, 32_000))).toBe(0.5);
  });

  it("refuses a file that is not RIFF rather than reporting a bogus duration", () => {
    const path = join(dir, "not-riff.wav");
    wavFiles.push(path);
    writeFileSync(path, Buffer.alloc(64));
    expect(() => wavDurationSeconds(path)).toThrow(/not a RIFF file/);
  });

  it("refuses a file with no data chunk", () => {
    const path = join(dir, "no-data.wav");
    wavFiles.push(path);
    const b = Buffer.alloc(44);
    b.write("RIFF", 0, "ascii");
    b.write("WAVE", 8, "ascii");
    writeFileSync(path, b);
    expect(() => wavDurationSeconds(path)).toThrow(/no data chunk/);
  });

  it("refuses a zero byte rate instead of dividing by zero", () => {
    expect(() => wavDurationSeconds(wav(1000, 0))).toThrow(/zero byte rate/);
  });
});

describe("fitSegments", () => {
  /** Index without tripping `noUncheckedIndexedAccess` on a known-length array. */
  const at = (xs: FittedSegment[], i: number): FittedSegment => {
    const s = xs[i];
    if (!s) throw new Error(`no segment at ${i}`);
    return s;
  };

  it("keeps lines ordered, non-overlapping and inside the track", () => {
    const segments = fitSegments([1, 3, 2], 12, { sentence_pause_s: 0.5 });
    expect(segments.map((s) => s.index)).toEqual([0, 1, 2]);
    for (let i = 1; i < segments.length; i += 1) {
      // Gaps are expected: the engine pauses between sentences. Overlap is not.
      expect(at(segments, i).start_s).toBeGreaterThanOrEqual(at(segments, i - 1).end_s);
      expect(at(segments, i).start_s).toBeCloseTo(at(segments, i - 1).end_s + 0.5, 6);
    }
    for (const s of segments) {
      expect(s.start_s).toBeGreaterThanOrEqual(0);
      expect(s.end_s).toBeLessThanOrEqual(12);
    }
  });

  it("starts at the voice, not at the head of the track", () => {
    // Measured: SAPI audio begins 0.12s into the file, so a caption that belongs
    // on the first word belongs at the start, not after a padding of silence.
    const track = 3.0 + 2 * 1.389;
    const segments = fitSegments([1.5, 1.5], track, { sentence_pause_s: 1.389 });
    expect(at(segments, 0).start_s).toBeCloseTo(0, 6);
    expect(at(segments, 0).end_s).toBeCloseTo(1.5, 6);
  });

  it("puts the engine's surplus time between the lines, not in front of them", () => {
    // A track of 2 lines is content + 2 x 1.389s. Putting half the surplus at the
    // head would delay the first caption by 1.4s and grow with the line count.
    const track = 1.72 + 2.21 + 2 * 1.389;
    const segments = fitSegments([1.72, 2.21], track, { sentence_pause_s: 1.389 });
    expect(at(segments, 0).start_s).toBe(0);
    expect(at(segments, 0).end_s).toBeCloseTo(1.72, 3);
    expect(at(segments, 1).start_s).toBeCloseTo(1.72 + 1.389, 3);
  });

  it("does not stretch content to fill an engine's pause", () => {
    // The bug this guards: rescaling to fill the track multiplies every line by
    // track/content, so a 1.72s line in a 6.71s track became 5.1s.
    const track = 1.72 + 2.21 + 2 * 1.389;
    const first = at(fitSegments([1.72, 2.21], track, { sentence_pause_s: 1.389 }), 0);
    const second = at(fitSegments([1.72, 2.21], track, { sentence_pause_s: 1.389 }), 1);
    expect(first.end_s - first.start_s).toBeCloseTo(1.72, 3);
    expect(second.end_s - second.start_s).toBeCloseTo(2.21, 3);
  });

  it("leaves the closing silence uncaptioned", () => {
    const track = 1.72 + 2.21 + 2 * 1.389;
    const segments = fitSegments([1.72, 2.21], track, { sentence_pause_s: 1.389 });
    expect(at(segments, segments.length - 1).end_s).toBeLessThan(track);
  });

  it("derives the gap from the surplus when the engine does not report one", () => {
    const segments = fitSegments([1, 1], 6);
    expect(at(segments, 0).start_s).toBe(0);
    // Surplus is 4s over 2 lines, so 2s sits after each.
    expect(at(segments, 1).start_s).toBeCloseTo(3, 6);
  });

  it("keeps proportion so a long line gets a long window", () => {
    // No unexplained time here, so the two lines split the track exactly.
    const segments = fitSegments([2, 6], 8);
    expect(at(segments, 0).end_s - at(segments, 0).start_s).toBeCloseTo(2, 6);
    expect(at(segments, 1).end_s - at(segments, 1).start_s).toBeCloseTo(6, 6);
  });

  it("clamps when the measurements claim more time than the track has", () => {
    const segments = fitSegments([10, 10], 12);
    const last = at(segments, segments.length - 1);
    expect(last.end_s).toBeLessThanOrEqual(12);
    for (const s of segments) expect(s.end_s).toBeGreaterThan(s.start_s);
  });

  it("spreads the track evenly when nothing could be measured", () => {
    const segments = fitSegments([0, 0], 10);
    expect(segments).toHaveLength(2);
    expect(at(segments, 0).start_s).toBe(0);
    expect(at(segments, 1).end_s).toBe(10);
    expect(at(segments, 1).start_s - at(segments, 0).end_s).toBeCloseTo(0, 6);
  });

  it("gives a zero measurement a window instead of hiding its caption", () => {
    const segments = fitSegments([0, 4], 8);
    expect(at(segments, 0).end_s).toBeGreaterThan(at(segments, 0).start_s);
    // The usable measurement still dominates, so the long line keeps the track.
    expect(at(segments, 1).end_s - at(segments, 1).start_s).toBeGreaterThan(3);
  });

  it("returns nothing for no lines", () => {
    expect(fitSegments([], 5)).toEqual([]);
  });

  it("returns empty windows for a zero-length track rather than dividing by zero", () => {
    for (const s of fitSegments([1, 2], 0)) expect(s.end_s).toBe(s.start_s);
  });
});

describe("measureLines", () => {
  it("estimates when there is no provider", async () => {
    const result = await measureLines(undefined, ["Caffeine blocks receptors."], () => 2.5);
    expect(result).toEqual({ durations: [2.5], source: "estimated" });
  });

  it("prefers provider measurements when they are available", async () => {
    const result = await measureLines(stub(() => 2), ["a", "b"], () => 99);
    expect(result).toEqual({ durations: [2, 2], source: "measured" });
  });

  it("falls back to the estimator when the provider throws", async () => {
    const result = await measureLines(failing, ["Caffeine blocks receptors."], () => 2.5);
    expect(result).toEqual({ durations: [2.5], source: "estimated" });
  });

  it("falls back rather than emitting empty audio when the count is wrong", async () => {
    const wrongCount: TtsProvider = {
      ...stub(() => 2),
      measureAll: () => Promise.resolve([2]),
    };
    const result = await measureLines(wrongCount, ["a", "b"], () => 3);
    expect(result).toEqual({ durations: [3, 3], source: "estimated" });
  });

  it("falls back on a negative measurement", async () => {
    const negative: TtsProvider = {
      ...stub(() => -1),
      measureAll: () => Promise.resolve([-1, -1]),
    };
    const result = await measureLines(negative, ["a", "b"], () => 3);
    expect(result.source).toBe("estimated");
  });
});
