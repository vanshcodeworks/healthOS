/**
 * Editorial hook.
 *
 * The first two to four seconds decide whether anything is watched, and a hook is
 * not a sentence on a page. Three things make one read as an opening rather than
 * as a placeholder, and all three are here:
 *
 * 1. **Mass.** The claim sits against an accent bar and a chapter numeral, so the
 *    frame has a shape before anyone reads it. A centred question alone, on bare
 *    paper, is a slide.
 * 2. **A route through the frame.** Rail, claim, rule, rail. The eye is given
 *    somewhere to start and somewhere to land, and the vertical space between is
 *    deliberate rather than leftover.
 * 3. **One claim, then stillness.** The type rises out of its own baseline behind
 *    a mask, line by line, and then holds. A hook that keeps moving is asking for
 *    attention instead of earning it.
 *
 * Nothing here is invented. The eyebrow is the video's own topic, the claim is the
 * scene's own on-screen text or its own first narration beat, the numeral is the
 * scene's index, the bottom rail is the storyboard's title and the channel's name.
 * A hook that had to make something up to look designed would be lying in the first
 * two seconds of a video about evidence.
 */

import { SceneShell, SafeBox, type SceneProps } from "./shared.js";
import { Eyebrow, Headline, Deck } from "../components/EditorialText.js";
import { MeasuredRule } from "../art/texture.js";
import { CONTENT, SPACE } from "../art/spacing.js";
import { TYPE } from "../art/typography.js";
import { ease } from "../motion/ease.js";

/** The chapter numeral's size. Big enough to be a graphic, small enough to be a mark. */
const NUMERAL_SIZE = 108;

export function EditorialHook(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  const hookBeat = scene.beats[0];
  const headline = scene.headline || hookBeat?.text || scene.narration;
  const sub = scene.subtext ?? "";
  // Claims travel with the chart, not the scene: a scene can have components and
  // a chart, and it is the numbers that need to be evidence-bound.
  const isEvidenceScene = (scene.chart?.claim_ids?.length ?? 0) > 0;
  const topic = props.topic ?? "";
  const title = props.title ?? "";

  const ruleT = Math.max(0, Math.min(1, (frame - Math.round(0.72 * fps)) / Math.round(0.5 * fps)));
  const settled = ease("cubic_out", ruleT);
  // The bar draws with the claim and reaches the full height of the block, so it
  // reads as a rule the type is set against rather than as a decoration beside it.
  const barT = Math.max(0, Math.min(1, (frame - Math.round(0.1 * fps)) / Math.round(0.7 * fps)));
  const bar = ease("expo_out", barT);
  const numeralT = ease("cubic_out", Math.max(0, Math.min(1, (frame - Math.round(0.3 * fps)) / Math.round(0.8 * fps))));
  const railT = ease("cubic_out", Math.max(0, Math.min(1, (frame - Math.round(1.1 * fps)) / Math.round(0.6 * fps))));
  const barWidth = 9;

  return (
    <SceneShell {...props}>
      <SafeBox justify="space-between" align="flex-start">
        {/* Top rail: what this video is about, and where in the run we are. */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", width: CONTENT.width, gap: 24 }}>
          {topic ? (
            <Eyebrow
              text={topic}
              palette={palette}
              frame={frame}
              fps={fps}
              delayFrames={Math.round(0.05 * fps)}
              width={CONTENT.width * 0.62}
            />
          ) : isEvidenceScene ? (
            <Eyebrow
              text="what happens"
              palette={palette}
              frame={frame}
              fps={fps}
              delayFrames={Math.round(0.05 * fps)}
              width={CONTENT.width * 0.62}
            />
          ) : (
            <span />
          )}
          <ChapterMark
            index={scene.index}
            count={props.sceneCount ?? 0}
            palette={palette}
            reveal={numeralT}
          />
        </div>

        {/* The claim, against a drawn rule. */}
        <div style={{ display: "flex", gap: SPACE.md, width: CONTENT.width, alignItems: "stretch" }}>
          <div
            style={{
              width: barWidth,
              flex: "0 0 auto",
              background: palette.accent,
              transform: `scaleY(${bar.toFixed(4)})`,
              transformOrigin: "50% 0%",
              opacity: Math.min(1, bar * 2),
              borderRadius: 1,
            }}
          />
          <div style={{ flex: "1 1 auto" }}>
            <Headline
              text={headline}
              palette={palette}
              frame={frame}
              fps={fps}
              maxWidth={CONTENT.width - SPACE.md - barWidth}
              maxLines={4}
              maxSize={132}
              seed={seed}
              delayFrames={0}
            />
          </div>
        </div>

        {/* Bottom rail: the full stop, the supporting sentence, and the source line. */}
        <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md, width: CONTENT.width }}>
          <svg width={CONTENT.width} height={16} style={{ opacity: settled }}>
            <MeasuredRule palette={palette} width={CONTENT.width} x={0} y={8} tick={16} />
          </svg>
          {sub ? (
            <Deck
              text={sub}
              palette={palette}
              frame={frame}
              fps={fps}
              maxWidth={CONTENT.width * 0.9}
              delayFrames={Math.round(0.9 * fps)}
            />
          ) : null}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              width: CONTENT.width,
              opacity: railT,
              transform: `translateY(${((1 - railT) * 10).toFixed(1)}px)`,
            }}
          >
            <span
              style={{
                fontFamily: TYPE.source.fontFamily,
                fontSize: TYPE.source.fontSize,
                letterSpacing: TYPE.source.letterSpacing,
                textTransform: "uppercase",
                color: palette.inkMuted,
                opacity: 0.9,
              }}
            >
              {title}
            </span>
            <span
              style={{
                fontFamily: TYPE.source.fontFamily,
                fontSize: TYPE.source.fontSize,
                fontWeight: 600,
                letterSpacing: 3.4,
                color: palette.accent,
              }}
            >
              HealthOS
            </span>
          </div>
        </div>
      </SafeBox>
    </SceneShell>
  );
}

