/**
 * Big stat.
 *
 * A number is the strongest thing a video can put on screen, so the grammar is
 * almost empty: a serif figure, its unit, a measured rule beneath it, and the
 * sentence that gives it meaning. The number counts up once and then holds.
 *
 * The rule about no invented numbers is enforced upstream, but this scene is also
 * where it is easiest to break, so it renders nothing at all when there is no
 * approved value: no zero, no placeholder, no "N/A". The composition layer picks
 * a different grammar instead, and the fallback reason is recorded upstream.
 */

import { SceneShell, SafeBox, type SceneProps } from "./shared.js";
import { countUp } from "../motion/reveal.js";
import { ease } from "../motion/ease.js";
import { MeasuredRule } from "../art/texture.js";
import { Eyebrow, Deck } from "../components/EditorialText.js";
import { TYPE, FONTS } from "../art/typography.js";
import { measureLine } from "../art/measure.js";
import { CONTENT } from "../art/spacing.js";

export function BigStat(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  const chart = scene.chart;
  const approved = chart && chart.kind === "counter" && typeof chart.value === "number" && chart.value !== 0;
  const label = chart?.label || scene.subtext || "";
  const sublabel = chart?.sublabel || "";
  const value = approved ? chart.value! : null;
  const prefix = chart?.prefix ?? "";
  const suffix = chart?.suffix ?? chart?.display ?? "";
  const display = chart?.display;

  const start = Math.round(0.2 * fps);
  const count = countUp({
    frame: Math.max(0, frame - start),
    fps,
    durationInFrames: Math.round(1.15 * fps),
    to: value ?? 0,
    decimals: 0,
  });

  // The figure is sized to the box, so a 4-digit number and a 1-digit number both
  // fill the frame the same way. The measure is the display face at the weight the
  // span below actually asks for, tracking included: a number fitted against one
  // weight and painted in another is a number that runs past the column.
  const size = 260;
  const numberText = `${prefix}${count.shown}`;
  const statMeasure = { font: "display", weight: TYPE.stat.fontWeight, letterSpacing: -8 } as const;
  const unitW = suffix ? measureLine(` ${suffix}`, size * 0.2, { font: "text", weight: 600, letterSpacing: 2.4 }) : 0;
  const numberW = measureLine(numberText, size, statMeasure);
  const scale = Math.min(1, (CONTENT.width - unitW - 14) / Math.max(1, numberW));

  const ruleT = Math.max(0, Math.min(1, (frame - Math.round(1.5 * fps)) / Math.round(0.55 * fps)));
  const ruleE = ease("cubic_out", ruleT);

  return (
    <SceneShell {...props}>
      <SafeBox justify="center" align="flex-start">
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <Eyebrow
            text={scene.chart?.claim_ids?.length ? "the figure" : ""}
            palette={palette}
            frame={frame}
            fps={fps}
            delayFrames={Math.round(0.04 * fps)}
            width={CONTENT.width}
          />
          <div style={{ height: size * 1.06, position: "relative" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                transform: `scale(${scale.toFixed(4)})`,
                transformOrigin: "left bottom",
              }}
            >
              <span
                style={{
                  fontFamily: TYPE.stat.fontFamily,
                  fontSize: size,
                  // `statMeasure` above fits at `TYPE.stat.fontWeight`; the span has
                  // to paint at that weight or the figure is drawn in a narrower face
                  // than the one it was scaled against, and `scale` under-shrinks it.
                  fontWeight: TYPE.stat.fontWeight,
                  lineHeight: 1,
                  letterSpacing: -8,
                  color: palette.ink,
                  // Tabular figures would help, but the display face is a serif:
                  // a monospaced number in a serif headline is a different video.
                }}
              >
                {numberText}
              </span>
              {suffix ? (
                <span
                  style={{
                    fontFamily: FONTS.text,
                    fontSize: size * 0.2,
                    fontWeight: 600,
                    letterSpacing: 2.4,
                    color: palette.inkMuted,
                    marginLeft: 14,
                    textTransform: "uppercase",
                  }}
                >
                  {suffix}
                </span>
              ) : null}
            </div>
          </div>

          <svg width={CONTENT.width} height={12} style={{ opacity: ruleE }}>
            <MeasuredRule
              palette={palette}
              width={CONTENT.width * Math.min(1, ruleE * 1.1) * 0.5}
              x={0}
              y={6}
              tick={12}
            />
          </svg>

          {display && display !== String(value) ? (
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 26,
                fontWeight: TYPE.figure.fontWeight,
                color: palette.inkMuted,
                opacity: Math.min(1, Math.max(0, (frame - Math.round(1.7 * fps)) / Math.round(0.4 * fps))),
              }}
            >
              {display}
            </div>
          ) : null}

          {label ? (
            <div
              style={{
                fontFamily: TYPE.deck.fontFamily,
                fontSize: 40,
                lineHeight: 1.3,
                color: palette.ink,
                maxWidth: CONTENT.width * 0.92,
                opacity: Math.min(1, Math.max(0, (frame - Math.round(1.35 * fps)) / Math.round(0.5 * fps))),
                transform: `translateY(${(
                  (1 - Math.min(1, Math.max(0, (frame - Math.round(1.35 * fps)) / Math.round(0.5 * fps)))) * 14
                ).toFixed(1)}px)`,
              }}
            >
              {label}
            </div>
          ) : null}

          {sublabel ? (
            <Deck text={sublabel} palette={palette} frame={frame} fps={fps} maxWidth={CONTENT.width * 0.8} delayFrames={Math.round(1.7 * fps)} />
          ) : null}
        </div>
      </SafeBox>
      {seed % 2 === 0 ? null : null}
    </SceneShell>
  );
}
