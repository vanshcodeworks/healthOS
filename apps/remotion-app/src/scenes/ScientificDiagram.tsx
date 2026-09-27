/**
 * Scientific diagram.
 *
 * The workhorse grammar, and the one that has to earn its keep: heading, a
 * structure that draws itself, labels that attach to it once it exists, and one
 * restrained annotation. Nothing else.
 *
 * The composition is deliberately asymmetric — heading high and left, the figure
 * on a strong axis, labels in the negative space the figure leaves — because a
 * centred diagram with centred type is the diagram equivalent of a bulleted slide.
 */

import { SceneShell, SafeBox, TypographicFigure, primaryFigure, componentLabel, type SceneProps } from "./shared.js";
import { Anatomy, anatomyHeight } from "../components/Anatomy.js";
import { Eyebrow, Deck } from "../components/EditorialText.js";
import { Bracket } from "../components/Marks.js";
import { CONTENT, SPACE } from "../art/spacing.js";
import { FONTS } from "../art/typography.js";
import { ease } from "../motion/ease.js";

export function ScientificDiagram(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  const figure = primaryFigure(scene);
  const heading = scene.headline || scene.beats[0]?.text || "";
  const annotation = scene.subtext ?? "";
  const focusIndex = scene.components.findIndex((c) => c.emphasis === "highlight" || c.emphasis === "focus");

  // The figure gets the widest column that still leaves room for its labels, and
  // the tallest that still leaves the eyebrow and the annotation their air. A
  // figure sized to the column alone leaves a third of the frame as paper, which
  // is how a diagram read as a sketch in the corner of a page.
  const figureW = CONTENT.width * 0.94;
  const figureH = figure ? anatomyHeight(figure, figureW) : 0;
  const drawFrames = Math.round(Math.min(2.2 * fps, props.durationInFrames * 0.62));

  return (
    <SceneShell {...props}>
      <SafeBox style={{ paddingTop: SPACE.md }}>
        <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm, flex: "0 0 auto" }}>
          {heading ? (
            // Fitted, not sliced. Cutting a headline at a character count breaks it
            // mid-word — "RECEPTORS IN THE B" — which reads as a rendering error
            // rather than a style. The eyebrow shrinks to fit its own width instead,
            // and wraps when even the floor is not enough.
            <Eyebrow
              text={heading}
              palette={palette}
              frame={frame}
              fps={fps}
              delayFrames={Math.round(0.06 * fps)}
              width={CONTENT.width}
            />
          ) : null}
        </div>

        <div
          style={{
            flex: "1 1 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            marginTop: SPACE.md,
          }}
        >
          {figure ? (
            <div style={{ position: "relative", opacity: ease("cubic_out", Math.min(1, frame / Math.round(0.5 * fps))) }}>
              <Anatomy
                name={figure}
                palette={palette}
                width={figureW}
                seed={seed}
                frame={frame}
                fps={fps}
                durationInFrames={drawFrames}
                highlight={focusIndex >= 0 ? [2] : []}
                labels="on"
              />
              {focusIndex >= 0 && (
                <svg
                  width={figureW}
                  height={figureH}
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  style={{ position: "absolute", inset: 0, overflow: "visible" }}
                >
                  <Bracket
                    palette={palette}
                    frame={frame}
                    fps={fps}
                    delayFrames={drawFrames}
                    x={0.14}
                    y={0.3}
                    w={0.5}
                    h={0.36}
                    side="left"
                    seed={seed}
                    unitScale={figureW}
                  />
                </svg>
              )}
            </div>
          ) : (
            <TypographicFigure scene={scene} palette={palette} />
          )}
        </div>

        <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: SPACE.md }}>
          {focusIndex >= 0 ? (
            <div
              style={{
                fontFamily: FONTS.text,
                fontSize: 27,
                fontWeight: 600,
                letterSpacing: 0.6,
                color: palette.accent,
                opacity: Math.min(1, Math.max(0, (frame - drawFrames) / Math.round(0.4 * fps))),
              }}
            >
              {componentLabel(scene, focusIndex)}
            </div>
          ) : (
            <span />
          )}
          {annotation ? (
            <div style={{ flex: "1 1 auto", maxWidth: CONTENT.width * 0.62 }}>
              <Deck
                text={annotation}
                palette={palette}
                frame={frame}
                fps={fps}
                maxWidth={CONTENT.width * 0.62}
                delayFrames={drawFrames + Math.round(0.3 * fps)}
                maxSize={30}
              />
            </div>
          ) : null}
        </div>
      </SafeBox>
    </SceneShell>
  );
}

