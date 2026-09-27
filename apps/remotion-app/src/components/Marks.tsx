/**
 * Editorial marks.
 *
 * The small vocabulary a scientific editor uses to point at a thing: a bracket
 * around a region, a measurement line with ticks, an arrow along a flow, an
 * underline that means "this word", a crosshair on a value.
 *
 * These are not decoration. Each one is drawn, each one enters after the thing it
 * refers to exists, and each one is deterministic. A bracket that fades in reads
 * as a UI element; a bracket that draws itself reads as pen work.
 */

import { handPath, handWeight } from "../art/hand.js";
import { drawPath } from "../motion/draw.js";
import { ease } from "../motion/ease.js";
import type { Palette } from "../art/palette.js";

export interface MarkProps {
  palette: Palette;
  frame: number;
  fps: number;
  durationInFrames?: number;
  delayFrames?: number;
  seed?: number;
  color?: string;
  strokeWidth?: number;
  /**
   * Pixels per path unit, for a mark drawn into a `0 0 1 1` viewBox.
   *
   * `strokeWidth` is a physical width in pixels everywhere else, and a viewBox
   * rescales the stroke with the geometry: 1 path unit against a 900px-wide
   * figure is 900px, so a `2.2` stroke becomes a 2px-wide... no, a 2000px-wide
   * bar that covers the frame. Pass the figure width here and the component
   * divides. Omit it only when the viewBox is already in pixel units.
   */
  unitScale?: number;
}

/** A bracket around a region. Two of the four corners, on the open side. */
export function Bracket({
  x,
  y,
  w,
  h,
  side = "right",
  ...mark
}: MarkProps & { x: number; y: number; w: number; h: number; side?: "left" | "right" | "top" | "bottom" }) {
  const { palette, frame, fps, seed = 11 } = mark;
  // Hand-drawn, because a bracket is a mark a person made. The rule it brackets is
  // not: see `Measure`.
  const raw = bracketPathD(x, y, w, h, side);
  const d = handPath(raw, { seed, roughness: 0.7, samples: 22 });
  const drawn = drawPath(d, {
    frame: frame - (mark.delayFrames ?? 0),
    fps,
    durationInFrames: mark.durationInFrames ?? Math.round(0.6 * fps),
    easing: "cubic_out",
  });
  // See `unitScale`: the caller owns the viewBox, this converts the stroke back
  // into a width in pixels.
  const strokeWidth = (mark.strokeWidth ?? 2.2) / (mark.unitScale ?? 1);
  return (
    <path
      d={d}
      fill="none"
      stroke={mark.color ?? palette.accent}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeDasharray={drawn.dashArray}
      strokeDashoffset={drawn.dashOffset}
      opacity={drawn.opacity}
    />
  );
}

function bracketPathD(x: number, y: number, w: number, h: number, side: string): string {
  const c = Math.min(22, Math.min(w, h) * 0.22);
  const x2 = x + w;
  const y2 = y + h;
  if (side === "right") {
    return `M ${x} ${y + c} L ${x} ${y} L ${x + c} ${y} M ${x2 - c} ${y} L ${x2} ${y} L ${x2} ${y + c}`;
  }
  if (side === "left") {
    return `M ${x2} ${y + c} L ${x2} ${y} L ${x2 - c} ${y} M ${x + c} ${y} L ${x} ${y} L ${x} ${y + c}`;
  }
  if (side === "bottom") {
    return `M ${x + c} ${y2} L ${x} ${y2} L ${x} ${y2 - c} M ${x2 - c} ${y2} L ${x2} ${y2} L ${x2} ${y2 - c}`;
  }
  return `M ${x} ${y + c} L ${x} ${y} L ${x + c} ${y} M ${x2 - c} ${y} L ${x2} ${y} L ${x2} ${y + c}`;
}

