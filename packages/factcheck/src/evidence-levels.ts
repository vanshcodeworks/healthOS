import type { EvidenceLevelType } from "@hc/schemas";

/**
 * Evidence ladder, weakest to strongest.
 *
 * The order is the single authority for how strongly a claim may be phrased.
 * Nothing else in the system is allowed to invent an evidence level.
 */
export const EVIDENCE_ORDER: readonly EvidenceLevelType[] = Object.freeze([
  "unrated",
  "testimonial",
  "expert_opinion",
  "preclinical",
  "mechanistic_study",
  "narrative_review",
  "case_control",
  "cross_sectional",
  "cohort",
  "guideline",
  "government_health_authority",
  "rct",
  "systematic_review",
  "meta_analysis",
]);

const INDEX = new Map(EVIDENCE_ORDER.map((level, i) => [level, i]));

export function evidenceRank(level: EvidenceLevelType): number {
  return INDEX.get(level) ?? 0;
}

export function strongestOf(levels: readonly EvidenceLevelType[]): EvidenceLevelType {
  let best: EvidenceLevelType = "unrated";
  for (const level of levels) {
    if (evidenceRank(level) > evidenceRank(best)) best = level;
  }
  return best;
}

/**
 * Designations that a study must reach before the narrator may use the strongest
 * verbs. Anything observational must be spoken as an association, because saying
 * "causes" about a cohort study is a factual error regardless of how true the
 * underlying relationship is.
 */
export const CAUSAL_DESIGN: readonly EvidenceLevelType[] = Object.freeze([
  "rct",
  "systematic_review",
  "meta_analysis",
]);

/**
 * Mechanism claims are a different question from effect claims.
 *
 * "A nerve signal triggers calcium release inside the fibre" describes an
 * established physiological process. Rejecting it for lacking an RCT would be
 * wrong in the same way that rejecting "caffeine causes anxiety" for lacking an
 * RCT is right: the first is textbook physiology, the second is a health effect
 * with real-world consequences. So a mechanism may speak causally once the
 * evidence reaches a reviewed physiological source, while an effect may not
 * speak causally until it reaches a design that can support causality.
 */
export const MECHANISM_CAUSAL_FLOOR: EvidenceLevelType = "narrative_review";

/** Claim types whose causal verbs describe a health *effect* on the viewer. */
export const EFFECT_CLAIM_TYPES: readonly string[] = Object.freeze([
  "efficacy",
  "causation",
  "safety",
  "quantity",
  "association",
  "myth",
  "timeline",
]);

/**
 * Levels at which a number may be stated as a fact rather than as an estimate.
 * Below `guideline`, any quantity needs an explicit approximation.
 */
export const PRECISE_QUANTITY_FLOOR: EvidenceLevelType = "guideline";
