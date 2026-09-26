import { estimateSpeechMs } from "@hc/core";
import type { Claim, Scene } from "@hc/schemas";
import type { ScriptDraft } from "@hc/script";
import { allocateScenes, round2, type TimeUnit } from "./timing.js";
import { planScene, sceneIntentFor } from "./policy.js";

export interface PlanScenesOptions {
  /** Runtime to fill. Defaults to the draft's own speech estimate. */
  total_s?: number;
  palette?: string;
  max_s?: number;
  /**
   * How long a line takes to say, in seconds.
   *
   * Defaults to the calibrated estimator. The TTS stage overrides it with
   * measured durations so scene windows and caption windows come from the same
   * source; when they disagree, the audio overruns the last shot and the
   * captions drift against the voice.
   */
  speechSeconds?: (text: string) => number;
}

/** Components are centred by default; the renderer resolves their intrinsic size. */
const COMPONENT_POSITION = { x: 0.5, y: 0.5, scale: 1, rotate: 0 } as const;

export interface ScenePlanResult {
  scenes: Scene[];
  overflow_s: number;
  warnings: string[];
}

/**
 * Turn a script into scenes.
 *
 * The hook and the closing lines are given their own scenes even though they
 * carry no claim, because pacing is set by the cuts: a viewer perceives a claim
 * as one idea only if the frame around it changes when the idea does.
 */
export function planScenes(
  draft: ScriptDraft,
  claims: Claim[],
  options: PlanScenesOptions = {},
): ScenePlanResult {
  const byClaimId = new Map(claims.map((c) => [c.claim_id, c]));
  const warnings: string[] = [];
  // A measured duration always wins. Without one, the writer's own estimate for
  // a beat is preferred over re-deriving it, so the plan agrees with the script.
  const seconds = (text: string, beatMs = 0): number => {
    if (options.speechSeconds) return options.speechSeconds(text);
    return beatMs > 0 ? beatMs / 1000 : speechSeconds(text);
  };

  type Slot = {
    id: string;
    speech_s: number;
    claim?: Claim;
    intent: ReturnType<typeof sceneIntentFor>;
    kind: "hook" | "beat" | "caveat" | "cta" | "disclaimer";
  };

  const slots: Slot[] = [];
  const hookText = draft.hook.trim();
  if (hookText) {
    slots.push({ id: "sc_hook", speech_s: seconds(hookText), intent: "hook", kind: "hook" });
  }
  for (const [i, beat] of draft.beats.entries()) {
    const claim = byClaimId.get(beat.claim_id);
    if (!claim) {
      // A beat whose claim is missing cannot be visualised, and inventing a
      // visual for it would be inventing a claim. Drop the beat loudly.
      warnings.push(
        `Beat ${beat.beat_id} references claim ${beat.claim_id}, which is not in the reviewed claim set; the beat was dropped from the storyboard.`,
      );
      continue;
    }
    slots.push({
      id: `sc_${String(i + 1).padStart(2, "0")}_${beat.beat_id}`,
      speech_s: seconds(beat.narration, beat.estimated_ms),
      claim,
      intent: sceneIntentFor(beat.intent),
      kind: "beat",
    });
  }
  const ctaText = draft.cta.trim();
  if (ctaText) {
    slots.push({ id: "sc_cta", speech_s: seconds(ctaText), intent: "cta", kind: "cta" });
  }
  const disclaimerText = draft.disclaimer.trim();
  if (disclaimerText) {
    slots.push({ id: "sc_disclaimer", speech_s: seconds(disclaimerText), intent: "caveat", kind: "disclaimer" });
  }

  // The runtime to fill is the script's target, not its speech estimate. The
  // estimate covers speech alone, so budgeting against it would leave no room
  // for the pauses that make a cut readable and would report overflow on a
  // script that in fact fits comfortably.
  const total = options.total_s ?? draft.target_ms / 1000;
  const units: TimeUnit[] = slots.map((s) => ({ id: s.id, speech_s: s.speech_s }));
  const windows = allocateScenes(units, {
    total_s: round2(total),
    ...(options.max_s ? { max_s: options.max_s } : {}),
  });

  const scenes: Scene[] = [];
  for (const [index, slot] of slots.entries()) {
    const win = windows[index];
    if (!win) continue;
    const plan = planScene(slot.claim, slot.intent, draft.format);
    // A scene that exists only to hold a caveat should not repeat the claim's
    // type on screen; the caveat is the message.
    const narration = narrationFor(slot, draft);
    const scene: Scene = {
      scene_id: slot.id,
      index,
      start: win.start,
      end: win.end,
      intent: plan.intent,
      visual_strategy: plan.visual_strategy,
      layout: plan.layout,
      palette: options.palette ?? plan.palette,
      narration,
      on_screen_text: plan.on_screen_text,
      subtext: plan.subtext,
      claim_ids: slot.claim ? [slot.claim.claim_id] : [],
      components: plan.components.map((c) => ({ ...c, position: COMPONENT_POSITION })),
      assets: [],
      layers: [],
      ...(plan.chart ? { chart: plan.chart } : {}),
      animations: animationsFor(slot.intent, plan.visual_strategy),
      camera: cameraFor(plan.visual_strategy),
      transition_in: index === 0 ? "fade" : transitionFor(slot.intent),
      transition_out: index === slots.length - 1 ? "fade" : "cut",
      sfx: sfxFor(slot.intent),
      // The disclaimer and the CTA are read, not watched: burning captions over
      // them competes with the text the viewer is meant to absorb.
      captions: slot.kind !== "disclaimer" && slot.kind !== "cta",
      notes: plan.rationale,
    };
    scenes.push(scene);
  }

  const worstOverflow = Math.max(0, ...windows.map((w) => w.overflow_s));
  if (worstOverflow > 0.05) {
    warnings.push(
      `Narration needs about ${round2(worstOverflow)}s more than the ${round2(total)}s runtime allows. Scenes will be compressed below a comfortable read; shorten the script or raise the target.`,
    );
  }

  return { scenes, overflow_s: round2(Math.max(0, ...windows.map((w) => w.overflow_s))), warnings };
}

