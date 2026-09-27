/**
 * Scene scaffolding.
 *
 * Everything a scene grammar shares: the paper, the grain, the safe area, the
 * camera, and the mapping from a storyboard component name to something that can
 * actually be drawn.
 *
 * The point of `anatomyForComponent` is that a scene never names a drawing
 * directly. The storyboard says "Stomach"; the composition decides that a
 * stomach is the `stomach` figure. If a storyboard asks for an organ this
 * renderer cannot draw, the answer is `null` and the composition falls back to
 * another grammar — never a generic box with an icon in it.
 */

import type { CSSProperties, ReactNode } from "react";
import { Camera } from "../components/Camera.js";
import { PaperGrain, PaperVignette } from "../art/texture.js";
import { CONTENT, FRAME, SAFE } from "../art/spacing.js";
import type { Palette } from "../art/palette.js";
import type { SceneRef } from "../props.js";
import { ease } from "../motion/ease.js";
import { FONTS } from "../art/typography.js";

export interface SceneProps {
  scene: SceneRef;
  palette: Palette;
  /** Frame within this scene. */
  frame: number;
  fps: number;
  durationInFrames: number;
  profile: string;
  seed: number;
  width: number;
  height: number;
  /** The video's topic, for the hook's opening line. Constant across scenes. */
  topic?: string;
  /** The video's title, for the hook's closing rail. Constant across scenes. */
  title?: string;
  /** How many scenes the video has, for the hook's chapter mark. Constant across scenes. */
  sceneCount?: number;
}

export function SceneShell(props: SceneProps & { children: ReactNode; depth?: number; camera?: SceneRef["camera"]; background?: string }) {
  const { palette, scene, frame, fps, durationInFrames, children } = props;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: props.background ?? palette.paper,
        overflow: "hidden",
      }}
    >
      {/* A wash of the accent behind the shot. A figure on bare paper reads as a
          sketch on a page; a figure inside a field of its own colour reads as an
          illustration in a printed plate. The wash is the accent at a low alpha,
          strongest where the content sits and clear at the edges, so the frame
          keeps its ground and the figure keeps its colour. */}
      <AccentWash palette={palette} frame={frame} fps={fps} seed={props.seed} />
      <Camera
        camera={props.camera ?? scene.camera}
        frame={frame}
        fps={fps}
        durationInFrames={durationInFrames}
        profile={props.profile}
        depth={props.depth ?? 1}
      >
        {children}
      </Camera>
      <PaperVignette palette={palette} />
      <PaperGrain palette={palette} seed={props.seed % 97} />
    </div>
  );
}

/**
 * A radial field of the accent, behind the shot.
 *
 * Deterministic and still: no drift, no animation beyond the settle, because the
 * wash is the page's ground and a ground that moves competes with the figure.
 * The id carries the seed the way the grain's does, so two scenes never collide
 * on one gradient definition.
 */
export function AccentWash({ palette, frame, fps, seed = 5 }: { palette: Palette; frame: number; fps: number; seed?: number }) {
  const t = ease("cubic_out", Math.max(0, Math.min(1, frame / Math.max(1, Math.round(0.8 * fps)))));
  const id = `wash-${seed % 97}`;
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden shapeRendering="geometricPrecision">
      <defs>
        <radialGradient id={id} cx="50%" cy="46%" r="72%">
          <stop offset="0%" stopColor={palette.accentTint} stopOpacity={0.9 * t} />
          <stop offset="62%" stopColor={palette.accentTint} stopOpacity={0.45 * t} />
          <stop offset="100%" stopColor={palette.paper} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** The safe content box, as a positioned div. */
export function SafeBox({
  children,
  style,
  align = "flex-start",
  justify = "flex-start",
}: {
  children: ReactNode;
  style?: CSSProperties;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: CONTENT.left,
        width: CONTENT.width,
        top: SAFE.top,
        height: CONTENT.height,
        display: "flex",
        flexDirection: "column",
        alignItems: align,
        justifyContent: justify,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Component name to anatomy figure.
 *
 * Names come from the storyboard's closed `ComponentName` union, so an unmapped
 * name is a real possibility and has to return `null` rather than guess.
 */
const ANATOMY_FOR_COMPONENT: Record<string, string> = {
  Stomach: "stomach",
  Intestine: "intestine",
  Kidney: "kidney",
  BloodVessel: "blood_vessel",
  Heart: "heart",
  Brain: "brain",
  Lungs: "lungs",
  Cell: "cell",
  Receptor: "receptor",
  Molecule: "molecule",
  BloodCell: "capillary_bed",
  Pathway: "capillary_bed",
  Neuron: "cell",
  Membrane: "cell",
};

export function anatomyForComponent(name: string): string | null {
  return ANATOMY_FOR_COMPONENT[name] ?? null;
}

/** The first drawable component in a scene, as a figure name. */
export function primaryFigure(scene: SceneRef): string | null {
  for (const component of scene.components) {
    const figure = anatomyForComponent(component.component);
    if (figure) return figure;
  }
  return null;
}

/** Label text for a component, falling back to a readable name. */
export function componentLabel(scene: SceneRef, index: number): string {
  const component = scene.components[index];
  if (!component) return "";
  if (component.label) return component.label;
  return component.component.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/**
 * A scene with no drawable figure, drawn as type.
 *
 * The alternative to this is guessing: every figure grammar wants a name, and a
 * name that is not there gets filled in with whatever that grammar usually draws.
 * A video that shows a stomach the storyboard never asked for is wrong in a way no
 * amount of good typography repairs, so the frame says its words and draws
 * nothing instead. `Anatomy` never receives a figure it was not given.
 */
export function TypographicFigure({ scene, palette }: { scene: SceneRef; palette: Palette }) {
  const text = scene.headline || scene.beats[0]?.text || "";
  return (
    <div
      style={{
        fontFamily: FONTS.display,
        fontSize: 60,
        lineHeight: 1.18,
        color: palette.ink,
        opacity: 0.9,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

/** Frames at which each beat starts, relative to the scene. */
export function beatFrames(scene: SceneRef, fps: number): { index: number; start: number }[] {
  return scene.beats.map((beat, index) => ({
    index,
    start: Math.round(beat.local_start_s * fps),
  }));
}

/** The beat that is current at a frame, or the nearest preceding one. */
export function activeBeat(scene: SceneRef, frame: number, fps: number): number {
  let active = 0;
  for (const [index, beat] of scene.beats.entries()) {
    if (frame >= beat.local_start_s * fps) active = index;
  }
  return active;
}

export const STAGE = FRAME;
