/**
 * Particle flow.
 *
 * A source, a path, a target. The path is drawn first and labelled at both ends,
 * and only then do the particles travel it. That order matters: a particle
 * crossing an undrawn path reads as random motion, while a particle following a
 * path that has just been drawn reads as transport.
 *
 * The particles are the diagram convention — flat, outlined, sized against the
 * line weight — rather than a glow effect. See `components/ParticleFlow`.
 */

import { SceneShell, SafeBox, anatomyForComponent, componentLabel, primaryFigure, type SceneProps } from "./shared.js";
import { Anatomy } from "../components/Anatomy.js";
import { ParticleFlow } from "../components/ParticleFlow.js";
import { Eyebrow, Deck } from "../components/EditorialText.js";
import { ScientificLabel } from "../components/ScientificLabel.js";
import { CONTENT, SPACE } from "../art/spacing.js";
import { FONTS } from "../art/typography.js";
import { fitPartSize, wrapParts, PART_SEPARATOR } from "../art/parts-row.js";
import { ease } from "../motion/ease.js";

export function ParticleFlowScene(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  const figure = primaryFigure(scene);
  const headline = scene.headline || scene.beats[0]?.text || "";
  const sub = scene.subtext || "";
  const sourceLabel = scene.components[0]?.label || "source";
  const targetLabel = scene.components[1]?.label || "target";

  // The path is a single sweeping curve across the middle third of the frame.
  const y = 1020;
  const pathD = `M ${CONTENT.left + 40} ${y + 40} C ${CONTENT.left + 220} ${y - 90} ${CONTENT.left + 620} ${y + 120} ${CONTENT.left + 860} ${y - 20}`;

  const labelsIn = Math.round(0.7 * fps);
  const travelStart = Math.round(1.05 * fps);
  const travelSeconds = Math.max(1.6, Math.min(4, props.durationInFrames / fps - 1.2));

  return (
    <SceneShell {...props}>
      <SafeBox style={{ paddingTop: SPACE.md }}>
        {headline ? (
          <Eyebrow text={headline} palette={palette} frame={frame} fps={fps} delayFrames={Math.round(0.05 * fps)} width={CONTENT.width} />
        ) : null}

        <div style={{ flex: "1 1 auto", position: "relative" }}>
          {/* The structure the flow passes through, if the scene names one. */}
          {figure ? (
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 190,
                transform: "translateX(-50%)",
                opacity: ease("cubic_out", Math.min(1, frame / Math.round(0.7 * fps))),
              }}
            >
              <Anatomy
                name={figure}
                palette={palette}
                width={CONTENT.width * 0.58}
                seed={seed}
                frame={frame}
                fps={fps}
                durationInFrames={Math.round(1 * fps)}
                labels="never"
                detail={false}
              />
            </div>
          ) : null}

          <svg
            width={FRAME_WIDTH}
            height={1600}
            viewBox={`0 0 ${FRAME_WIDTH} 1600`}
            style={{ position: "absolute", inset: 0, overflow: "visible" }}
          >
            <path
              d={pathD}
              fill="none"
              stroke={palette.lineStrong}
              strokeWidth={2.6}
              strokeDasharray="7 9"
              strokeLinecap="round"
              opacity={0.8}
            />
            <ParticleFlow
              d={pathD}
              palette={palette}
              frame={frame - travelStart}
              fps={fps}
              count={8}
              size={[9, 7]}
              travelSeconds={travelSeconds}
              cycles={1}
              seed={seed}
              shape="dot"
              delayFrames={0}
              showPath={false}
            />
            <ScientificLabel
              text={sourceLabel}
              palette={palette}
              frame={frame}
              fps={fps}
              delayFrames={labelsIn}
              anchor={{ x: CONTENT.left + 44, y: y + 40 }}
              at={{ x: CONTENT.left + 10, y: y - 60 }}
              side="right"
              seed={seed + 1}
            />
            <ScientificLabel
              text={targetLabel}
              palette={palette}
              frame={frame}
              fps={fps}
              delayFrames={labelsIn + Math.round(0.25 * fps)}
              anchor={{ x: CONTENT.left + 856, y: y - 20 }}
              at={{ x: CONTENT.left + 900, y: y - 96 }}
              side="left"
              seed={seed + 2}
            />
          </svg>
        </div>

        {sub ? (
          <div style={{ flex: "0 0 auto", maxWidth: CONTENT.width * 0.9 }}>
            <Deck text={sub} palette={palette} frame={frame} fps={fps} maxWidth={CONTENT.width * 0.9} delayFrames={Math.round(1.5 * fps)} maxSize={32} />
          </div>
        ) : null}
      </SafeBox>
    </SceneShell>
  );
}

