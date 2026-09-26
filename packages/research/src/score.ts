import { clamp01 } from "@hc/core";
import type { Topic } from "@hc/schemas";

export interface ScoreWeights {
  novelty: number;
  visual: number;
  educational: number;
  shareability: number;
  evidence: number;
  trend: number;
  saturation: number;
  performance: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  novelty: 0.2,
  visual: 0.16,
  educational: 0.22,
  shareability: 0.14,
  evidence: 0.18,
  trend: 0.05,
  saturation: 0.03,
  performance: 0.02,
};

export interface ScoreContext {
  /** Recently produced titles, used to penalise near-duplicates. */
  recentTopics?: { slug: string; text: string }[];
  /** Learned adjustments keyed by category or format. */
  learnedAdjustments?: Record<string, number>;
  weights?: Partial<ScoreWeights>;
  /** Demand signal strength, 0..1. Never contributes evidence. */
  trendStrength?: number;
  evidenceStrength?: number;
  /** How many videos already exist for this topic. */
  saturation?: number;
}

const totalWeight = (weights: ScoreWeights): number =>
  weights.novelty +
  weights.visual +
  weights.educational +
  weights.shareability +
  weights.evidence +
  weights.trend +
  weights.saturation +
  weights.performance;

/**
 * Topic ranking.
 *
 * A viral claim is a *demand* signal only. It is worth at most `trend` in the
 * weighting, while evidence strength is worth `evidence` and can outweigh any
 * trend. Educational value carries the largest single weight because the studio
 * is judged on trust, not on reach.
 */
export function scoreTopic(topic: Topic, context: ScoreContext = {}): Topic {
  const weights: ScoreWeights = { ...DEFAULT_WEIGHTS, ...context.weights };
  const evidence = clamp01(context.evidenceStrength ?? evidenceStrength(topic));
  const trend = clamp01(context.trendStrength ?? topic.trend_strength);
  const novelty = clamp01(topic.novelty_score || computeNovelty(topic, context.recentTopics ?? []));
  const saturation = clamp01(context.saturation ?? 0);
  const performance = clamp01(averageOf(Object.values(topic.performance ?? {})));

  const learned = context.learnedAdjustments?.[topic.category] ?? 0;
  const weighted =
    weights.novelty * novelty +
    weights.visual * clamp01(topic.visual_score) +
    weights.educational * clamp01(topic.educational_score) +
    weights.shareability * clamp01(topic.shareability) +
    weights.evidence * evidence +
    weights.trend * trend +
    weights.saturation * (1 - saturation) +
    weights.performance * performance +
    learned;

  const priority = clamp01(weighted / totalWeight(weights));
  return {
    ...topic,
    novelty_score: round2(novelty),
    priority_score: round2(priority),
  };
}

export function evidenceStrength(topic: Topic): number {
  const order: string[] = [
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
  ];
  const index = order.indexOf(topic.evidence_level);
  if (index < 0) return 0.2;
  return index / (order.length - 1);
}

/**
 * Novelty against recently produced work. Exact repeats score 0; a topic that
 * shares only a category with recent work scores high.
 */
export function computeNovelty(topic: Topic, recent: { slug: string; text: string }[]): number {
  if (recent.length === 0) return 1;
  const own = tokenSet(topic.title, topic.question, ...topic.keywords);
  let worst = 0;
  for (const item of recent) {
    const other = tokenSet(item.text);
    worst = Math.max(worst, dice(own, other));
  }
  return clamp01(1 - worst);
}

function tokenSet(...parts: string[]): Set<string> {
  const out = new Set<string>();
  for (const part of parts) {
    for (const token of part.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
      if (token.length > 3) out.add(token);
    }
  }
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const token of a) if (b.has(token)) hits++;
  return (2 * hits) / (a.size + b.size);
}
function averageOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface RankedTopic {
  topic: Topic;
  score: number;
  reason: string;
}

/** Deterministic ranking: priority first, then a stable tie-break on slug. */
export function rankTopics(topics: Topic[], limit = 10): RankedTopic[] {
  return [...topics]
    .sort((a, b) => {
      const delta = b.priority_score - a.priority_score;
      if (Math.abs(delta) > 1e-9) return delta;
      return a.slug.localeCompare(b.slug);
    })
    .slice(0, limit)
    .map((topic) => ({
      topic,
      score: topic.priority_score,
      reason: `priority ${topic.priority_score.toFixed(2)} (evidence ${evidenceStrength(topic).toFixed(2)}, visual ${topic.visual_score.toFixed(2)}, novelty ${topic.novelty_score.toFixed(2)})`,
    }));
}
