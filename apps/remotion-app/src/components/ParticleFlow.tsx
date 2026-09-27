/**
 * Particle flow.
 *
 * Particles here are a *diagram convention*, not an effect. That means: flat
 * fills, a visible outline, no glow, no bloom, and a size that is comparable to
 * the line weight of the structure they are travelling through. A glowing dot
 * crossing a hand-drawn intestine would say "sci-fi"; a small outlined disc moving
 * along a lumen says "these are the molecules".
 *
 * Motion is a closed-form function of the frame. There is no state, no
 * simulation, and no dependence on how many frames were rendered before, so the
 * particle at frame 400 is in the same place whether the render started at frame
 * 0 or was resumed at 400.
 */

import { getLength, getPointAtLength, getTangentAtLength } from "@remotion/paths";
import { seededRandom } from "../art/hand.js";
import { ease } from "../motion/ease.js";
import type { Palette } from "../art/palette.js";

export interface ParticleFlowProps {
  /** Path in the parent's coordinate space. */
  d: string;
  palette: Palette;
  frame: number;
  fps: number;
  count?: number;
  /** Radius in px at the start and end of the path. */
  size?: [number, number];
  /** Seconds for one particle to traverse the whole path. */
  travelSeconds?: number;
  /** Passes over the path before the scene ends. 1 = one pass. */
  cycles?: number;
  seed?: number;
  /** Frames before the first particle enters. */
  delayFrames?: number;
  /** Frames over which particles fade in at the head and out at the tail. */
  edgeFrames?: number;
  color?: string;
  outline?: string;
  /** Shape vocabulary. `cell` and `molecule` are diagrams, not effects. */
  shape?: "dot" | "cell" | "molecule" | "square";
  opacity?: number;
  /** Draw the path underneath. */
  showPath?: boolean;
  pathColor?: string;
  pathWidth?: number;
  /** Direction of travel. */
  reverse?: boolean;
  /** Scatter perpendicular to the path, as a fraction of size. */
  jitter?: number;
}

export function ParticleFlow(props: ParticleFlowProps) {
  const {
    d,
    palette,
    frame,
    fps,
    count = 7,
    size = [7, 7],
    travelSeconds = 3.2,
    seed = 29,
    shape = "dot",
  } = props;
  const length = getLength(d);
  if (length <= 0) return null;
  const rand = seededRandom(seed);
  const f = frame - (props.delayFrames ?? 0);
  const cycles = Math.max(1, Math.round(props.cycles ?? 1));
  const travel = Math.max(1, Math.round(travelSeconds * fps));
  const edge = props.edgeFrames ?? Math.round(0.35 * fps);
  const jitter = props.jitter ?? 0.18;
  const color = props.color ?? palette.accent;
  const outline = props.outline ?? palette.ink;
  const pathWidth = props.pathWidth ?? 2.4;

  // Stagger is expressed as a fraction of the travel time, so the group always
  // fills the path instead of arriving in a clump and leaving a gap.
  const stagger = cycles > 1 ? travel / count : travel;

  const particles = [];
  for (let i = 0; i < count; i += 1) {
    const phase = cycles > 1 ? (f - i * stagger) / travel : f / travel;
    if (phase < 0 || phase > cycles) continue;
    let t = cycles > 1 ? phase % 1 : Math.min(1, phase);
    if (props.reverse) t = 1 - t;
    // Slight ease at the ends so particles settle into and out of the structure
    // instead of snapping at the boundary.
    const eased = ease("sine_in_out", t);
    const at = eased * length;
    const point = getPointAtLength(d, at);
    const tangent = getTangentAtLength(d, at);
    // A path that cannot be measured yet is a path that is not in the document
    // yet. Emitting a particle at the origin instead would put a stray dot in the
    // corner of the frame, which is worse than waiting one frame for the geometry.
    if (!point || !tangent) continue;
    const nx = -tangent.y;
    const ny = tangent.x;
    const off = (rand() - 0.5) * jitter * size[0] * 2;
    const r = size[0] + (size[1] - size[0]) * t + (rand() - 0.5) * 1.4;
    // Fade in over the first `edge` frames of travel and out over the last.
    const inFrames = Math.min(edge, travel * 0.4);
    const fade =
      Math.min(1, Math.max(0, (phase * travel) / Math.max(1, inFrames))) *
      Math.min(1, Math.max(0, ((1 - t) * travel) / Math.max(1, inFrames)));
    particles.push(
      <ParticleMark
        key={i}
        x={point.x + nx * off}
        y={point.y + ny * off}
        r={r}
        shape={shape}
        color={color}
        outline={outline}
        opacity={Math.max(0, Math.min(1, fade)) * (props.opacity ?? 1)}
        seed={seed + i * 13}
      />,
    );
  }

  return (
    <g>
      {props.showPath && (
        <path
          d={d}
          fill="none"
          stroke={props.pathColor ?? palette.lineStrong}
          strokeWidth={pathWidth}
          strokeLinecap="round"
          opacity={0.85}
          strokeDasharray={f > 0 ? undefined : `${length} ${length}`}
        />
      )}
      {particles}
    </g>
  );
}