/** A measurement line: a rule with end ticks and an optional caption. */
export function Measure({
  x1,
  y1,
  x2,
  y2,
  label,
  palette,
  frame,
  fps,
  delayFrames = 0,
  color,
}: MarkProps & { x1: number; y1: number; x2: number; y2: number; label?: string }) {
  // Deliberately not hand-drawn. A bracket is an annotation and a wobble reads as
  // pen work; a measurement is a claim about a distance, and a wobbly one would be
  // a claim the frame cannot support. So this is the one mark in the file that is
  // exactly straight, and `seed` is accepted and ignored on purpose.
  const duration = Math.round(0.5 * fps);
  const t = Math.max(0, Math.min(1, (frame - delayFrames) / duration));
  const e = ease("cubic_out", t);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const tick = 9;
  const ink = color ?? palette.inkMuted;
  const shownX = x1 + dx * e;
  const shownY = y1 + dy * e;
  return (
    <g opacity={Math.min(1, e * 2.4)}>
      <line x1={x1} y1={y1} x2={shownX} y2={shownY} stroke={ink} strokeWidth={1.4} />
      {e > 0.98 && (
        <>
          <line
            x1={x2 - ux * tick + nx * tick}
            y1={y2 - uy * tick + ny * tick}
            x2={x2 + ux * tick + nx * tick}
            y2={y2 + uy * tick + ny * tick}
            stroke={ink}
            strokeWidth={1.4}
          />
          <line
            x1={x2 - ux * tick - nx * tick}
            y1={y2 - uy * tick - ny * tick}
            x2={x2 + ux * tick - nx * tick}
            y2={y2 + uy * tick - ny * tick}
            stroke={ink}
            strokeWidth={1.4}
          />
        </>
      )}
      {label && e > 0.7 && (
        <text
          x={(x1 + x2) / 2 + nx * 16}
          y={(y1 + y2) / 2 + ny * 16 + 8}
          textAnchor="middle"
          fontFamily="Consolas, monospace"
          fontSize={21}
          fill={ink}
          opacity={(e - 0.7) / 0.3}
        >
          {label}
        </text>
      )}
    </g>
  );
}

/** A flow arrow. The head is drawn after the shaft, so the eye follows it. */
export function FlowArrow({
  x1,
  y1,
  x2,
  y2,
  ...mark
}: MarkProps & { x1: number; y1: number; x2: number; y2: number }) {
  const { palette, frame, fps, seed = 17 } = mark;
  const shaft = `M ${x1} ${y1} L ${x2} ${y2}`;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(20, len * 0.22);
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const spread = head * 0.52;
  const headPath = `M ${bx - uy * spread} ${by + ux * spread} L ${x2} ${y2} L ${bx + uy * spread} ${by - ux * spread}`;
  const duration = mark.durationInFrames ?? Math.round(0.45 * fps);
  const shaftDraw = drawPath(shaft, { frame: frame - (mark.delayFrames ?? 0), fps, durationInFrames: duration, easing: "sine_out" });
  const headDraw = drawPath(headPath, {
    frame: frame - (mark.delayFrames ?? 0) - duration * 0.7,
    fps,
    durationInFrames: Math.round(0.22 * fps),
    easing: "expo_out",
  });
  const ink = mark.color ?? palette.ink;
  return (
    <g strokeLinecap="round" fill="none">
      <path
        d={handPath(shaft, { seed, roughness: 0.9, samples: 20 })}
        stroke={ink}
        strokeWidth={mark.strokeWidth ?? 2}
        strokeDasharray={shaftDraw.dashArray}
        strokeDashoffset={shaftDraw.dashOffset}
        opacity={shaftDraw.opacity}
      />
      <path
        d={headPath}
        stroke={ink}
        strokeWidth={(mark.strokeWidth ?? 2) * handWeight(seed, 0.5, 0.1)}
        strokeDasharray={headDraw.dashArray}
        strokeDashoffset={headDraw.dashOffset}
        opacity={headDraw.opacity}
      />
    </g>
  );
}

