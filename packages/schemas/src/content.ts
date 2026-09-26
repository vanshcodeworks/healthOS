import { z } from "zod";
import {
  Category,
  EvidenceLevel,
  Format,
  HookType,
  IsoDateTime,
  StudyDesign,
  SourceType,
  TopicStatus,
} from "./primitives.js";

/**
 * A retrieved source. Every claim in a video must be traceable to at least
 * one Source. `identifier` is the provider-native id (PMID, DOI, feed guid)
 * and is what makes deduplication exact rather than heuristic.
 */
export const SourceSchema = z
  .object({
    source_id: z.string().min(3),
    title: z.string().min(3).max(400),
    url: z.string().url().refine((u) => u.startsWith("https://"), "sources must be https"),
    publisher: z.string().min(1).max(120),
    authors: z.array(z.string().max(160)).max(40).optional(),
    publication_date: z.string().max(40).optional(),
    accessed_at: IsoDateTime,
    source_type: SourceType,
    evidence_level: EvidenceLevel,
    study_design: StudyDesign.optional(),
    sample_size: z.number().int().nonnegative().optional(),
    doi: z.string().max(120).optional(),
    pmid: z.string().max(40).optional(),
    identifier: z.string().max(200).optional(),
    relevance: z.string().max(2000).default(""),
    summary: z.string().max(6000).default(""),
    verified: z.boolean().default(false),
    conflicting: z.boolean().default(false),
    verification_notes: z.array(z.string().max(600)).max(20).default([]),
  })
  .strict();

export type Source = z.infer<typeof SourceSchema>;

/**
 * A single substantive health claim.
 *
 * `evidence_level` and `hedge_required` are derived, not authored: the
 * fact-check stage fills them from the supporting sources so that a script
 * writer physically cannot assert more than the evidence supports.
 */
export const ClaimSchema = z
  .object({
    claim_id: z.string().min(3),
    text: z.string().min(3).max(600),
    normalised_text: z.string().min(1).max(600),
    claim_type: z
      .enum(["mechanism", "quantity", "causation", "association", "efficacy", "safety", "myth", "timeline"])
      .default("mechanism"),
    evidence_level: EvidenceLevel.default("unrated"),
    confidence: z.number().min(0).max(1).default(0),
    support: z.array(z.string().min(3)).max(20).default([]),
    conflicting: z.array(z.string().min(3)).max(20).default([]),
    hedge_required: z.boolean().default(false),
    /** Language the claim permits, e.g. "is associated with", "can increase". */
    permitted_phrasing: z.array(z.string().max(120)).max(12).default([]),
    forbidden_phrasing: z.array(z.string().max(120)).max(12).default([]),
    /**
     * The figures a reviewer approved for this claim.
     *
     * These exist so that anything numeric on screen traces back to a reviewed
     * number rather than to a regex over prose. A chart, a counter or a
     * big-number card must be buildable from the claim alone, otherwise the
     * storyboard stage has to guess and a guess is an unsourced number.
     */
    figures: z
      .array(
        z
          .object({
            value: z.number(),
            /** Pre-formatted string for display, e.g. "about 95 mg". */
            display: z.string().max(40).default(""),
            unit: z.string().max(40).default(""),
            /** The basis of the figure, e.g. "per 240 ml cup". */
            per: z.string().max(60).default(""),
            label: z.string().max(80).default(""),
            /** True when the figure is an approximation rather than exact. */
            about: z.boolean().default(true),
          })
          .strict(),
      )
      .max(12)
      .default([]),
    /** A qualification a reviewer attached; the storyboard must surface it. */
    caveat: z.string().max(300).default(""),
    /** Component names the reviewer considered apt, from the closed union. */
    visual_hints: z.array(z.string().max(40)).max(8).default([]),
    visual_strategy_hint: z
      .enum(["diagram", "chart", "counter", "comparison", "flow", "photographic"])
      .nullable()
      .default(null),
    risk_flags: z
      .array(
        z.enum([
          "medical_advice",
          "self_treatment",
          "diagnostic_claim",
          "guaranteed_outcome",
          "dosage_prescription",
          "pharmaceutical_claim",
          "unverifiable_number",
          "absolute_language",
        ]),
      )
      .max(12)
      .default([]),
    status: z.enum(["draft", "supported", "weak", "conflicted", "rejected"]).default("draft"),
  })
  .strict();

