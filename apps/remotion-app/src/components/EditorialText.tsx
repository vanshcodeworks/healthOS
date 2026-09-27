/**
 * Editorial type.
 *
 * Three things make type read as designed rather than placed:
 *
 * 1. A hierarchy that is a *scale*, not a set of arbitrary sizes. Headlines come
 *    in two sizes and a fitted one; everything else is small and quiet.
 * 2. Reveal by movement, not opacity. A headline rises out of its own baseline
 *    behind a mask, line by line, so the block assembles. A paragraph does not
 *    animate word by word, because that is karaoke.
 * 3. The emphasised word is treated typographically — an underline drawn under
 *    it, a slight lift — rather than by turning it a different colour.
 */

import { TYPE, TYPE_MEASURE, FONTS } from "../art/typography.js";
import { applyBreaks, fitFontSize, measureLine } from "../art/measure.js";
import { ease } from "../motion/ease.js";
import { handPath } from "../art/hand.js";
import type { Palette } from "../art/palette.js";

function stripEmphasis(text: string): string {
  return text.replace(/\*/g, "");
}

export interface EyebrowProps {
  text: string;
  palette: Palette;
  frame: number;
  fps: number;
  delayFrames?: number;
  /** A short rule leads the eyebrow. */
  withRule?: boolean;
  align?: "left" | "center";
  width?: number;
  color?: string;
}

/**
 * Largest size at or below `max` at which `text` fits on one line, tracking
 * included. Floors rather than truncates: type that shrinks to fit is a smaller
 * eyebrow, type that truncates is a sentence with the end missing.
 */

export function Eyebrow({ text, palette, frame, fps, delayFrames = 0, withRule = true, align = "left", width = 900, color }: EyebrowProps) {
  const duration = Math.round(0.7 * fps);
  const f = frame - delayFrames;
  const t = f <= 0 ? 0 : Math.min(1, f / duration);
  const e = ease("expo_out", t);
  if (e <= 0) return null;
  const ruleW = 54;
  // An eyebrow is fitted, and it wraps rather than truncates: cutting a kicker at
  // a character count breaks it mid-word, which reads as a rendering error.
  // Tracking is part of the measure, not a correction applied to it afterwards:
  // CSS adds a letter's tracking after that letter, so a run of `n` characters
  // paints `n` gaps wider than the advances alone, and a fitter that measured the
  // advances and was corrected by hand in one place and not another is how a
  // tracked kicker ends up wider than the column it was fitted to.
  const available = Math.max(120, width - (withRule ? ruleW + 18 : 0));
  const fitted = fitFontSize(stripEmphasis(text).toUpperCase(), {
    ...TYPE_MEASURE.eyebrow,
    max: TYPE.eyebrow.fontSize,
    min: 18,
    maxWidth: available,
    maxLines: 2,
    lineHeightFactor: 1,
  });
  const fontSize = fitted.size;
  const lines = fitted.lines.length > 0 ? fitted.lines : [text];
  return (
    <div
      style={{
        display: "flex",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: 18,
        width,
        overflow: "hidden",
        justifyContent: align === "center" ? "center" : "flex-start",
        opacity: Math.min(1, e * 2.4),
      }}
    >
      {withRule && (
        <svg width={ruleW * e} height={8} style={{ flex: "0 0 auto", overflow: "visible" }}>
          <line x1={0} y1={4} x2={ruleW} y2={4} stroke={color ?? palette.accent} strokeWidth={2.4} />
        </svg>
      )}
      <span
        style={{
          fontFamily: TYPE.eyebrow.fontFamily,
          fontSize,
          fontWeight: TYPE.eyebrow.fontWeight,
          letterSpacing: TYPE.eyebrow.letterSpacing,
          color: color ?? palette.inkMuted,
          textTransform: "uppercase",
          whiteSpace: "pre-line",
        }}
      >
        {lines.join("\n")}
      </span>
    </div>
  );
}

export interface HeadlineProps {
  text: string;
  palette: Palette;
  frame: number;
  fps: number;
  /** Available width. Lines are fitted inside it. */
  maxWidth: number;
  maxLines?: number;
  /** Cap on the fitted size. */
  maxSize?: number;
  minSize?: number;
  delayFrames?: number;
  align?: "left" | "center";
  color?: string;
  /** Draw an underline beneath the emphasised word, if there is one. */
  emphasisUnderline?: boolean;
  seed?: number;
}

