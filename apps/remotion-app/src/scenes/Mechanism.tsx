/**
 * Mechanism.
 *
 * A mechanism is a chain: structure, process, outcome. The grammar is a vertical
 * stack with hand-drawn arrows between the parts, because the vertical reading
 * order is the causal reading order and the arrows make it explicit.
 *
 * Each link is drawn in turn, and the arrow to the next link is drawn *after* the
 * thing it leaves, so the eye is pulled down the chain rather than shown all of
 * it at once.
 */

import { SceneShell, SafeBox, primaryFigure, type SceneProps } from "./shared.js";
import { Anatomy, anatomyHeight } from "../components/Anatomy.js";
import { Eyebrow } from "../components/EditorialText.js";
import { FlowArrow } from "../components/Marks.js";
import { CONTENT, SPACE } from "../art/spacing.js";
import { FONTS } from "../art/typography.js";
import { ease } from "../motion/ease.js";

export function Mechanism(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  const figure = primaryFigure(scene);
  const headline = scene.headline || scene.beats[0]?.text || "";
  const steps = scene.components.filter((c) => Boolean(c.label));
  const process = steps[0]?.label || scene.subtext || "";
  const outcome = steps[1]?.label || "";

  const arrowFrames = Math.round(0.42 * fps);
  const a1 = Math.round(1.25 * fps);
  const a2 = Math.round(2.5 * fps);
  const figureW = CONTENT.width * 0.5;
  const figureH = figure ? anatomyHeight(figure, figureW) : 0;

  const linkT = (start: number) => Math.max(0, Math.min(1, (frame - start) / Math.round(0.5 * fps)));
  const stepT = (start: number) => ease("cubic_out", linkT(start));

  return (
    <SceneShell {...props}>
      <SafeBox style={{ paddingTop: SPACE.md }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, flex: 1 }}>
          {headline ? (
            <div style={{ alignSelf: "flex-start", marginBottom: SPACE.md }}>
              <Eyebrow text={headline} palette={palette} frame={frame} fps={fps} delayFrames={Math.round(0.05 * fps)} width={CONTENT.width} />
            </div>
          ) : null}

          {/* structure */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: figure ? Math.min(figureH, 520) : 300,
              opacity: stepT(Math.round(0.15 * fps)),
            }}
          >
            {figure ? (
              <Anatomy
                name={figure}
                palette={palette}
                width={figureW}
                seed={seed}
                frame={frame}
                fps={fps}
                durationInFrames={Math.round(1.1 * fps)}
                labels="never"
                detail={false}
              />
            ) : (
              <div style={{ width: figureW, height: 8, background: palette.lineStrong, opacity: 0.6 }} />
            )}
          </div>

          <svg width={120} height={70} style={{ opacity: linkT(a1) }}>
            <FlowArrow
              x1={60}
              y1={6}
              x2={60}
              y2={58}
              palette={palette}
              frame={frame}
              fps={fps}
              delayFrames={a1}
              durationInFrames={arrowFrames}
              color={palette.accent}
              seed={seed + 2}
            />
          </svg>

          {/* process */}
          <div style={{ opacity: stepT(a1 + arrowFrames), maxWidth: CONTENT.width * 0.86, textAlign: "center" }}>
            <div
              style={{
                fontFamily: FONTS.text,
                fontSize: 38,
                fontWeight: 600,
                letterSpacing: 0.4,
                color: palette.ink,
                lineHeight: 1.28,
              }}
            >
              {process}
            </div>
          </div>

          {outcome ? (
            <>
              <svg width={120} height={70} style={{ opacity: linkT(a2) }}>
                <FlowArrow
                  x1={60}
                  y1={6}
                  x2={60}
                  y2={58}
                  palette={palette}
                  frame={frame}
                  fps={fps}
                  delayFrames={a2}
                  durationInFrames={arrowFrames}
                  color={palette.accent}
                  seed={seed + 6}
                />
              </svg>
              <div style={{ opacity: stepT(a2 + arrowFrames), maxWidth: CONTENT.width * 0.8, textAlign: "center" }}>
                <div
                  style={{
                    fontFamily: FONTS.display,
                    fontSize: 52,
                    color: palette.accent,
                    lineHeight: 1.16,
                  }}
                >
                  {outcome}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </SafeBox>
    </SceneShell>
  );
}

/**
 * Cause and effect. Two panels, one cause, one effect, and a connecting arrow
 * that is the only moving thing in the frame.
 */
export function CauseEffect(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  const steps = scene.components.filter((c) => Boolean(c.label));
  const cause = steps[0]?.label || scene.headline || "";
  const effect = steps[1]?.label || scene.subtext || "";
  const t = Math.max(0, Math.min(1, (frame - Math.round(0.8 * fps)) / Math.round(0.6 * fps)));
  const e = ease("cubic_out", t);

  return (
    <SceneShell {...props}>
      <SafeBox justify="center">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, width: "100%" }}>
            <div style={{ flex: 1, opacity: ease("cubic_out", Math.min(1, frame / Math.round(0.6 * fps))) }}>
              <div style={{ fontFamily: FONTS.text, fontSize: 22, letterSpacing: 2, color: palette.inkMuted, marginBottom: 12 }}>
                CAUSE
              </div>
              <div style={{ fontFamily: FONTS.display, fontSize: 54, lineHeight: 1.14, color: palette.ink }}>
                {cause}
              </div>
            </div>
          </div>
          <svg width={CONTENT.width} height={90} style={{ margin: `${SPACE.md}px 0` }}>
            <FlowArrow
              x1={CONTENT.width * 0.2}
              y1={12}
              x2={CONTENT.width * 0.8}
              y2={12}
              palette={palette}
              frame={frame}
              fps={fps}
              delayFrames={Math.round(0.8 * fps)}
              color={palette.accent}
              seed={seed}
            />
            <FlowArrow
              x1={CONTENT.width * 0.8}
              y1={78}
              x2={CONTENT.width * 0.2}
              y2={78}
              palette={palette}
              frame={frame}
              fps={fps}
              delayFrames={Math.round(1.05 * fps)}
              color={palette.inkMuted}
              seed={seed + 3}
            />
          </svg>
          <div style={{ width: "100%", opacity: e }}>
            <div style={{ fontFamily: FONTS.text, fontSize: 22, letterSpacing: 2, color: palette.inkMuted, marginBottom: 12 }}>
              EFFECT
            </div>
            <div style={{ fontFamily: FONTS.display, fontSize: 54, lineHeight: 1.14, color: palette.accent }}>
              {effect}
            </div>
          </div>
        </div>
      </SafeBox>
    </SceneShell>
  );
}
