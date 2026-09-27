/**
 * Style families.
 *
 * A video's family is a fixed set of motion parameters, chosen by the planner and
 * recorded in the project. The reason it exists is that uncontrolled variety
 * looks random: if every video picks its own easing, its own durations and its own
 * camera rates, two videos in the same feed read as two different studios.
 *
 * So variation is *between* families and consistency is *within* one. A family
 * fixes the pacing personality, and a second run of the same topic reuses it, so
 * the channel has a recognisable rhythm.
 *
 * The names describe a register, not a template. `anatomical` is slower and
 * quieter; `energetic` is not a different set of components, it is the same
 * components arriving sooner.
 */

import type { MotionProfile } from "../motion/ease.js";

const BY_TOPIC: { match: RegExp; profile: MotionProfile }[] = [
  { match: /myth|debunk|does it|can you|tell your/i, profile: "curious" },
  { match: /data|study|trial|research|evidence|statistic/i, profile: "clinical" },
  { match: /anatom|muscle|bone|nerve|heart|brain|lung/i, profile: "scientific" },
  { match: /sleep|calm|breath|recover/i, profile: "calm" },
  { match: /molecul|vitamin|supplement|nutrient|caffeine|metabol/i, profile: "editorial" },
  { match: /risk|danger|avoid|harm|disease/i, profile: "dramatic" },
];

const BY_CATEGORY: Record<string, MotionProfile> = {
  myth: "curious",
  data: "clinical",
  anatomy: "scientific",
  mechanism: "scientific",
  nutrition: "editorial",
  comparison: "clinical",
  timeline: "editorial",
  sleep: "calm",
  fitness: "energetic",
  supplement: "editorial",
  "system-journey": "editorial",
};

/** A deterministic family for a topic, with an explicit author override. */
export function motionProfileFor(topic: string, category?: string, override?: string): MotionProfile {
  if (override && override in BY_CATEGORY) return override as MotionProfile;
  for (const rule of BY_TOPIC) {
    if (rule.match.test(topic)) return rule.profile;
  }
  if (category && category in BY_CATEGORY) return BY_CATEGORY[category]!;
  return "editorial";
}

export const STYLE_FAMILIES = Object.keys(BY_CATEGORY);
