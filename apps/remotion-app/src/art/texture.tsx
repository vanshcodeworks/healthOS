/**
 * Paper texture and print marks.
 *
 * A flat fill reads as a slide. What makes paper read as paper is a low-amplitude
 * grain plus a very slight vignette, both of which have to be deterministic:
 * `feTurbulence` is seeded, so the same frame gets the same grain every time.
 *
 * Grain is kept under 4% opacity. Any stronger and it fights the type at phone
 * size, which is the one place the type has to win.
 */

import { GRID, HAIRLINE } from "./spacing.js";
import type { Palette } from "./palette.js";

export function PaperGrain({ palette, seed = 7 }: { palette: Palette; seed?: number }) {
  return (
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      aria-hidden
      shapeRendering="precise"
    >
      <filter id={`grain-${seed}`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed={seed} />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect
        width="100%"
        height="100%"
        filter={`url(#grain-${seed})`}
        opacity={palette.grain}
        style={{ mixBlendMode: "multiply" }}
      />
    </svg>
  );
}

/** A vignette that darkens the paper very slightly toward the corners. */
export function PaperVignette({ palette }: { palette: Palette }) {
  return (
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      aria-hidden
      shapeRendering="precise"
    >
      <defs>
        <radialGradient id="vignette" cx="50%" cy="42%" r="76%">
          <stop offset="55%" stopColor={palette.paper} stopOpacity={0} />
          <stop offset="100%" stopColor={palette.paperDeep} stopOpacity={0.55} />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#vignette)" />
    </svg>
  );
}

/**
 * A hairline rule with a measured end: the tick marks are the point. An
 * unadorned rule is decoration; a rule with a tick is a measurement, and that
 * is what this system uses rules for.
 */
export function MeasuredRule({
  palette,
  width,
  x,
  y,
  tick = 18,
}: {
  palette: Palette;
  width: number;
  x: number;
  y: number;
  tick?: number;
}) {
  return (
    <g>
      <line x1={x} y1={y} x2={x + width} y2={y} stroke={palette.lineStrong} strokeWidth={HAIRLINE} />
      <line x1={x} y1={y - tick / 2} x2={x} y2={y + tick / 2} stroke={palette.lineStrong} strokeWidth={HAIRLINE} />
      <line
        x1={x + width}
        y1={y - tick / 2}
        x2={x + width}
        y2={y + tick / 2}
        stroke={palette.lineStrong}
        strokeWidth={HAIRLINE}
      />
    </g>
  );
}

/** Faint column guides. Off by default; useful when art-directing a frame. */
export function ColumnGuides({ palette }: { palette: Palette }) {
  const cells = [];
  for (let i = 0; i < GRID.columns; i += 1) {
    cells.push(<rect key={i} x={GRID.x(i)} y={0} width={GRID.columnWidth} height={1920} fill={palette.line} opacity={0.5} />);
  }
  return <svg style={{ position: "absolute", inset: 0 }} aria-hidden>{cells}</svg>;
}