function ParticleMark({
  x,
  y,
  r,
  shape,
  color,
  outline,
  opacity,
  seed,
}: {
  x: number;
  y: number;
  r: number;
  shape: "dot" | "cell" | "molecule" | "square";
  color: string;
  outline: string;
  opacity: number;
  seed: number;
}) {
  if (opacity <= 0.01) return null;
  const common = { opacity, fill: color, stroke: outline, strokeWidth: Math.max(1, r * 0.18) };
  if (shape === "square") {
    return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...common} />;
  }
  if (shape === "cell") {
    // A biconcave disc: the standard way to draw a red blood cell.
    return (
      <g opacity={opacity}>
        <circle cx={x} cy={y} r={r} fill={color} stroke={outline} strokeWidth={Math.max(1, r * 0.16)} />
        <ellipse cx={x} cy={y} rx={r * 0.52} ry={r * 0.44} fill={outline} opacity={0.22} />
      </g>
    );
  }
  if (shape === "molecule") {
    // A labelled node: a small polygon with a tick, not a sparkle.
    const rand = seededRandom(seed);
    const sides = 5 + Math.floor(rand() * 3);
    const pts = [];
    for (let i = 0; i < sides; i += 1) {
      const a = (i / sides) * Math.PI * 2 + rand() * 0.2;
      pts.push(`${(x + Math.cos(a) * r * 1.15).toFixed(1)},${(y + Math.sin(a) * r * 1.15).toFixed(1)}`);
    }
    return <polygon points={pts.join(" ")} {...common} />;
  }
  return <circle cx={x} cy={y} r={r} {...common} />;
}

/**
 * A path that draws itself and then holds, with a travelling dot showing
 * direction. Used where a flow has to be *named* rather than filled with
 * particles: one molecule, one path.
 */
export function PathTrail({
  d,
  palette,
  frame,
  durationInFrames,
  seed = 31,
  color,
  width = 2.6,
  dot = true,
}: {
  d: string;
  palette: Palette;
  frame: number;
  durationInFrames: number;
  seed?: number;
  color?: string;
  width?: number;
  dot?: boolean;
}) {
  const length = getLength(d);
  const travel = Math.max(1, Math.round(durationInFrames * 0.5));
  const t = Math.max(0, Math.min(1, frame / Math.max(1, durationInFrames)));
  const drawn = Math.min(1, Math.max(0, frame / travel)) * length;
  if (drawn <= 0) return null;
  const ink = color ?? palette.ink;
  const head = getPointAtLength(d, drawn);
  // A pen mark has weight. The head dot is sized from the seed so two trails in
  // the same frame do not carry identically-sized marks.
  const headR = width * (1.5 + 0.4 * Math.sin(seed * 0.7 + t * Math.PI));
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={palette.line}
        strokeWidth={width * 0.6}
        strokeDasharray={`${length} ${length}`}
        strokeDashoffset={0}
        opacity={0.7}
      />
      <path
        d={d}
        fill="none"
        stroke={ink}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={`${length} ${length}`}
        strokeDashoffset={length - drawn}
        opacity={0.95}
      />
      {dot && head && t > 0.02 && t < 0.999 && <circle cx={head.x} cy={head.y} r={headR} fill={ink} opacity={0.9} />}
    </g>
  );
}
