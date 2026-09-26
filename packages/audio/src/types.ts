/**
 * Text to speech: measuring how long narration actually takes, and producing it.
 *
 * The distinction this package exists to enforce: an *estimate* is a planning
 * input, a *measurement* is a fact. Storyboards may be planned from estimates,
 * but nothing that claims to describe a finished video may be built on one.
 */

/** How a voice sounds, and what the engine costs to invoke it. */
export interface VoiceProfile {
  voice_id: string;
  provider: string;
  /** Measured pace for plain prose, in words per minute. */
  words_per_minute: number;
  /**
   * Silence the engine adds around every utterance it is handed.
   *
   * Windows SAPI pads each `Speak` call by about 1.39 seconds. Synthesising one
   * file per scene therefore adds roughly 1.4s x scene_count of dead air to a
   * finished video, which is why {@link TtsProvider.synthesiseTrack} takes every
   * line at once. Measured per provider, never assumed.
   */
  utterance_overhead_s: number;
  /** Text a platform requires alongside synthesised narration. */
  disclosure: string;
}

/** One continuous narration track. */
export interface TrackResult {
  audio_path: string;
  duration_s: number;
  audio_hash: string;
}

/**
 * A speech engine.
 *
 * `measureAll` and `synthesiseTrack` are separate on purpose. Measuring needs one
 * engine call per line to learn where the boundaries are; producing the track
 * needs a single call to avoid the per-utterance pad. The two therefore return
 * different totals, and {@link fitSegments} reconciles them.
 */
export interface TtsProvider {
  readonly profile: VoiceProfile;
  /** Content duration per line in seconds, excluding the per-utterance pad. */
  measureAll(texts: string[]): Promise<number[]>;
  /** Synthesise every line into one continuous WAV. */
  synthesiseTrack(texts: string[], outPath: string): Promise<TrackResult>;
}

/** Narration line timing placed on a continuous track. */
export interface FittedSegment {
  index: number;
  start_s: number;
  end_s: number;
}

export interface FitOptions {
  /**
   * Silence before the first word of a single-utterance track.
   *
   * Defaults to zero. Measured on Windows SAPI, the audio starts 0.12s after
   * the file does and ends 0.78s before it, so there is no lead pad worth
   * modelling: nearly all of the time a continuous track spends beyond the sum
   * of its per-line measurements sits *between* the lines, not in front of them.
   */
  lead_s?: number;
  /**
   * Pause the engine inserts after a sentence.
   *
   * Measured rather than assumed: SAPI adds 1.389s per line, which is exactly
   * the constant that looked like a per-call pad when it was first measured on
   * one-word utterances.
   */
  sentence_pause_s?: number;
}

/**
 * Place measured lines onto the track that was actually produced.
 *
 * The per-line measurements and the continuous track cannot both be exact: the
 * track carries sentence pauses the per-line calls do not. Measured on SAPI,
 * a track of `n` lines is the content plus `n` pauses, so the difference is
 * `n` gaps, one after each line, and not one blob at the front.
 *
 * That distinction is the whole point. Stretching the lines to fill the track
 * divides the content by the ratio of the two totals, so a caption that belongs
 * at 0.12s lands at 3.8s and the error compounds with every line. Laying the
 * lines down in order with a pause after each one keeps every caption on the
 * words it was written for, and the closing silence goes uncaptioned because
 * nothing is being said in it.
 */
export function fitSegments(
  contentDurations: number[],
  trackDurationS: number,
  options: FitOptions = {},
): FittedSegment[] {
  const count = contentDurations.length;
  if (count === 0) return [];
  if (trackDurationS <= 0) return contentDurations.map((_, index) => ({ index, start_s: 0, end_s: 0 }));

  const usable = contentDurations.map((d) => (Number.isFinite(d) && d > 0 ? d : 0));

  // With no usable measurement at all there is nothing to be faithful to, and
  // guessing a gap from a total we cannot explain would be inventing timing.
  // Spread the track instead: contiguous, ordered, wrong by at most one line.
  if (usable.every((d) => d <= 0)) {
    const even = trackDurationS / count;
    const spread: FittedSegment[] = [];
    for (let index = 0; index < count; index += 1) {
      spread.push({
        index,
        start_s: round3(index * even),
        end_s: round3(index === count - 1 ? trackDurationS : (index + 1) * even),
      });
    }
    return spread;
  }

  // Subtracting an engine's per-line pause can drive a short line to zero.
  // Pure proportion would then hand that line an invisible caption, so a small
  // floor is mixed in whenever any line came back unusable.
  const floor = usable.some((d) => d <= 0) ? 0.1 * (trackDurationS / count) : 0;
  const weights = usable.map((d) => d + floor);
  const total = weights.reduce((sum, d) => sum + d, 0);
  if (total <= 0) return contentDurations.map((_, index) => ({ index, start_s: 0, end_s: 0 }));

  const lead = Math.max(0, Math.min(options.lead_s ?? 0, trackDurationS));
  const unexplained = Math.max(0, trackDurationS - lead - total);
  // A pause after every line, including the last, which is where the closing
  // silence goes. Known values are trusted; otherwise the surplus is shared out.
  const gap = Math.max(0, options.sentence_pause_s ?? unexplained / count);
  // Never run past the audio, even if the measurements claim more time than the
  // track contains. That means the engine and the per-line calls disagreed.
  const available = trackDurationS - lead - gap * (count - 1);
  const scale = available > 0 ? Math.min(1, available / total) : 0;

  const out: FittedSegment[] = [];
  let cursor = lead;
  weights.forEach((weight, index) => {
    const length = weight * scale;
    out.push({ index, start_s: round3(cursor), end_s: round3(cursor + length) });
    cursor += length + gap;
  });
  return out;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Seconds of narration a line needs, from measurement when available. */
export async function measureLines(
  provider: TtsProvider | undefined,
  texts: string[],
  estimate: (text: string) => number,
): Promise<{ durations: number[]; source: "measured" | "estimated" }> {
  if (!provider || texts.length === 0) {
    return { durations: texts.map((t) => estimate(t)), source: "estimated" };
  }
  try {
    const measured = await provider.measureAll(texts);
    // A provider that returns nothing usable must not silently produce zero-length
    // captions, which would look like a passing run with empty audio.
    if (measured.length !== texts.length || measured.some((d) => !Number.isFinite(d) || d < 0)) {
      return { durations: texts.map((t) => estimate(t)), source: "estimated" };
    }
    return { durations: measured, source: "measured" };
  } catch {
    return { durations: texts.map((t) => estimate(t)), source: "estimated" };
  }
}
