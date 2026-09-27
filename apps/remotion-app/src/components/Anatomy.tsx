/**
 * The anatomy renderer.
 *
 * Turns a figure from `anatomy/figures` into a diagram on screen: hand-drawn
 * contour, drawn on in anatomical order, interior marks following, labels last
 * and attached by leader lines.
 *
 * The draw order is the point. A stomach that outlines itself and then grows its
 * rugae is being drawn; a stomach that fades in complete is being displayed. The
 * viewer's eye is carried along the contour, which is the only way an animation
 * ends up explaining something.
 */

import { ANATOMY, type AnatomyFigure } from "./anatomy/figures.js";
import { anatomyAssetFor } from "../art/anatomy-assets.js";
import { handPath } from "../art/hand.js";
import { drawPath } from "../motion/draw.js";
import type { Palette } from "../art/palette.js";
import { FONTS } from "../art/typography.js";
import { ease } from "../motion/ease.js";
import { Img, staticFile } from "remotion";

export interface AnatomyProps {
  name: string;
  palette: Palette;
  /** Displayed width in px. Height follows the figure's aspect. */
  width: number;
  seed: number;
  /** Frame within the scene. */
  frame: number;
  fps: number;
  /** How long the whole figure takes to draw, in frames. */
  durationInFrames?: number;
  /** Contour indices to emphasise. */
  highlight?: number[];
  /** Label visibility: `on` after the drawing finishes, `never`, or `fade`. */
  labels?: "on" | "never";
  /** Contour stroke width in px at display scale. */
  strokeWidth?: number;
  /** Show interior marks at all. */
  detail?: boolean;
  opacity?: number;
}

const ROLE_WIDTH: Record<string, number> = {
  contour: 1.0,
  tube: 0.92,
  detail: 0.6,
  cavity: 0.7,
};

const ROLE_COLOR: Record<string, (p: Palette) => string> = {
  contour: (p) => p.ink,
  tube: (p) => p.ink,
  detail: (p) => p.inkMuted,
  cavity: (p) => p.ink,
};

export function anatomyHeight(name: string, width: number): number {
  // A real illustration's aspect comes from its native size, so the display size
  // follows the drawing rather than squashing it into a procedural box.
  const asset = anatomyAssetFor(name);
  if (asset) return (width * asset.height) / asset.width;
  const figure = ANATOMY[name];
  if (!figure) return width;
  return (width * figure.viewBox.h) / figure.viewBox.w;
}

/** True when the figure renders as a real illustration rather than a drawing. */
export function isRealAsset(name: string): boolean {
  return anatomyAssetFor(name) !== undefined;
}

