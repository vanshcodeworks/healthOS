/**
 * Captions.
 *
 * Captions are timed to the voice, not to the frame grid. A cue's window comes
 * from the measured narration track, and when a cue carries per-word alignment
 * that is used directly; when it does not, the cue's span is divided between its
 * words in proportion to their length, which is an approximation and is
 * documented as one rather than pretending to be alignment.
 *
 * A cue is never allowed to run past its scene unless the storyboard explicitly
 * asked for a cue that crosses a boundary. A caption that appears 400ms after the
 * shot it belongs to has cut is a subtitle error, not a style.
 *
 * The look is deliberately quiet: small, letter-spaced sans in the lower band,
 * with the word currently being spoken carried by weight and colour rather than
 * by a pop or a scale. The caption is not the video's main event.
 */

import { useCurrentFrame } from "remotion";
import { FONTS } from "../art/typography.js";
import { ease } from "../motion/ease.js";
import { fitFontSize, measureLine } from "../art/measure.js";
import { FRAME, captionCentreY, CONTENT } from "../art/spacing.js";
import type { Palette } from "../art/palette.js";
import type { CaptionRef } from "../props.js";

/** Per-character tracking, in px. Part of the measure, not a correction to it. */
const TRACKING = 0.4;

/**
 * The measured family behind a caption line: Inter at weight 500, tracked.
 *
 * The gap between two words on screen is the font's own space advance, so it is
 * asked of the measure rather than written down. The literal it replaced was
 * `0.26em`, which is only 2.5% off Inter 500's real `0.2666em` — the space was
 * never the problem.
 *
 * The problem was the letters. The band used to be fitted against a hand-written
 * table of average per-character factors which charged an `n` 0.52em, where Inter
 * 500 is 0.6016em: 16% narrow on the most common character in English. A line the
 * table believed was 916px wide painted at 1019px and ran off both sides of a
 * 948px column. Taking the gap from the measure is still the right thing to do —
 * a second, hand-written width is a second thing to be wrong — but it is the
 * letters, not the gaps, that put a caption off the edge of the frame.
 */
const CAPTION_MEASURE = { font: "text", weight: 500, letterSpacing: TRACKING } as const;

/**
 * Words on screen at once. A caption is a readable line, not a transcript: the
 * words that were spoken stay in the audio, and only the ones a viewer can read
 * before the next arrive are on screen. Seven is the ceiling — above it the block
 * becomes a wall of text at caption size.
 */
const MAX_VISIBLE_WORDS = 7;

export interface CaptionBandProps {
  captions: CaptionRef[];
  palette: Palette;
  fps: number;
  /**
   * Frame within the whole video. Optional: the band is rendered outside every
   * `Sequence`, so `useCurrentFrame()` already is the whole video's frame. A
   * frame may still be passed when the band is rendered inside something else,
   * which is what the frame-inspection harness does.
   */
  frame?: number;
  /** Scene windows, so a cue cannot outlive its scene unnoticed. */
  scenes: { start_s: number; end_s: number; scene_id: string; captions_enabled: boolean }[];
  /**
   * The storyboard's caption style. `max_lines` is the one that holds: it is how
   * much of the frame a caption may take. `max_words_per_line` and
   * `max_chars_per_line` are advisory, used when a cue does fit inside `max_lines`
   * anyway; the measured wrapper breaks the line when they would push the block out
   * of the frame.
   */
  style: { style: string; y: number; max_lines: number; max_words_per_line: number; max_chars_per_line: number };
  /** Hide every caption, for scenes that carry their meaning in type. */
  enabled?: boolean;
}

/** One cue's words with resolved timings. */
interface ResolvedCue {
  cue: CaptionRef;
  words: CueWord[];
}

export function resolveCue(cue: CaptionRef): ResolvedCue {
  if (cue.words.length > 0) {
    return {
      cue,
      words: cue.words.map((w) => ({ text: w.text, start_s: w.start_s, end_s: w.end_s, exact: true })),
    };
  }
  // Proportional split. Long words take longer to say, and this is the standard
  // approximation; `exact: false` is carried so the renderer can tell.
  const parts = cue.text.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { cue, words: [] };
  const totalChars = parts.reduce((sum, w) => sum + w.length + 1, 0);
  let cursor = cue.start_s;
  const span = Math.max(0.05, cue.end_s - cue.start_s);
  const words = parts.map((text) => {
    const share = ((text.length + 1) / totalChars) * span;
    const start_s = cursor;
    cursor += share;
    return { text, start_s, end_s: cursor, exact: false };
  });
  return { cue, words };
}

