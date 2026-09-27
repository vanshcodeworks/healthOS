/**
 * Scientific labels.
 *
 * A label in a scientific diagram is a claim about position: this text belongs to
 * that structure. So a label is never free-floating type near a shape, it is a
 * leader line plus a tick plus type, and it enters only once the structure it
 * names has been drawn. A label that arrives before its organ is a caption for a
 * mystery.
 */

import { FONTS } from "../art/typography.js";
import { ease } from "../motion/ease.js";
import { handPath } from "../art/hand.js";
import type { Palette } from "../art/palette.js";

export interface ScientificLabelProps {
  text: string;
  palette: Palette;
  /** Frame within the scene. */
  frame: number;
  fps: number;
  /** Anchor on the structure being named, in the parent's coordinate space. */
  anchor: { x: number; y: number };
  /** Where the text sits, in the parent's coordinate space. */
  at: { x: number; y: number };
  /** Which side the text is on. The leader line goes the other way. */
  side?: "left" | "right";
  delayFrames?: number;
  seed?: number;
  /** Weight of the emphasis dot on the structure. */
  dot?: boolean;
  align?: "start" | "end" | "middle";
  color?: string;
  muted?: boolean;
  size?: number;
  /** Draw a bracket instead of a dot: for a region, not a point. */
  bracket?: { w: number; h: number };
}

export function ScientificLabel(props: ScientificLabelProps) {
  const { palette, frame, fps, anchor, at, side = "right", seed = 5 } = props;
  const delay = props.delayFrames ?? 0;
  const duration = Math.round(0.55 * fps);
  const f = frame - delay;
  if (f <= 0) return null;
  const t = Math.min(1, f / duration);
  const e = ease("cubic_out", t);
  const ink = props.color ?? (props.muted ? palette.inkMuted : palette.ink);
  const size = props.size ?? 25;
  const elbowX = side === "right" ? at.x - 18 : at.x + 18;
  const leader = handPath(
    `M ${anchor.x} ${anchor.y} L ${elbowX} ${at.y} L ${at.x} ${at.y}`,
    { seed, roughness: 1.2, samples: 24 },
  );
  const align = props.align ?? (side === "right" ? "start" : "end");
  const textX = side === "right" ? at.x + 8 : at.x - 8;

  return (
    <g opacity={Math.min(1, e * 2.2)}>
      <path
        d={leader}
        fill="none"
        stroke={palette.lineStrong}
        strokeWidth={1.5}
        strokeDasharray={`${2.4} ${3.4}`}
        strokeDashoffset={-60 * e}
      />
      {props.bracket ? (
        <path
          d={handPath(
            bracketPath(anchor.x, anchor.y, props.bracket.w, props.bracket.h, side),
            { seed: seed + 3, roughness: 1.1, samples: 20 },
          )}
          fill="none"
          stroke={palette.accent}
          strokeWidth={1.8}
          opacity={0.55 + 0.45 * e}
        />
      ) : (
        props.dot !== false && (
          <circle cx={anchor.x} cy={anchor.y} r={3.4} fill={palette.accent} />
        )
      )}
      <text
        x={textX}
        y={at.y + size * 0.36}
        textAnchor={align}
        fontFamily={FONTS.text}
        fontSize={size}
        fontWeight={600}
        letterSpacing={0.5}
        fill={ink}
      >
        {props.text}
      </text>
    </g>
  );
}

function bracketPath(x: number, y: number, w: number, h: number, side: "left" | "right"): string {
  const x2 = side === "right" ? x + w : x - w;
  const corner = Math.min(14, w * 0.3);
  const dir = side === "right" ? 1 : -1;
  return (
    `M ${x} ${y - h / 2} L ${x} ${y - h / 2 + corner} L ${x + corner * dir} ${y - h / 2} ` +
    `M ${x2} ${y - h / 2} L ${x2} ${y - h / 2 + corner} L ${x2 - corner * dir} ${y - h / 2} ` +
    `M ${x} ${y + h / 2} L ${x} ${y + h / 2 - corner} L ${x + corner * dir} ${y + h / 2} ` +
    `M ${x2} ${y + h / 2} L ${x2} ${y + h / 2 - corner} L ${x2 - corner * dir} ${y + h / 2}`
  );
}

/** A small caps unit or qualifier, set under a number or a term. */
export function UnitNote({
  text,
  palette,
  align = "start",
  x = 0,
  y = 0,
  size = 24,
}: {
  text: string;
  palette: Palette;
  align?: "start" | "middle" | "end";
  x?: number;
  y?: number;
  size?: number;
}) {
  if (!text) return null;
  return (
    <text
      x={x}
      y={y}
      textAnchor={align}
      fontFamily={FONTS.text}
      fontSize={size}
      fontWeight={500}
      letterSpacing={1.6}
      fill={palette.inkMuted}
    >
      {text.toUpperCase()}
    </text>
  );
}