export function Anatomy(props: AnatomyProps) {
  const asset = anatomyAssetFor(props.name);
  if (asset) return <AssetAnatomy {...props} asset={asset} />;
  const figure: AnatomyFigure | undefined = ANATOMY[props.name];
  if (!figure) return null;
  const {
    palette,
    width,
    seed,
    frame,
    fps,
    highlight = [],
    labels = "on",
    detail = true,
    opacity = 1,
  } = props;
  const height = (width * figure.viewBox.h) / figure.viewBox.w;
  const scale = width / figure.viewBox.w;
  const total = props.durationInFrames ?? Math.round(1.5 * fps);
  const baseStroke = (props.strokeWidth ?? 2.6) / scale;

  const ordered = figure.strokes
    .map((stroke, index) => ({ stroke, index }))
    .filter(({ stroke }) => detail || stroke.role !== "detail")
    .sort((a, b) => (a.stroke.order ?? a.index) - (b.stroke.order ?? b.index));

  // Each stroke gets a slice of the total, so the figure finishes drawing at the
  // end of its window rather than trailing off.
  const perStroke = total / Math.max(1, ordered.length);

  const labelStart = Math.round(0.82 * total);
  const labelT = Math.min(1, Math.max(0, (frame - labelStart) / Math.max(1, Math.round(0.5 * fps))));

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${figure.viewBox.w} ${figure.viewBox.h}`}
      style={{ overflow: "visible", opacity }}
      shapeRendering="geometricPrecision"
    >
      {ordered.map(({ stroke, index }, position) => {
        const d = handPath(stroke.d, { seed: seed + index * 37, roughness: baseStroke * 0.5, samples: 44 });
        const draw = drawPath(d, {
          frame: frame - Math.round(position * perStroke * 0.42),
          fps,
          durationInFrames: Math.max(4, Math.round(perStroke)),
          easing: "sine_out",
        });
        const emphasised = highlight.includes(index);
        const roleColor = ROLE_COLOR[stroke.role];
        const color = emphasised ? palette.accent : roleColor ? roleColor(palette) : palette.ink;
        return (
          <path
            key={index}
            d={d}
            fill={stroke.role === "cavity" ? palette.accentTint : "none"}
            fillOpacity={stroke.role === "cavity" ? 0.5 : 0}
            stroke={color}
            strokeWidth={baseStroke * (ROLE_WIDTH[stroke.role] ?? 0.8) * draw.weight * (emphasised ? 1.5 : 1)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={draw.dashArray}
            strokeDashoffset={draw.dashOffset}
            opacity={draw.opacity}
          />
        );
      })}

      {labels === "on" &&
        figure.labels.map((label, i) => {
          const t = ease("cubic_out", Math.max(0, Math.min(1, labelT - i * 0.08)));
          if (t <= 0) return null;
          return (
            <g key={i} opacity={t}>
              {label.target !== undefined && (
                <path
                  d={leaderLine(figure, label)}
                  fill="none"
                  stroke={palette.lineStrong}
                  strokeWidth={baseStroke * 0.4}
                  strokeDasharray={baseStroke * 3}
                  opacity={0.9}
                />
              )}
              <circle cx={label.x} cy={label.y} r={baseStroke * 1.1} fill={palette.accent} opacity={0.9} />
              <text
                x={label.x + (label.anchor === "end" ? -10 : label.anchor === "middle" ? 0 : 10)}
                y={label.y + 5}
                textAnchor={label.anchor}
                fontFamily={FONTS.text}
                fontSize={baseStroke * 8.4}
                fontWeight={label.role === "part" ? 600 : 400}
                letterSpacing={0.6}
                fill={label.role === "part" ? palette.ink : palette.inkMuted}
              >
                {label.text}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

/** A hairline from a label to the part it names. */
function leaderLine(figure: AnatomyFigure, label: { x: number; y: number; target?: number }): string {
  const stroke = label.target === undefined ? undefined : figure.strokes[label.target];
  if (!stroke) return "";
  // Aim at the middle of the target stroke, which is close enough for a leader
  // line and avoids measuring the drawn path at render time.
  const numbers = stroke.d.match(/-?\d+(\.\d+)?/g);
  if (!numbers || numbers.length < 2) return "";
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const x = Number(numbers[i]);
    const y = Number(numbers[i + 1]);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return "";
  const tx = (minX + maxX) / 2;
  const ty = (minY + maxY) / 2;
  const midX = (label.x + tx) / 2;
  return `M ${label.x} ${label.y} L ${midX} ${label.y} L ${tx} ${ty}`;
}

/**
 * A real anatomical illustration, revealed rather than drawn.
 *
 * The procedural drawing above exists because the viewer's eye is carried along a
 * contour as it is drawn. A photograph or an NIH illustration cannot be drawn —
 * it is already drawn — so it arrives the way a photograph arrives: settled into
 * place with a small rise and a fade, and the paper's grain over it. Revealing a
 * real illustration with the draw language would be a lie about what it is;
 * revealing it with nothing would be a slide.
 *
 * A labelled illustration is the label. The renderer's own labels are skipped
 * when the image carries its own printing, and drawn over an unlabelled one.
 */
function AssetAnatomy(props: AnatomyProps & { asset: { file: string; labelled: boolean; width: number; height: number } }) {
  const { width, frame, fps, labels = "on", opacity = 1 } = props;
  const asset = props.asset;
  const height = (width * asset.height) / asset.width;
  const total = props.durationInFrames ?? Math.round(1.5 * fps);
  const t = ease("cubic_out", Math.max(0, Math.min(1, frame / Math.max(1, Math.round(0.6 * fps)))));
  const labelStart = Math.round(0.7 * total);
  const labelT = Math.min(1, Math.max(0, (frame - labelStart) / Math.max(1, Math.round(0.5 * fps))));

  return (
    <div style={{ position: "relative", width, height, opacity: opacity * Math.max(0.001, t) }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateY(${((1 - t) * 18).toFixed(2)}px) scale(${(0.965 + 0.035 * t).toFixed(4)})`,
          transformOrigin: "50% 60%",
        }}
      >
        <Img
          src={staticFile(`anatomy/${asset.file}`)}
          width={width}
          height={height}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </div>
      {labels === "on" &&
        !asset.labelled &&
        // An unlabelled illustration gets the renderer's own callouts, in the
        // same register as the procedural drawing's labels: a small accent dot
        // and a quiet name, arriving after the illustration has settled.
        assetLabels(props, labelT)}
    </div>
  );
}

/** Callouts over an unlabelled illustration: one name, at the figure's centre of mass. */
function assetLabels(props: AnatomyProps & { asset: { file: string; labelled: boolean; width: number; height: number } }, labelT: number) {
  const { palette } = props;
  const t = ease("cubic_out", labelT);
  if (t <= 0) return null;
  const name = props.name.replace(/_/g, " ");
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        bottom: 6,
        display: "flex",
        alignItems: "center",
        gap: 10,
        opacity: t,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: palette.accent,
        }}
      />
      <span
        style={{
          fontFamily: FONTS.text,
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: 1.2,
          color: palette.ink,
        }}
      >
        {name}
      </span>
    </div>
  );
}
