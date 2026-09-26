import { HealthOSError, deterministicId, nowIso } from "@hc/core";
import type { DiscoveredTopic, EvidenceLevelType, Topic } from "@hc/schemas";
import { parse, TopicSchema, type Claim, type Source } from "@hc/schemas";
import { KB_TOPICS, KB_TOPIC_BY_ID, KB_TOPIC_BY_SLUG } from "./knowledge/corpus.js";
import { kbSource, type KbClaim, type KbTopic } from "./knowledge/references.js";
import { EuropePmcProvider } from "./providers/europepmc.js";
import { RssTrendProvider } from "./providers/rss.js";
import type { LiteratureHit, ResearchProvider } from "./providers/types.js";
import { normaliseTitle, topicToSearchText } from "./normalise.js";
import { scoreTopic } from "./score.js";

export interface DiscoveryOptions {
  limit?: number;
  categories?: string[];
  includeNetwork?: boolean;
  includeSeed?: boolean;
  seed?: number;
}

export interface DiscoveryResult {
  topics: Topic[];
  providers: { name: string; used: boolean; reason: string; candidates: number }[];
  warnings: string[];
}

/**
 * Topic discovery.
 *
 * Two strictly separated inputs:
 *   1. the curated knowledge base (evidence-led, offline, deterministic)
 *   2. demand signals from RSS / literature indexing (trend-led, optional)
 *
 * A demand signal may raise a topic's priority. It can never change a claim's
 * evidence level, and the stored `origin` records where the idea came from so
 * the distinction survives into the database.
 */