/** A hand-drawn underline. Means "this", the way an editor means it. */
export function Underline({
  x,
  y,
  w,
  ...mark
}: MarkProps & { x: number; y: number; w: number }) {
  const { palette, frame, fps, seed = 19 } = mark;
  const d = handPath(`M ${x + 2} ${y} C ${x + w * 0.3} ${y - 3} ${x + w * 0.7} ${y + 3} ${x + w - 2} ${y}`, {
    seed,
    roughness: 1.3,
    samples: 26,
  });
  const drawn = drawPath(d, {
    frame: frame - (mark.delayFrames ?? 0),
    fps,
    durationInFrames: mark.durationInFrames ?? Math.round(0.4 * fps),
    easing: "sine_out",
  });
  return (
    <path
      d={d}
      fill="none"
      stroke={mark.color ?? palette.accent}
      strokeWidth={mark.strokeWidth ?? 3}
      strokeLinecap="round"
      strokeDasharray={drawn.dashArray}
      strokeDashoffset={drawn.dashOffset}
      opacity={drawn.opacity}
    />
  );
}

/** A crosshair. Marks a value without a box around it. */
export function Crosshair({ x, y, r, ...mark }: MarkProps & { x: number; y: number; r?: number }) {
  const { palette, frame, fps } = mark;
  const radius = r ?? 22;
  const t = Math.max(0, Math.min(1, (frame - (mark.delayFrames ?? 0)) / Math.round(0.4 * fps)));
  const e = ease("expo_out", t);
  if (e <= 0) return null;
  const gap = radius * 0.28 * (1 - e);
  return (
    <g stroke={mark.color ?? palette.accent} strokeWidth={mark.strokeWidth ?? 2} opacity={e}>
      <line x1={x - radius} y1={y} x2={x - gap} y2={y} />
      <line x1={x + gap} y1={y} x2={x + radius} y2={y} />
      <line x1={x} y1={y - radius} x2={x} y2={y - gap} />
      <line x1={x} y1={y + gap} x2={x} y2={y + radius} />
    </g>
  );
}

/** A hatched region. Suggests tissue without filling it in. */
export function Hatch({
  x,
  y,
  w,
  h,
  gap = 14,
  angle = 45,
  ...mark
}: MarkProps & { x: number; y: number; w: number; h: number; gap?: number; angle?: number }) {
  const { palette, frame, fps, seed = 23 } = mark;
  const t = Math.max(0, Math.min(1, (frame - (mark.delayFrames ?? 0)) / Math.round(0.7 * fps)));
  const lines: string[] = [];
  const diag = Math.hypot(w, h);
  const step = gap;
  for (let d = 0; d <= diag; d += step) {
    const cx1 = x + d * Math.cos((angle * Math.PI) / 180);
    const cy1 = y + d * Math.sin((angle * Math.PI) / 180);
    const cx2 = cx1 - diag * Math.cos((angle * Math.PI) / 180);
    const cy2 = cy1 - diag * Math.sin((angle * Math.PI) / 180);
    const a = { x: Math.max(x, Math.min(x + w, cx1)), y: Math.max(y, Math.min(y + h, cy1)) };
    const b = { x: Math.max(x, Math.min(x + w, cx2)), y: Math.max(y, Math.min(y + h, cy2)) };
    if (Math.hypot(a.x - b.x, a.y - b.y) < 6) continue;
    lines.push(`M ${a.x} ${a.y} L ${b.x} ${b.y}`);
  }
  return (
    <g opacity={Math.min(0.5, t * 0.5)}>
      {lines.map((d, i) => (
        <path
          key={i}
          d={handPath(d, { seed: seed + i, roughness: 0.7, samples: 10 })}
          fill="none"
          stroke={mark.color ?? palette.lineStrong}
          strokeWidth={1.1}
        />
      ))}
    </g>
  );
}
