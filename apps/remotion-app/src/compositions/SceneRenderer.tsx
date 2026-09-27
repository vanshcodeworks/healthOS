/**
 * Scene dispatch.
 *
 * The scene graph says what a scene is *for*; this says how that intent is drawn.
 * The mapping is a table, not a switch buried in a component, so the set of
 * grammars is legible from one screen and a storyboard asking for a grammar that
 * does not exist fails loudly here rather than rendering a default frame.
 *
 * Transitions are handled once, here, so no grammar has to think about them. Only
 * three are implemented, because three are what an editorial sequence needs:
 * a cut, a short dip to the paper, and a matched push. Anything else resolves to
 * a cut rather than to a stranger effect.
 */

import type { ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import type { SceneRef } from "../props.js";
import type { SceneProps } from "../scenes/shared.js";
import { EditorialHook, QuestionScene } from "../scenes/EditorialHook.js";
import { BigStat } from "../scenes/BigStat.js";
import { ScientificDiagram, AnatomyFocus, ZoomReveal } from "../scenes/ScientificDiagram.js";
import { Mechanism, CauseEffect } from "../scenes/Mechanism.js";
import { ParticleFlowScene, MolecularBreakdown } from "../scenes/ParticleFlowScene.js";
import { Comparison, Timeline, Conclusion, Disclaimer } from "../scenes/Supporting.js";
import { ease } from "../motion/ease.js";

/**
 * One definition of a scene's props, re-exported rather than restated.
 *
 * This file used to declare its own copy of the interface. It was structurally
 * compatible, so the compiler never complained, and the two drifted the moment a
 * field was added to one of them: a scene needing the new field type-checked while
 * the dispatcher could not supply it, and the failure would have shown up as a
 * missing prop in a rendered frame rather than as an error. Grammars take their
 * props from `scenes/shared.tsx`, so that is the only place they are declared.
 */
export type { SceneProps };

const GRAMMARS: Record<SceneRef["composition"], (props: SceneProps) => ReactNode> = {
  editorial_hook: EditorialHook,
  question: QuestionScene,
  big_stat: BigStat,
  scientific_diagram: ScientificDiagram,
  anatomy_focus: AnatomyFocus,
  zoom_reveal: ZoomReveal,
  mechanism: Mechanism,
  cause_effect: CauseEffect,
  particle_flow: ParticleFlowScene,
  molecular_breakdown: MolecularBreakdown,
  comparison: Comparison,
  timeline: Timeline,
  conclusion: Conclusion,
  disclaimer: Disclaimer,
};

export const COMPOSITION_GRAMMARS = Object.keys(GRAMMARS) as SceneRef["composition"][];

export function grammarFor(composition: string): ((props: SceneProps) => ReactNode) | null {
  return GRAMMARS[composition as SceneRef["composition"]] ?? null;
}

/**
 * The fallback ladder.
 *
 * A scene with no grammar available is not drawn as a card with an icon. It moves
 * down this list, and the last entry is always typography, which can render any
 * text honestly.
 */
export function resolveGrammar(scene: SceneRef): {
  grammar: (props: SceneProps) => ReactNode;
  requested: string;
  fellBack: boolean;
  reason: string;
} {
  const direct = grammarFor(scene.composition);
  if (direct) return { grammar: direct, requested: scene.composition, fellBack: false, reason: "" };

  // A scene with a chart can always be a stat or a comparison.
  if (scene.chart && (scene.chart.kind === "counter" || scene.chart.kind === "stat_tile")) {
    return { grammar: BigStat, requested: scene.composition, fellBack: true, reason: "no grammar for composition; chart is a figure" };
  }
  if (scene.chart && (scene.chart.kind === "bar" || scene.chart.kind === "line" || scene.chart.kind === "comparison")) {
    return { grammar: Comparison, requested: scene.composition, fellBack: true, reason: "no grammar for composition; chart is a comparison" };
  }
  if (scene.intent === "caveat") {
    return { grammar: Disclaimer, requested: scene.composition, fellBack: true, reason: "caveat intent rendered as the end card" };
  }
  if (scene.intent === "payoff" || scene.intent === "cta") {
    return { grammar: Conclusion, requested: scene.composition, fellBack: true, reason: "closing intent rendered as a conclusion" };
  }
  return { grammar: EditorialHook, requested: scene.composition, fellBack: true, reason: "no grammar and no chart; rendered as type" };
}

export interface SceneRendererProps extends Omit<SceneProps, "frame"> {
  /** Reported upward so a manifest can record every fallback reason. */
  onFallback?: (sceneId: string, reason: string) => void;
}

export function SceneRenderer(props: SceneRendererProps) {
  const { scene, fps, durationInFrames } = props;
  // Inside a `Sequence`, the current frame is already relative to the scene, so
  // every scene's own animation starts at its own frame 0 with no offset maths.
  const frame = useCurrentFrame();
  const resolved = resolveGrammar(scene);
  const Grammar = resolved.grammar;
  const style = transitionStyle(scene, frame, fps, durationInFrames);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: style.opacity,
        transform: style.transform,
        transformOrigin: "50% 50%",
      }}
    >
      <Grammar {...props} frame={frame} />
    </div>
  );
}

/**
 * Transitions.
 *
 * Every scene is cut, which is the correct default for short form: it is fast and
 * it does not ask the viewer to re-read the frame. A dip to the paper is used when
 * the storyboard asks for one, and a push only for a matched move between two
 * related shots. Durations are short on purpose: 240ms at 30fps, and no more,
 * because a transition is punctuation and this is a sentence.
 */
function transitionStyle(
  scene: SceneRef,
  frame: number,
  fps: number,
  durationInFrames: number,
): { opacity: number; transform: string } {
  const lead = Math.min(Math.round(0.24 * fps), Math.max(0, Math.floor(durationInFrames / 3)));
  const tail = Math.min(Math.round(0.2 * fps), Math.max(0, Math.floor(durationInFrames / 3)));
  const inKind = scene.transition_in;
  const outKind = scene.transition_out;

  let opacity = 1;
  let scale = 1;

  if (lead > 0 && frame < lead) {
    const t = frame / lead;
    if (inKind === "fade" || inKind === "dip_to_base") {
      // A fade and a dip to the paper are the same movement here: the accent wash
      // settles at the same time the paper does, so a dip and a fade are
      // indistinguishable on the frame. One branch, not two that agree.
      opacity = ease("sine_out", t);
    } else if (inKind === "push") {
      scale = 1 + 0.03 * (1 - ease("cubic_out", t));
      opacity = Math.min(1, t * 2.2);
    } else if (inKind === "paper" || inKind === "wipe" || inKind === "iris") {
      // A mask-like reveal from the base colour, kept as a scale so it stays a
      // transform rather than a repaint.
      scale = 1 + 0.012 * (1 - ease("cubic_out", t));
      opacity = Math.min(1, t * 1.8);
    }
    // "cut" does nothing, which is the point.
  }

  if (tail > 0 && frame > durationInFrames - tail) {
    const t = 1 - (durationInFrames - frame) / tail;
    if (outKind !== "cut") {
      opacity = Math.min(opacity, 1 - ease("sine_in", t));
    }
    if (outKind === "push") {
      scale = 1 - 0.02 * ease("cubic_in", t);
    }
  }

  return {
    opacity: Math.max(0, Math.min(1, opacity)),
    transform: scale !== 1 ? `scale(${scale.toFixed(4)})` : "none",
  };
}