export async function discoverTopics(options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const limit = options.limit ?? 24;
  const warnings: string[] = [];
  const providers: DiscoveryResult["providers"] = [];
  const collected = new Map<string, DiscoveredTopic>();

  if (options.includeSeed !== false) {
    for (const topic of KB_TOPICS) {
      if (options.categories && options.categories.length > 0 && !options.categories.includes(topic.category)) {
        continue;
      }
      collected.set(topic.slug, {
        title: topic.title,
        question: topic.question,
        category: topic.category,
        suggested_format: topic.format,
        origin: "knowledge_base",
        origin_ref: topic.id,
        keywords: topic.keywords,
      });
    }
    providers.push({
      name: "knowledge_base",
      used: collected.size > 0,
      reason: `${collected.size} reviewed topics with citable sources`,
      candidates: collected.size,
    });
  }

  if (options.includeNetwork) {
    const networkProviders: ResearchProvider[] = [new RssTrendProvider(), new EuropePmcProvider()];
    for (const provider of networkProviders) {
      if (!provider.isConfigured()) {
        providers.push({
          name: provider.name,
          used: false,
          reason: "not configured; skipped without failing the run",
          candidates: 0,
        });
        continue;
      }
      try {
        const candidates = await provider.discover({ limit, categories: options.categories ?? [], seed: options.seed ?? 0 });
        for (const candidate of candidates) {
          const slug = normaliseTitle(candidate.topic.title);
          const existing = collected.get(slug);
          if (existing) {
            // A demand signal on an already-reviewed topic: keep the reviewed
            // record and remember the signal instead of creating a duplicate.
            existing.keywords = Array.from(new Set([...existing.keywords, ...candidate.topic.keywords])).slice(0, 20);
            continue;
          }
          collected.set(slug, candidate.topic);
          for (const warning of candidate.warnings) warnings.push(`${provider.name}: ${warning}`);
        }
        providers.push({ name: provider.name, used: true, reason: "live query", candidates: candidates.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        providers.push({
          name: provider.name,
          used: false,
          reason: `failed: ${message.slice(0, 160)}`,
          candidates: 0,
        });
        warnings.push(`Provider ${provider.name} unavailable: ${message.slice(0, 160)}`);
      }
    }
  } else {
    providers.push({ name: "network", used: false, reason: "includeNetwork=false (offline/deterministic run)", candidates: 0 });
  }

  const now = nowIso();
  const topics: Topic[] = Array.from(collected.entries())
    .slice(0, limit)
    .map(([slug, candidate]) => {
      const kb = KB_TOPIC_BY_SLUG.get(slug);
      const topic: Topic = {
        topic_id: deterministicId("top", slug),
        slug,
        title: candidate.title,
        question: candidate.question,
        category: candidate.category,
        suggested_format: candidate.suggested_format,
        origin: candidate.origin,
        origin_ref: candidate.origin_ref,
        trend_strength: 0,
        evidence_level: kb ? levelOf(kb.id) : "unrated",
        novelty_score: 0,
        visual_score: kb?.visual_score ?? 0.5,
        educational_score: kb?.educational_score ?? 0.5,
        shareability: kb?.shareability ?? 0.5,
        priority_score: 0,
        status: "DISCOVERED",
        keywords: candidate.keywords,
        source_ids: [],
        generated_videos: [],
        performance: {},
        discovered_at: now,
        updated_at: now,
        trend_signal: kb ? undefined : `Surfaced by ${candidate.origin} (demand signal only)`,
      };
      return parse(TopicSchema, topic, "discovered topic");
    });

  return { topics: topics.map((topic) => scoreTopic(topic)), providers, warnings };
}

function levelOf(kbId: string): EvidenceLevelType {
  const topic = KB_TOPIC_BY_ID.get(kbId);
  if (!topic) return "unrated";
  let best: EvidenceLevelType = "unrated";
  const order: EvidenceLevelType[] = [
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
  for (const claim of topic.claims) {
    if (order.indexOf(claim.level) > order.indexOf(best)) best = claim.level;
  }
  return best;
}

export interface ResearchTopicInput {
  topic: Topic;
  /** Resolve network literature. When false, only the curated KB is used. */
  allowNetwork?: boolean;
  /** Publication year floor for literature enrichment. */
  since?: string;
}

export interface ResearchTopicResult {
  topic: Topic;
  sources: Source[];
  claims: Claim[];
  literature: LiteratureHit[];
  warnings: string[];
}

/**
 * Research a topic: resolve its evidence.
 *
 * For knowledge-base topics this returns the reviewed claim set plus its
 * citations. When the network is available the same claims are corroborated
 * against live literature so the in-video source list can include recent
 * primary research. A claim is never added without a citation.
 */
export async function researchTopic(input: ResearchTopicInput): Promise<ResearchTopicResult> {
  const { topic } = input;
  const warnings: string[] = [];
  const sources: Source[] = [];
  const now = nowIso();

  const kb = KB_TOPIC_BY_SLUG.get(topic.slug) ?? KB_TOPIC_BY_ID.get(topic.origin_ref ?? "");
  if (!kb) {
    throw new HealthOSError(`Topic "${topic.slug}" is not in the reviewed knowledge base`, {
      category: "INVALID_HEALTH_CLAIM",
      remediation:
        "Add a reviewed entry to packages/research/src/knowledge/corpus.ts, or research an existing topic.",
    });
  }

  const literature: import("./providers/types.js").LiteratureHit[] = [];
  const provider = new EuropePmcProvider();
  if (input.allowNetwork && provider.isConfigured()) {
    try {
      const hits = await provider.search({
        text: kb.keywords.slice(0, 4).join(" AND "),
        limit: 4,
        since: input.since ?? `${new Date().getUTCFullYear() - 8}-01-01`,
      });
      literature.push(...hits);
    } catch (error) {
      warnings.push(
        `Literature corroboration unavailable (${error instanceof Error ? error.message : String(error)}); continuing with the reviewed knowledge base.`,
      );
    }
  }

  // 1. Curated citations for every claim.
  const claimKeys = new Set<string>();
  for (const claim of kb.claims) {
    for (const key of claim.sources) claimKeys.add(key);
  }
  for (const key of claimKeys) {
    const citation = kbSource(key);
    const sourceId = deterministicId("src", citation.publisher, citation.doi ?? citation.url);
    sources.push({
      source_id: sourceId,
      title: citation.title,
      url: citation.url,
      publisher: citation.publisher,
      publication_date: citation.year ? String(citation.year) : "",
      accessed_at: now,
      source_type: citation.type === "reference_site" ? "reference_site" : citation.type,
      evidence_level: citation.level,
      ...(citation.design ? { study_design: citation.design as Source["study_design"] } : {}),
      ...(citation.doi ? { doi: citation.doi } : {}),
      relevance: `Cited for the ${kb.slug} claim set.`,
      summary: citation.short,
      verified: false,
      conflicting: false,
      verification_notes: [],
    });
  }

  // 2. Primary literature, when reachable, as additional context sources.
  for (const hit of literature) {
    const sourceId = deterministicId("src", hit.publisher, hit.doi ?? hit.pmid ?? hit.identifier);
    if (sources.some((s) => s.source_id === sourceId)) continue;
    sources.push({
      source_id: sourceId,
      title: hit.title,
      url: hit.url,
      publisher: hit.publisher,
      ...(hit.publication_date ? { publication_date: hit.publication_date } : {}),
      accessed_at: now,
      source_type: hit.source_type,
      evidence_level: hit.evidence_level,
      ...(hit.study_design ? { study_design: hit.study_design as Source["study_design"] } : {}),
      ...(hit.doi ? { doi: hit.doi } : {}),
      ...(hit.pmid ? { pmid: hit.pmid } : {}),
      ...(hit.authors.length > 0 ? { authors: hit.authors } : {}),
      relevance: `Corroborating literature for "${kb.slug}".`,
      summary: hit.abstract.slice(0, 600),
      verified: false,
      conflicting: false,
      verification_notes: [],
    });
  }

  const claims = buildClaims(kb, sources, warnings);

  const strongest = claims.reduce<EvidenceLevelType>((acc, claim) => {
    return rank(claim.evidence_level) > rank(acc) ? claim.evidence_level : acc;
  }, "unrated");

  const validated: Topic = {
    ...topic,
    evidence_level: strongest,
    source_ids: sources.map((s) => s.source_id),
    status: "VALIDATED",
    updated_at: now,
    evidence: {
      evidence_level: strongest,
      sources: sources.map((s) => s.source_id),
      summary: `${claims.length} reviewed claims for "${kb.question}"`,
      conflicts: [],
      authority_guidance: sources.some((s) => s.evidence_level === "guideline" || s.evidence_level === "government_health_authority"),
      citation_lines: kb.source_card,
    },
    notes: topic.notes,
  };

  return { topic: validated, sources, claims, literature, warnings };
}

const LEVEL_ORDER: EvidenceLevelType[] = [
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

function rank(level: EvidenceLevelType): number {
  return LEVEL_ORDER.indexOf(level);
}

function buildClaims(kb: KbTopic, sources: Source[], warnings: string[]): Claim[] {
  const byKey = new Map<string, Source>();
  for (const claim of kb.claims) {
    for (const key of claim.sources) {
      const citation = kbSource(key);
      byKey.set(
        key,
        sources.find((s) => s.url === citation.url) ?? {
          source_id: deterministicId("src", citation.publisher, citation.doi ?? citation.url),
          title: citation.title,
          url: citation.url,
          publisher: citation.publisher,
          accessed_at: nowIso(),
          source_type: citation.type,
          evidence_level: citation.level,
          relevance: "",
          summary: citation.short,
          verified: false,
          conflicting: false,
          verification_notes: [],
        },
      );
    }
  }

  return kb.claims.map((claim): Claim => {
    const support = claim.sources.map((key) => byKey.get(key)?.source_id).filter((id): id is string => Boolean(id));
    if (support.length === 0) {
      warnings.push(`Claim ${claim.id} has no resolvable citation and was dropped.`);
    }
    const claimType = inferClaimType(claim);
    return {
      claim_id: claim.id,
      text: claim.text,
      normalised_text: claim.text.toLowerCase(),
      claim_type: claimType,
      evidence_level: claim.level,
      confidence: confidenceFor(claim.level, support.length),
      support,
      conflicting: [],
      hedge_required: hedgeRequiredFor(claimType, claim.level),
      permitted_phrasing: claim.permitted,
      forbidden_phrasing: claim.forbidden,
      figures: claim.numbers.map((n) => figureFromClaim(n)).filter((f): f is NonNullable<typeof f> => f !== null),
      caveat: claim.caveat ?? "",
      visual_hints: claim.components,
      visual_strategy_hint: claim.visual ?? null,
      risk_flags: [],
      status: support.length > 0 ? "supported" : "rejected",
    };
  });
}

function inferClaimType(claim: KbClaim): Claim["claim_type"] {
  const text = claim.text.toLowerCase();
  if (/\bbecause\b|\btrigger|\bcaus|\bstart|\bblocks?\b|\babsorb/.test(text)) return "mechanism";
  if (claim.numbers.length > 0) return "quantity";
  if (/associat|linked|related/.test(text)) return "association";
  if (/recommend|advis/.test(text)) return "efficacy";
  if (/common|usually|most people|for most/.test(text)) return "quantity";
  return "mechanism";
}

/**
 * Whether the narrator must soften this claim.
 *
 * Hedging is a property of the claim's *kind*, not merely of its evidence level.
 * "Pepsin cuts protein chains into smaller peptides in the stomach" is textbook
 * physiology: forcing it into "pepsin may cut protein into peptides" makes the
 * video sound evasive while protecting nothing. A claim about what will happen to
 * the viewer is the opposite case, and there an observational design genuinely
 * cannot support a flat assertion, so hedging is mandatory.
 */
/**
 * A reviewed figure has to survive as a number, not as a string, or the
 * storyboard stage cannot build a counter or a bar chart from it. A figure that
 * is not numeric ("5-6 hours", "two thirds") is kept out of the structured list
 * rather than guessed at; the narration still carries it as prose.
 */
function figureFromClaim(n: KbClaim["numbers"][number]): Claim["figures"][number] | null {
  // Only a single exact number may become a structured figure. Ranges ("20-45")
  // and open bounds ("7+") are the reason this check exists: Number.parseFloat
  // would quietly turn "20-45" into 20 and "7+" into 7, and a counter showing
  // "20 minutes" for a claim that says "20 to 45" understates the reviewed
  // evidence. Better to leave the range as prose, where the wording survives.
  const cleaned = n.value.replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  return { value, display: n.value, unit: n.unit, per: "", label: "", about: n.about };
}

function hedgeRequiredFor(claimType: Claim["claim_type"], level: EvidenceLevelType): boolean {
  const effectTypes: Claim["claim_type"][] = ["efficacy", "causation", "association", "safety", "quantity"];
  if (!effectTypes.includes(claimType)) return false;
  return rank(level) < rank("cohort");
}

function confidenceFor(level: EvidenceLevelType, supportCount: number): number {
  const base = rank(level) / (LEVEL_ORDER.length - 1);
  const supportBonus = Math.min(0.15, supportCount * 0.05);
  return Math.round(Math.min(0.98, 0.25 + base * 0.6 + supportBonus) * 100) / 100;
}

export { topicToSearchText };