export type Claim = z.infer<typeof ClaimSchema>;

export const EvidenceBundleSchema = z
  .object({
    evidence_level: EvidenceLevel,
    sources: z.array(z.string().min(3)).min(1, "a validated topic needs at least one source"),
    summary: z.string().default(""),
    conflicts: z.array(z.string()).default([]),
    /** True when a reputable guideline or authority directly addresses the topic. */
    authority_guidance: z.boolean().default(false),
    /** Human-readable lines rendered on the in-video source card. */
    citation_lines: z.array(z.string().max(200)).max(6).default([]),
  })
  .strict();

export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

export const TopicSchema = z
  .object({
    topic_id: z.string().min(3),
    slug: z.string().min(1).max(120),
    title: z.string().min(3).max(200),
    question: z.string().min(3).max(300),
    category: Category,
    suggested_format: Format,
    origin: z.string().min(1).max(80),
    origin_ref: z.string().max(500).optional(),
    /** A viral claim is a demand signal, never evidence. */
    trend_signal: z.string().max(500).optional(),
    trend_strength: z.number().min(0).max(1).default(0),
    evidence_level: EvidenceLevel.default("unrated"),
    novelty_score: z.number().min(0).max(1).default(0),
    visual_score: z.number().min(0).max(1).default(0),
    educational_score: z.number().min(0).max(1).default(0),
    shareability: z.number().min(0).max(1).default(0),
    priority_score: z.number().min(0).max(1).default(0),
    status: TopicStatus.default("DISCOVERED"),
    keywords: z.array(z.string().max(60)).max(30).default([]),
    evidence: EvidenceBundleSchema.optional(),
    source_ids: z.array(z.string()).max(50).default([]),
    generated_videos: z.array(z.string()).max(50).default([]),
    performance: z.record(z.string(), z.number()).default({}),
    notes: z.string().max(2000).optional(),
    discovered_at: IsoDateTime,
    updated_at: IsoDateTime,
    rejected_reason: z.string().max(500).optional(),
  })
  .strict();

export type Topic = z.infer<typeof TopicSchema>;

/** Output of the research stage: topic plus its evidence and source registry. */
export const ResearchResultSchema = z
  .object({
    topic: TopicSchema,
    sources: z.array(SourceSchema),
    claims: z.array(ClaimSchema),
    /** Topics that were considered and rejected, with reasons. */
    rejected: z
      .array(z.object({ topic_id: z.string(), reason: z.string(), detail: z.string().default("") }))
      .default([]),
    warnings: z.array(z.string()).default([]),
  })
  .strict();

export type ResearchResult = z.infer<typeof ResearchResultSchema>;

export const ScriptWordSchema = z
  .object({
    text: z.string().min(1).max(120),
    /** Scene the word belongs to; drives caption grouping. */
    scene_id: z.string().max(40),
    kind: z.enum(["hook", "body", "cta"]).default("body"),
  })
  .strict();

export const ScriptSchema = z
  .object({
    script_id: z.string().min(3),
    video_id: z.string().min(3),
    version: z.number().int().positive().default(1),
    hook: z.string().min(4).max(300),
    hook_type: HookType.default("question"),
    body: z.string().min(20).max(4000),
    cta: z.string().max(300).default(""),
    words: z.array(ScriptWordSchema).max(400),
    word_count: z.number().int().nonnegative(),
    estimated_ms: z.number().int().nonnegative(),
    content_hash: z.string().length(64),
    /** Banned patterns (fabricated stats, clickbait, guarantees) that the writer must not emit. */
    compliance: z
      .object({
        hedges_used: z.array(z.string()).default([]),
        claims_spoken: z.array(z.string()).default([]),
        disclaimer: z.string().default(""),
      })
      .default({ hedges_used: [], claims_spoken: [], disclaimer: "" }),
  })
  .strict();

export type Script = z.infer<typeof ScriptSchema>;

export const ContentFormat = Format;