export function CaptionBand(props: CaptionBandProps) {
  const { captions, palette, fps, style } = props;
  // The band is rendered outside every `Sequence`, so the current frame is already
  // the frame of the whole video: which is the clock the audio was cut to.
  const currentFrame = useCurrentFrame();
  const frame = props.frame ?? currentFrame;
  if (props.enabled === false) return null;
  const now = frame / fps;
  const active = captions.find((c) => now >= c.start_s && now < c.end_s);
  if (!active) return null;
  const scene = props.scenes.find((s) => now >= s.start_s && now < s.end_s);
  if (scene && !scene.captions_enabled) return null;

  const resolved = resolveCue(active);
  if (resolved.words.length === 0) return null;

  // Lines are built from the words, so a cue that has not been spoken yet is not
  // on screen at all: only the words up to `now` are placed, and only the last
  // MAX_VISIBLE words of them. A caption is a readable line, not a transcript:
  // nineteen words on screen at once is a wall of text, and a wall of text is
  // worse than a cue that arrives late by a few words.
  const spoken = resolved.words.filter((w) => now >= w.start_s - 0.02).slice(-MAX_VISIBLE_WORDS);
  if (spoken.length === 0) return null;

  // Lines are broken by the measured wrapper, not by a word count. The storyboard
  // gives a per-line word and character budget, but a cue that overruns `max_lines`
  // has to be broken by width or it runs off the bottom of the frame, and a caption
  // hanging off the frame is worse than a caption that breaks at a different word.
  // `max_lines` is the storyboard's word on how much of the frame the caption may
  // take, so it is the budget that holds and the character count gives way.
  const text = spoken.map((w) => w.text).join(" ");
  const fitted = fitFontSize(text, {
    ...CAPTION_MEASURE,
    max: 52,
    min: 30,
    maxWidth: CONTENT.width,
    maxLines: style.max_lines,
    // Not a typographic line-length factor here: the band owns its leading with
    // the block multiplier below, and passing anything above 1 would widen the box
    // the fitter is allowed to fill without the fitter knowing.
    lineHeightFactor: 1,
  });
  const lines = groupByWrap(spoken, fitted.lines);
  if (lines.length === 0) return null;

  const size = fitted.size;
  const centreY = captionCentreY(style.y, lines.length * size * 1.34);
  const blockH = lines.length * size * 1.34;

  return (
    <div
      style={{
        position: "absolute",
        left: CONTENT.left,
        width: CONTENT.width,
        top: centreY - blockH / 2,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      {lines.map((line, li) => (
        <div
          key={li}
          style={{
            display: "flex",
            // The gap must be the font's own space advance, or the width the line
            // was fitted to is not the width it renders at, and the line overruns
            // the column it was measured against.
            gap: measureLine(" ", size, CAPTION_MEASURE),
            justifyContent: "center",
            fontFamily: FONTS.text,
            fontSize: size,
            fontWeight: 500,
            letterSpacing: 0.4,
            lineHeight: 1.34,
          }}
        >
          {line.map((word, wi) => {
            const isCurrent = now >= word.start_s && now < word.end_s;
            const age = now - word.end_s;
            // Spoken words settle back to the base weight; the current word is
            // carried. Nothing scales, nothing bounces.
            const fresh = age < 0.18 ? 1 - age / 0.18 : 0;
            return (
              <span
                key={`${wi}-${word.text}`}
                style={{
                  color: isCurrent ? palette.ink : palette.inkMuted,
                  fontWeight: isCurrent ? 700 : 500,
                  textShadow: fresh > 0 ? `0 0 ${(fresh * 8).toFixed(1)}px ${palette.paper}` : undefined,
                }}
              >
                {word.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type CueWord = { text: string; start_s: number; end_s: number; exact: boolean };

/**
 * Re-attach the word timings to the wrapper's measured line breaks.
 *
 * `wrapText` splits on spaces and drops nothing, so the words across its lines are
 * the words that were spoken, in order. That correspondence is what lets the band
 * keep the per-word highlight while letting a measured wrapper own the geometry.
 */
function groupByWrap(words: CueWord[], lineTexts: string[]): CueWord[][] {
  const groups: CueWord[][] = [];
  let index = 0;
  for (const lineText of lineTexts) {
    const count = lineText.split(/\s+/).filter(Boolean).length;
    if (count === 0) continue;
    groups.push(words.slice(index, index + count));
    index += count;
  }
  // Defensive: a wrapper that dropped a word must not silently lose it from the
  // caption, so anything left over goes on the last line.
  if (index < words.length) {
    const last = groups[groups.length - 1];
    if (last) last.push(...words.slice(index));
    else groups.push(words.slice(index));
  }
  return groups.filter((group) => group.length > 0);
}

/**
 * Cue windows are checked against their scene here rather than in the renderer,
 * because a caption that outlives its shot is a storyboard error and should be
 * reported as one. Returns the offending cues.
 */
export function captionsOutsideScenes(
  captions: CaptionRef[],
  scenes: { start_s: number; end_s: number; scene_id: string }[],
): { cue: CaptionRef; scene: { scene_id: string } | null; overflow_s: number }[] {
  const problems = [];
  for (const cue of captions) {
    const scene = scenes.find((s) => cue.start_s >= s.start_s - 0.01 && cue.start_s < s.end_s);
    if (!scene) {
      problems.push({ cue, scene: null, overflow_s: 0 });
      continue;
    }
    if (cue.end_s > scene.end_s + 0.05) {
      problems.push({ cue, scene, overflow_s: cue.end_s - scene.end_s });
    }
  }
  return problems;
}

/** Centre of the caption band, exposed for QA frame inspection. */
export const CAPTION_BAND_CENTRE = captionCentreY(0.78);
export const CAPTION_SAFE_TOP = FRAME.height - CONTENT.bottom;
export { ease as captionEase, measureLine as captionMeasure };
