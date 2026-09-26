import type { DiscoveredTopic, EvidenceLevelType, Source } from "@hc/schemas";

export interface LiteratureQuery {
  text: string;
  /** Only records published at or after this ISO date. */
  since?: string;
  limit?: number;
  /** Restrict to these publication types where the provider supports it. */
  types?: string[];
}

export interface LiteratureHit {
  provider: string;
  identifier: string;
  title: string;
  url: string;
  publisher: string;
  publication_date: string | undefined;
  study_design: string | undefined;
  evidence_level: EvidenceLevelType;
  sample_size: number | undefined;
  doi: string | undefined;
  pmid: string | undefined;
  authors: string[];
  abstract: string;
  source_type: Source["source_type"];
  /** Reported by the index; never used to reorder results. */
  cited_by?: number;
  open_access?: boolean;
}

export interface TopicCandidate {
  topic: DiscoveredTopic;
  /** Literature supporting the topic, if the provider found any. */
  supporting: LiteratureHit[];
  /** Where the demand signal came from. Never used as evidence. */
  trend_provider: string;
  warnings: string[];
}

export interface ResearchProvider {
  readonly name: string;
  /** True when credentials are configured; false means "use local fallback". */
  isConfigured(): boolean;
  /** Demand signal only. Implementations must never assert health truth. */
  discover(input: { limit: number; categories: string[]; seed: number }): Promise<TopicCandidate[]>;
  /** Scientific evidence lookup. */
  search(query: LiteratureQuery): Promise<LiteratureHit[]>;
  /** Optional: verify a candidate source URL resolves. */
  verify?(source: Source): Promise<{ ok: boolean; status: number; note: string }>;
}

export function abstractToSnippet(abstract: string, maxLength = 420): string {
  const clean = abstract.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return `${(lastStop > 120 ? cut.slice(0, lastStop + 1) : cut).trim()}…`;
}
