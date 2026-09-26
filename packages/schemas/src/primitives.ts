import { z } from "zod";

/** ISO-8601 UTC instant. Stored in every timestamp column. */
export const IsoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "must be a valid ISO-8601 timestamp" });

export const Id = z.string().min(3).max(80).regex(/^[A-Za-z0-9_.:-]+$/, "invalid identifier");

/**
 * Evidence strength vocabulary. Ordered by decreasing evidential weight.
 *
 * The script writer is only permitted to use language as strong as the
 * evidence recorded here — that constraint is enforced in @hc/factcheck.
 */
export const EvidenceLevel = z.enum([
  "meta_analysis",
  "systematic_review",
  "rct",
  "guideline",
  "government_health_authority",
  "cohort",
  "cross_sectional",
  "case_control",
  "narrative_review",
  "mechanistic_study",
  "preclinical",
  "expert_opinion",
  "testimonial",
  "unrated",
]);

export const EVIDENCE_RANK: Record<z.infer<typeof EvidenceLevel>, number> = {
  meta_analysis: 10,
  systematic_review: 9,
  rct: 8,
  guideline: 8,
  government_health_authority: 8,
  cohort: 6,
  cross_sectional: 5,
  case_control: 4,
  narrative_review: 3,
  mechanistic_study: 3,
  preclinical: 2,
  expert_opinion: 2,
  testimonial: 1,
  unrated: 0,
};

export const StudyDesign = z.enum([
  "meta_analysis",
  "systematic_review",
  "rct",
  "controlled_trial",
  "guideline",
  "cohort",
  "cross_sectional",
  "case_control",
  "narrative_review",
  "mechanistic",
  "preclinical",
  "expert_opinion",
  "statistics",
  "consumer_survey",
]);

export const SourceType = z.enum([
  "journal",
  "guideline",
  "government",
  "textbook",
  "news",
  "preprint",
  "conference",
  "dataset",
  "reference_site",
]);

/** Publishers whose output is treated as a gold-standard reference source. */
export const TRUSTED_PUBLISHERS = [
  "pubmed",
  "ncbi",
  "cochranelibrary",
  "who.int",
  "cdc.gov",
  "nih.gov",
  "nice.org.uk",
  "efsa.europa.eu",
  "fda.gov",
  "nature.com",
  "thelancet.com",
  "nejm.org",
  "bmj.com",
  "jamanetwork.com",
  "cell.com",
  "science.org",
  "sciencedirect.com",
  "springer.com",
  "wiley.com",
  "academic.oup.com",
  "annualreviews.org",
  "uptodate.com",
  "merckmanuals.com",
  "msdmanuals.com",
  "mayoclinic.org",
  "clevelandclinic.org",
  "healthline.com",
  "medlineplus.gov",
  "nationalacademies.org",
  "nap.edu",
  "britannica.com",
  "statpearls.com",
  "ods.od.nih.gov",
  "nhs.uk",
  "health.gov",
  "dietaryguidelines.gov",
  "aisc.edu",
  "sportsmedicine-open",
  "bmc",
  "plos.org",
  "frontiersin.org",
  "mdpi.com",
  "researchgate.net",
  "semanticscholar.org",
  "crossref.org",
] as const;

export const CATEGORY_IDS = [
  "nutrition",
  "metabolism",
  "hydration",
  "exercise",
  "sleep",
  "brain",
  "cardio",
  "digestion",
  "supplements",
  "immunity",
  "hormones",
  "microbiome",
  "longevity",
  "myths",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];
export const Category = z.enum(CATEGORY_IDS);

/** The eight content formats, each with a distinct visual grammar. */
export const FORMAT_IDS = [
  "mechanism",
  "myth",
  "nutrition",
  "supplement",
  "timeline",
  "comparison",
  "data",
  "system-journey",
] as const;

export type FormatId = (typeof FORMAT_IDS)[number];
export const Format = z.enum(FORMAT_IDS);

export const FORMAT_LABELS: Record<FormatId, string> = {
  mechanism: "Body Mechanism",
  myth: "Myth vs Evidence",
  nutrition: "Food Breakdown",
  supplement: "Supplement Science",
  timeline: "Timeline",
  comparison: "Comparison",
  data: "Data Explainer",
  "system-journey": "System Journey",
};

export const TOPIC_STATUSES = [
  "DISCOVERED",
  "RESEARCHING",
  "VALIDATED",
  "SCRIPTED",
  "RENDERED",
  "QA",
  "READY",
  "PUBLISHED",
  "REJECTED",
] as const;
export const TopicStatus = z.enum(TOPIC_STATUSES);

export const VIDEO_STATUSES = [
  "PLANNED",
  "SCRIPTED",
  "FACTCHECKED",
  "STORYBOARDED",
  "ASSETS_READY",
  "VOICED",
  "RENDERED",
  "QA_PASSED",
  "REJECTED",
  "READY",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
] as const;
export const VideoStatus = z.enum(VIDEO_STATUSES);

export const JOB_STAGES = [
  "DISCOVER",
  "RESEARCH",
  "VALIDATE",
  "SCRIPT",
  "FACTCHECK",
  "STORYBOARD",
  "ASSETS",
  "VOICE",
  "RENDER",
  "QA",
  "RIGHTS",
  "READY",
  "PUBLISH",
  "ANALYTICS",
] as const;
export const JobStage = z.enum(JOB_STAGES);

export const JOB_STATUSES = ["pending", "running", "retry_wait", "done", "failed", "cancelled"] as const;
export const JobStatus = z.enum(JOB_STATUSES);

export const PLATFORMS = ["instagram", "facebook", "youtube", "tiktok"] as const;
export const Platform = z.enum(PLATFORMS);

export type PlatformId = (typeof PLATFORMS)[number];

export const HOOK_TYPES = [
  "question",
  "surprising_stat",
  "myth_buster",
  "scenario",
  "counterintuitive",
  "timeline_promise",
] as const;
export const HookType = z.enum(HOOK_TYPES);
export type HookTypeType = z.infer<typeof HookType>;

export type EvidenceLevelType = z.infer<typeof EvidenceLevel>;