export function Headline(props: HeadlineProps) {
  const { palette, frame, fps, maxWidth, maxLines = 3, align = "left", seed = 3 } = props;
  const plain = stripEmphasis(props.text);
  const emphasis = emphasisWords(props.text);
  const fitted = fitFontSize(plain, {
    ...TYPE_MEASURE.display,
    max: props.maxSize ?? TYPE.headline.fontSize,
    min: props.minSize ?? 44,
    maxWidth,
    maxLines,
    // Just under 1: a display serif wants a slightly shorter measure than the
    // column gives it. Above 1 the fitter would accept a line that paints wider
    // than the box it was measured against, which is how a headline ends up
    // outside the safe area on a frame nothing else looks wrong on.
    lineHeightFactor: 0.96,
  });
  const lines = applyBreaks(plain).length > 1 ? applyBreaks(plain) : fitted.lines;
  const size = Math.min(fitted.size, props.maxSize ?? TYPE.headline.fontSize);
  const lineHeight = size * TYPE.headline.lineHeight;
  // The mask has to hide its own seam, so consecutive masks overlap — but only by
  // the half-leading. Pulling them together by a third of an em, as this did, took
  // the effective advance to 0.76em and made consecutive lines of a display serif
  // collide: the type looked broken before anything else about the frame did.
  const seam = lineHeight - size;
  const stagger = Math.round(0.09 * fps);
  const first = Math.round(0.16 * fps);
  const color = props.color ?? palette.ink;
  const totalHeight = lines.length * lineHeight - seam;

  return (
    <div style={{ width: maxWidth, height: totalHeight, position: "relative" }}>
      {lines.map((line, index) => {
        const delay = (props.delayFrames ?? 0) + first + index * stagger;
        const f = frame - delay;
        const duration = Math.round(0.62 * fps);
        const t = f <= 0 ? 0 : Math.min(1, f / duration);
        const e = ease("expo_out", t);
        // A full line box of travel, so the line clears the mask entirely rather
        // than emerging from a partly visible half of itself.
        const travel = lineHeight;
        return (
          <div
            key={index}
            style={{
              height: lineHeight,
              overflow: "hidden",
              marginBottom: -seam,
              transform: `translateY(${((1 - e) * travel).toFixed(2)}px)`,
              opacity: Math.min(1, e * 3),
            }}
          >
            <div
              style={{
                fontFamily: TYPE.headline.fontFamily,
                fontSize: size,
                // Stated, not inherited. The fitter measures `TYPE_MEASURE.display`,
                // which is `TYPE.headline.fontWeight`; leaving this off let the div
                // take the initial 400, so the block was fitted against Fraunces 500
                // and painted in 400 — roughly 5% narrower per glyph than the fit
                // assumed, which shows up as a headline that stops short of the
                // column it was fitted to.
                fontWeight: TYPE.headline.fontWeight,
                lineHeight: `${lineHeight}px`,
                letterSpacing: TYPE.headline.letterSpacing,
                color,
                textAlign: align,
              }}
            >
              {emphasisedLine(line, emphasis, palette, props.emphasisUnderline ?? true, seed + index * 11, frame, fps, delay, size)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Words the planner marked with `*word*`, lower-cased for comparison. */
function emphasisWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/\*([^*]+)\*/g)) {
    out.add(match[1]!.toLowerCase().replace(/[^a-z0-9%]/gi, ""));
  }
  return out;
}

/**
 * Renders one line, with each emphasised word underlined by a drawn rule.
 *
 * Underline rather than colour: a colour change on one word inside a serif
 * headline reads as a link, and an underline reads as an editor's mark, which is
 * the register the rest of the system is in.
 */
function emphasisedLine(
  line: string,
  emphasis: Set<string>,
  palette: Palette,
  withUnderline: boolean,
  seed: number,
  frame: number,
  fps: number,
  delay: number,
  size: number,
) {
  const words = line.split(" ");
  const nodes: React.ReactNode[] = [];
  let index = 0;
  for (const word of words) {
    const bare = word.replace(/\*/g, "").toLowerCase().replace(/[^a-z0-9%]/gi, "");
    if (!emphasis.has(bare) || bare.length === 0) {
      // The space goes back in. Splitting a line into words and rendering them as
      // adjacent spans drops every space between them, which is how a headline
      // rendered as "Whathappensin yourbrain2Oto45 minutesafter coffee?".
      nodes.push(<span key={index}>{index > 0 ? " " : ""}{word}</span>);
      index += 1;
      continue;
    }
    // Staggered by word so two emphasised words in one line do not draw together.
    const f = frame - delay - Math.round(0.44 * fps) - index * 2;
    const t = f <= 0 ? 0 : Math.min(1, f / Math.round(0.48 * fps));
    const ruleW = measureLine(word, size, { font: "display", weight: TYPE.headline.fontWeight, letterSpacing: TYPE.headline.letterSpacing });
    nodes.push(
      <span key={index} style={{ position: "relative", display: "inline-block" }}>
        {index > 0 ? " " : ""}
        {word}
        {withUnderline && t > 0 && (
          <svg
            width={ruleW * t}
            height={12}
            style={{ position: "absolute", left: 0, bottom: size * 0.12, overflow: "visible" }}
            aria-hidden
          >
            <path
              d={handPath(`M 3 7 L ${Math.max(4, ruleW - 3)} 7`, { seed, roughness: 1.4, samples: 18 })}
              fill="none"
              stroke={palette.accent}
              strokeWidth={3.2}
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>,
    );
    index += 1;
  }
  return <>{nodes}</>;
}

/** A supporting sentence under a headline. One size, no animation per word. */
export function Deck({
  text,
  palette,
  frame,
  fps,
  maxWidth,
  delayFrames = 0,
  color,
  maxSize = TYPE.deck.fontSize,
}: {
  text: string;
  palette: Palette;
  frame: number;
  fps: number;
  maxWidth: number;
  delayFrames?: number;
  color?: string;
  maxSize?: number;
}) {
  const fitted = fitFontSize(text, { ...TYPE_MEASURE.text, max: maxSize, min: 26, maxWidth, maxLines: 3, lineHeightFactor: 1 });
  const f = frame - delayFrames;
  const t = f <= 0 ? 0 : Math.min(1, f / Math.round(0.6 * fps));
  const e = ease("cubic_out", t);
  if (e <= 0) return null;
  return (
    <div
      style={{
        width: maxWidth,
        fontFamily: TYPE.deck.fontFamily,
        fontSize: fitted.size,
        fontWeight: TYPE.deck.fontWeight,
        lineHeight: 1.38,
        letterSpacing: TYPE.deck.letterSpacing,
        color: color ?? palette.inkMuted,
        opacity: e,
        transform: `translateY(${((1 - e) * 16).toFixed(2)}px)`,
      }}
    >
      {fitted.lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

/** A single large word, for the moment a narration lands on one idea. */
export function SpokenWord({
  word,
  palette,
  frame,
  fps,
  delayFrames = 0,
  maxWidth = 900,
  color,
}: {
  word: string;
  palette: Palette;
  frame: number;
  fps: number;
  delayFrames?: number;
  maxWidth?: number;
  color?: string;
}) {
  const fitted = fitFontSize(word, { ...TYPE_MEASURE.display, max: TYPE.spoken.fontSize, min: 52, maxWidth, maxLines: 1 });
  const f = frame - delayFrames;
  const t = f <= 0 ? 0 : Math.min(1, f / Math.round(0.75 * fps));
  const e = ease("expo_out", t);
  if (e <= 0) return null;
  // A slight scale settle, not a bounce.
  const scale = 0.965 + 0.035 * e;
  return (
    <div
      style={{
        fontFamily: TYPE.spoken.fontFamily,
        fontSize: fitted.size,
        fontWeight: TYPE.spoken.fontWeight,
        letterSpacing: TYPE.spoken.letterSpacing,
        color: color ?? palette.ink,
        textAlign: "center",
        opacity: Math.min(1, e * 2.6),
        transform: `scale(${scale.toFixed(4)})`,
        transformOrigin: "center bottom",
      }}
    >
      {word}
    </div>
  );
}

export function SourceNote({ text, palette, width }: { text: string; palette: Palette; width: number }) {
  if (!text) return null;
  return (
    <div
      style={{
        fontFamily: TYPE.source.fontFamily,
        fontSize: TYPE.source.fontSize,
        letterSpacing: TYPE.source.letterSpacing,
        color: palette.inkMuted,
        width,
        opacity: 0.85,
      }}
    >
      {text}
    </div>
  );
}

export const INLINE = FONTS;