function narrationFor(slot: { kind: string; claim?: Claim }, draft: ScriptDraft): string {  switch (slot.kind) {
    case "hook":
      return draft.hook;
    case "cta":
      return draft.cta;
    case "disclaimer":
      return draft.disclaimer;
    default: {
      const beat = draft.beats.find((b) => b.claim_id === slot.claim?.claim_id);
      return beat?.narration ?? slot.claim?.text ?? "";
    }
  }
}

function speechSeconds(text: string): number {
  return round2(estimateSpeechMs(text) / 1000);
}

function animationsFor(intent: string, strategy: string): Scene["animations"] {
  if (intent === "hook") return ["stagger_in", "scale_in"];
  if (intent === "cta") return ["fade", "slide_up"];
  if (strategy === "chart_led" || strategy === "data_mosaic") return ["wipe", "count_up", "label_pop"];
  if (strategy === "timeline_track") return ["path_trace", "draw"];
  if (strategy === "system_map") return ["particle_flow", "draw"];
  if (strategy === "comparison_split") return ["slide_left", "slide_right"];
  if (intent === "caveat") return ["fade", "underline_sweep"];
  return ["fade", "slide_up", "pulse"];
}

function cameraFor(strategy: string): Scene["camera"] {
  if (strategy === "system_map") return { push: 0.12, pull: 0, panX: 0, panY: 0, rotate: 0, depth: 0.6, easing: "sine_in_out" };
  if (strategy === "chart_led") return { push: 0.06, pull: 0, panX: 0, panY: 0, rotate: 0, depth: 0.2, easing: "sine_in_out" };
  if (strategy === "diagram_led") return { push: 0.1, pull: 0, panX: 0.05, panY: 0, rotate: 0, depth: 0.4, easing: "sine_in_out" };
  return { push: 0, pull: 0, panX: 0, panY: 0, rotate: 0, depth: 0, easing: "sine_in_out" };
}

function transitionFor(intent: string): Scene["transition_in"] {
  if (intent === "myth_reveal") return "dip_to_base";
  if (intent === "data_beat" || intent === "evidence") return "wipe";
  if (intent === "comparison") return "slide";
  return "fade";
}

function sfxFor(intent: string): Scene["sfx"] {
  if (intent === "hook") return ["whoosh_soft"];
  if (intent === "myth_reveal") return ["whoosh_reveal", "impact_soft"];
  if (intent === "data_beat") return ["tick", "pop"];
  if (intent === "payoff" || intent === "cta") return ["rise", "success_chime"];
  return [];
}