const FRAME_WIDTH = 1080;

/**
 * Molecular breakdown: one structure, its parts named in sequence, with a bracket
 * moving from part to part. The bracket moving is the point — it says "this part,
 * then this part", which is what a breakdown is.
 */
export function MolecularBreakdown(props: SceneProps) {
  const { scene, palette, frame, fps, seed } = props;
  const figure = primaryFigure(scene) ?? "molecule";
  // Named parts. A component that carries no label still names something the
  // viewer can be shown — "intestine" is a real thing the storyboard asked for, and
  // dropping it left the breakdown with an empty row of separators under the
  // figure, which is a frame with a caption-shaped hole in it. Names are the
  // component's own, never invented here.
  // `componentLabel` indexes the scene's own component list, so the index has to
  // survive the filter: mapping the filtered array and numbering from zero would
  // label the second drawable component with the first one's name.
  const parts = scene.components.flatMap((c, i) =>
    anatomyForComponent(c.component) === null ? [] : [componentLabel(scene, i)],
  );
  const per = Math.max(0.6, props.durationInFrames / fps / Math.max(1, parts.length + 0.6));
  const current = Math.max(0, Math.min(parts.length - 1, Math.floor(frame / fps / per)));
  // The row is a row of names, and names are longer than the gaps between them
  // suggest: three components at caption-adjacent size overflow a 948px column,
  // and because the row is centred it overflows *both* sides. It is fitted to the
  // column with the measured display advances, and it wraps rather than growing
  // past the frame.
  const rowSize = fitPartSize(parts, current);
  const rowLines = wrapParts(parts, rowSize, current);

  return (
    <SceneShell {...props}>
      <SafeBox justify="center" align="center">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: SPACE.lg,
            width: CONTENT.width,
          }}
        >
          <Anatomy
            name={figure}
            palette={palette}
            width={CONTENT.width * 0.8}
            seed={seed}
            frame={frame}
            fps={fps}
            durationInFrames={Math.round(1.2 * fps)}
            labels="never"
            highlight={[0]}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              maxWidth: CONTENT.width,
            }}
          >
            {rowLines.map((line, li) => (
              <div key={li} style={{ display: "flex", gap: PART_SEPARATOR, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
                {line.map((part, i) => {
                  const index = rowLines.slice(0, li).reduce((n, l) => n + l.length, 0) + i;
                  const start = Math.round((0.9 + index * per) * fps);
                  const t = Math.max(0, Math.min(1, (frame - start) / Math.round(0.4 * fps)));
                  const e = ease("expo_out", t);
                  if (e <= 0) return null;
                  const isCurrent = index === current;
                  return (
                    <span
                      key={part + i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 22,
                        fontFamily: FONTS.text,
                        fontSize: rowSize,
                        fontWeight: isCurrent ? 700 : 500,
                        letterSpacing: 0.6,
                        color: isCurrent ? palette.accent : palette.inkMuted,
                        transform: `translateY(${((1 - e) * 12).toFixed(1)}px)`,
                        opacity: e,
                      }}
                    >
                      {i > 0 && <span style={{ width: PART_SEPARATOR, height: 1.6, background: palette.line, display: "block" }} />}
                      <span style={{ display: "block" }}>{part}</span>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </SafeBox>
    </SceneShell>
  );
}