/**
 * Anatomy focus.
 *
 * One structure, large, with the region under discussion called out by a bracket
 * and a single label. The frame is mostly empty on purpose: the viewer's job is
 * to look at one thing.
 */
export function AnatomyFocus(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  // No figure, no drawing. See `TypographicFigure`.
  const figure = primaryFigure(scene);
  const label = scene.components[0]?.label || scene.subtext || "";
  const width = CONTENT.width * 0.96;
  const height = figure ? anatomyHeight(figure, width) : 0;
  const drawFrames = Math.round(Math.min(2 * fps, props.durationInFrames * 0.55));
  const labelFrame = drawFrames + Math.round(0.25 * fps);

  if (!figure) {
    return (
      <SceneShell {...props}>
        <SafeBox justify="center" align="center">
          <TypographicFigure scene={scene} palette={palette} />
        </SafeBox>
      </SceneShell>
    );
  }

  return (
    <SceneShell {...props}>
      <SafeBox justify="center" align="center">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: SPACE.lg }}>
          <div style={{ position: "relative" }}>
            <Anatomy
              name={figure}
              palette={palette}
              width={width}
              seed={seed}
              frame={frame}
              fps={fps}
              durationInFrames={drawFrames}
              labels="never"
            />
            <svg
              width={width}
              height={height}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              style={{ position: "absolute", inset: 0, overflow: "visible" }}
            >
              <Bracket
                palette={palette}
                frame={frame}
                fps={fps}
                delayFrames={labelFrame}
                x={0.24}
                y={0.34}
                w={0.46}
                h={0.3}
                side="right"
                seed={seed + 4}
                unitScale={width}
              />
            </svg>
          </div>
          {label ? (
            <div
              style={{
                fontFamily: FONTS.text,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: 1.2,
                color: palette.ink,
                opacity: Math.min(1, Math.max(0, (frame - labelFrame) / Math.round(0.45 * fps))),
                transform: `translateX(${(
                  (1 - Math.min(1, Math.max(0, (frame - labelFrame) / Math.round(0.45 * fps)))) * -18
                ).toFixed(1)}px)`,
              }}
            >
              {label}
            </div>
          ) : null}
        </div>
      </SafeBox>
    </SceneShell>
  );
}

/** Zoom reveal: the same structure, arriving at a scale that fills the frame. */
export function ZoomReveal(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  const figure = primaryFigure(scene);
  const t = Math.max(0, Math.min(1, frame / Math.max(1, props.durationInFrames * 0.6)));
  const e = ease("sine_out", t);
  const width = CONTENT.width * (0.72 + 0.34 * e);
  if (!figure) {
    return (
      <SceneShell {...props}>
        <SafeBox justify="center" align="center">
          <TypographicFigure scene={scene} palette={palette} />
        </SafeBox>
      </SceneShell>
    );
  }
  return (
    <SceneShell {...props}>
      <SafeBox justify="center" align="center">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: SPACE.lg }}>
          <Anatomy
            name={figure}
            palette={palette}
            width={width}
            seed={seed}
            frame={frame}
            fps={fps}
            durationInFrames={Math.round(1.8 * fps)}
            labels="on"
          />
          {scene.headline ? (
            <Deck text={scene.headline} palette={palette} frame={frame} fps={fps} maxWidth={CONTENT.width * 0.86} delayFrames={Math.round(1.1 * fps)} />
          ) : null}
        </div>
      </SafeBox>
    </SceneShell>
  );
}
