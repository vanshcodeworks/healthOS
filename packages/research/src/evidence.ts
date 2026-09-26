import type { EvidenceLevelType } from "@hc/schemas";

/**
 * Europe PMC reports `research-article` for the majority of records, which
 * carries no design information. Recovering the design from the abstract is a
 * heuristic, so it is applied only when the indexed publication type is
 * genuinely generic, and the resulting level never exceeds what the wording of
 * the abstract supports.
 */
const TEXT_DESIGN: { match: RegExp; design: string; level: EvidenceLevelType }[] = [
  { match: /\bmeta[- ]analys(is|es)\b/i, design: "meta-analysis", level: "meta_analysis" },
  { match: /\bsystematic review\b/i, design: "systematic review", level: "systematic_review" },
  {
    match: /\b(randomi[sz]ed|randomised|placebo[- ]controlled|double[- ]blind|cross[- ]over trial|clinical trial)\b/i,
    design: "randomized controlled trial",
    level: "rct",
  },
  { match: /\b(prospective )?cohort\b/i, design: "cohort", level: "cohort" },
  { match: /\bcross[- ]sectional\b/i, design: "cross-sectional", level: "cross_sectional" },
  { match: /\bcase[- ]control\b/i, design: "case-control", level: "case_control" },
  { match: /\b(in vitro|cell culture|molecular|mechanistic|study in animals?)\b/i, design: "mechanistic study", level: "mechanistic_study" },
  { match: /\b(mice|murine|rats?|rodents?|zebrafish)\b/i, design: "animal study", level: "preclinical" },
  { match: /\b(narrative review|this review|we review|scoping review)\b/i, design: "review", level: "narrative_review" },
];

/** Publication types that carry no usable design information. */
const GENERIC_DESIGN = /^(research-article|journal article|article|review-article|other)$/i;

export function inferDesignFromText(text: string): { design: string; level: EvidenceLevelType } | null {
  for (const candidate of TEXT_DESIGN) {
    if (candidate.match.test(text)) return { design: candidate.design, level: candidate.level };
  }
  return null;
}

/**
 * Map a publication type to an evidence level.
 *
 * The mapping is deliberately conservative: an unknown publication type never
 * earns more than a narrative review, because the script writer's permitted
 * language is derived from this value.
 */
export function mapDesignToEvidence(
  design: string | undefined,
  source: string | undefined,
  abstract?: string,
): EvidenceLevelType {
  const src = (source ?? "").toLowerCase();
  const isPreprint = src.includes("preprint") || src.includes("biorxiv") || src.includes("medrxiv");

  if (isPreprint) {
    const declared = mapDeclaredDesign(design);
    return declared === "unrated" ? "preclinical" : declared;
  }

  const fromType = mapDeclaredDesign(design);
  if (fromType !== "unrated") return fromType;
  if (abstract) {
    const inferred = inferDesignFromText(abstract);
    if (inferred) return inferred.level;
  }
  return "unrated";
}

function mapDeclaredDesign(design: string | undefined): EvidenceLevelType {
  const d = (design ?? "").toLowerCase();
  if (d.includes("meta-analysis") || d.includes("meta analysis")) return "meta_analysis";
  if (d.includes("systematic review")) return "systematic_review";
  if (d.includes("randomized controlled trial") || d.includes("randomised controlled trial")) return "rct";
  if (d.includes("controlled clinical trial") || d.includes("clinical trial")) return "rct";
  if (d.includes("practice guideline") || /\bguideline\b/.test(d)) return "guideline";
  if (d.includes("cohort")) return "cohort";
  if (d.includes("cross-sectional") || d.includes("cross sectional")) return "cross_sectional";
  if (d.includes("case-control") || d.includes("case control")) return "case_control";
  if (d.includes("in vitro") || d.includes("mechanistic")) return "mechanistic_study";
  if (/\b(editorial|comment|opinion)\b/.test(d)) return "expert_opinion";
  if (d.includes("review") || GENERIC_DESIGN.test(d)) return "narrative_review";
  if (/\b(animal|mice|rat|preclinical)\b/.test(d)) return "preclinical";
  return "unrated";
}

/** A trustworthy publisher can lift an otherwise unrated record one step. */
export function trustFloor(publisher: string, evidence: EvidenceLevelType): EvidenceLevelType {
  const p = publisher.toLowerCase();
  const authoritative =
    p.includes("cochrane") ||
    p.includes("who.int") ||
    p.includes("world health organization") ||
    p.includes("cdc") ||
    p.includes("nih") ||
    p.includes("nice.org.uk") ||
    p.includes("efsa") ||
    p.includes("fda");
  if (!authoritative) return evidence;
  if (evidence === "unrated") return "government_health_authority";
  return evidence;
}