/**
 * The chapter mark: this scene's number, in the display face, in the accent.
 *
 * It is the frame's graphic anchor and the only large non-text shape on a
 * typographic frame. It is a real number — the scene's own index — so the frame
 * says where it is in the run rather than wearing a numeral for decoration.
 */
function ChapterMark({
  index,
  count,
  palette,
  reveal,
}: {
  index: number;
  count: number;
  palette: SceneProps["palette"];
  reveal: number;
}) {
  if (reveal <= 0) return null;
  const label = String(index + 1).padStart(2, "0");
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, opacity: Math.min(1, reveal * 2) }}>
      {count > 0 ? (
        <span
          style={{
            fontFamily: TYPE.source.fontFamily,
            fontSize: 22,
            letterSpacing: 1.2,
            color: palette.inkMuted,
            paddingBottom: 14,
          }}
        >
          / {String(count).padStart(2, "0")}
        </span>
      ) : null}
      <span
        style={{
          fontFamily: TYPE.headline.fontFamily,
          fontWeight: TYPE.headline.fontWeight,
          fontSize: NUMERAL_SIZE,
          lineHeight: 0.82,
          letterSpacing: -4,
          color: palette.accent,
          transform: `translateY(${((1 - reveal) * 26).toFixed(1)}px)`,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Question grammar. A question is a hook with a different shape: the type sits
 * lower, is smaller, and leaves the top of the frame empty on purpose, so the
 * frame reads as an opening rather than a statement.
 */
export function QuestionScene(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  const headline = scene.headline || scene.beats[0]?.text || scene.narration;
  return (
    <SceneShell {...props}>
      <SafeBox justify="flex-end" align="flex-start" style={{ paddingBottom: 120 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
          <Eyebrow text="the question" palette={palette} frame={frame} fps={fps} delayFrames={Math.round(0.08 * fps)} width={CONTENT.width} />
          <Headline
            text={headline}
            palette={palette}
            frame={frame}
            fps={fps}
            maxWidth={CONTENT.width}
            maxLines={4}
            maxSize={82}
            seed={seed}
          />
        </div>
      </SafeBox>
    </SceneShell>
  );
}
