import { fetchJson, HealthOSError, loadEnv } from "@hc/core";
import type { LiteratureHit, LiteratureQuery, ResearchProvider, TopicCandidate } from "./types.js";
import { mapDesignToEvidence, inferDesignFromText } from "../evidence.js";

interface EuropePmCResult {
  id?: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  journalTitle?: string;
  pubYear?: string;
  firstPublicationDate?: string;
  pubTypeList?: { pubType?: string[] };
  abstractText?: string;
  authorList?: { author?: { fullName?: string }[] };
  citedByCount?: number;
  isOpenAccess?: string;
}

interface EuropePmCResponse {
  hitCount: number;
  resultList: { result: EuropePmCResult[] };
}

const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";

/**
 * Europe PMC: a free, key-free index of PubMed, PMC and preprint servers.
 *
 * It is the default literature provider because it needs no credentials,
 * which keeps the studio runnable end to end on a fresh checkout while still
 * grounding claims in real, citable literature.
 */
export class EuropePmcProvider implements ResearchProvider {
  readonly name = "europepmc";

  isConfigured(): boolean {
    return loadEnv().EUROPE_PMC_ENABLED;
  }

  async search(query: LiteratureQuery): Promise<LiteratureHit[]> {
    const params = new URLSearchParams({
      query: buildEuropeQuery(query),
      format: "json",
      pageSize: String(Math.min(query.limit ?? 8, 25)),
      resultType: "core",
    });
    const payload = await fetchJson<EuropePmCResponse>({
      url: `${BASE}/search?${params.toString()}`,
      integration: "europepmc",
      timeoutMs: 25_000,
      headers: { accept: "application/json" },
      retry: { policy: { maxAttempts: 3, baseDelayMs: 800, maxDelayMs: 8000, factor: 2, jitterRatio: 0.2, maxAttemptDurationMs: 25_000 } },
    });
    const results = payload.resultList?.result ?? [];
    // Deliberately no `sort` parameter: Europe PMC's "CITED desc" sort ignores the
    // query terms and returns globally most-cited records (verified: a query for
    // "creatine muscle" returned COVID-19 cohort papers). The default relevance
    // order is the only trustworthy ordering, so citation counts are carried
    // through to the caller instead of being used to re-rank.
    return results.map((item) => toHit(item, this.name)).filter((hit): hit is LiteratureHit => hit !== null);
  }

  /**
   * Europe PMC is a literature index, not a trend source. Discovery from it is
   * expressed as "recently-indexed, highly-cited questions", and each candidate
   * is marked as evidence-led rather than demand-led.
   */
  async discover(input: { limit: number }): Promise<TopicCandidate[]> {
    const query = `(TITLE_ABS:"what happens") OR (TITLE_ABS:"mechanism") AND (FIRST_PDATE:[${yearOffset(-2)}-01-01 TO ${yearOffset(0)}-12-31])`;
    const hits = await this.search({ text: query, limit: input.limit, since: `${yearOffset(-2)}-01-01` });
    return hits
      .filter((hit) => !hit.title.startsWith("["))
      .map((hit) => ({
        topic: {
          title: truncateTitle(hit.title),
          question: `What does the research actually show about ${truncateTitle(hit.title).toLowerCase()}?`,
          category: "nutrition",
          suggested_format: "data",
          origin: this.name,
          origin_ref: hit.url,
          keywords: keywordsFromTitle(hit.title),
        },
        supporting: [hit],
        trend_provider: "none",
        warnings: ["Candidate derived from literature indexing, not from audience demand data."],
      }));
  }
}

function buildEuropeQuery(query: LiteratureQuery): string {
  const base = query.text.trim();
  const parts = [base];
  if (query.since) parts.push(`(FIRST_PDATE:[${query.since} TO 3000])`);
  if (query.types && query.types.length > 0) {
    const types = query.types.map((t) => `"${t}"`).join(" OR ");
    parts.push(`(PUB_TYPE:${types})`);
  }
  return parts.join(" AND ");
}

function yearOffset(delta: number): number {
  return new Date().getUTCFullYear() + delta;
}

function toHit(item: EuropePmCResult, provider: string): LiteratureHit | null {
  if (!item.title) return null;
  const title = decodeEntities(item.title).replace(/\s+/g, " ").trim();
  const abstract = decodeEntities(item.abstractText ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const indexed = item.pubTypeList?.pubType?.[0];
  const inferred = inferDesignFromText(abstract);
  const design = indexed && !/^(research-article|article|review-article|other)$/i.test(indexed) ? indexed : inferred?.design;
  const evidence = mapDesignToEvidence(indexed, item.source, abstract);
  const id = item.pmid ?? item.pmcid ?? item.doi ?? item.id;
  if (!id) return null;
  const authors = (item.authorList?.author ?? [])
    .map((a) => a.fullName)
    .filter((n): n is string => typeof n === "string")
    .slice(0, 12);
  return {
    provider,
    identifier: id,
    title,
    url: item.doi
      ? `https://doi.org/${item.doi}`
      : item.pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/`
        : `https://europepmc.org/article/${provider}/${id}`,
    publisher: item.journalTitle ?? "Europe PMC record",
    publication_date: item.firstPublicationDate ?? (item.pubYear ? `${item.pubYear}` : undefined),
    study_design: design,
    evidence_level: evidence,
    sample_size: undefined,
    doi: item.doi,
    pmid: item.pmid,
    authors,
    abstract,
    source_type: "journal",
    ...(typeof item.citedByCount === "number" ? { cited_by: item.citedByCount } : {}),
    ...(typeof item.isOpenAccess === "string" ? { open_access: item.isOpenAccess === "Y" } : {}),
  };
}

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&ndash;": "-",
  "&mdash;": "-",
};

/** Europe PMC titles/abstracts are HTML-escaped; decode before storing or speaking. */
function decodeEntities(input: string): string {
  return input
    .replace(/&lt;sub&gt;|&#60;sub&#62;/gi, "")
    .replace(/&lt;\/sub&gt;|&#60;\/sub&#62;/gi, "")
    .replace(/&[a-z]+;|&#\d+;/gi, (match) => ENTITIES[match.toLowerCase()] ?? match);
}

function truncateTitle(title: string): string {
  return title.length > 160 ? `${title.slice(0, 157)}…` : title;
}

function keywordsFromTitle(title: string): string[] {
  return Array.from(
    new Set(
      title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 4),
    ),
  ).slice(0, 8);
}

export function assertEuropePmCAvailable(): void {
  if (!loadEnv().EUROPE_PMC_ENABLED) {
    throw new HealthOSError("Europe PMC is disabled (EUROPE_PMC_ENABLED=false)", {
      category: "CONFIG_ERROR",
    });
  }
}
