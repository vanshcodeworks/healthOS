import { deterministicId, HealthOSError, httpRequest, loadEnv, nowIso, slugify } from "@hc/core";
import { parse, SourceSchema, type Claim, type Source } from "@hc/schemas";

/**
 * Source registry.
 *
 * Responsibilities:
 *   - de-duplicate citations by (publisher, identifier) or URL
 *   - verify that a citation is real and retrievable, recording the evidence
 *   - downgrade the evidence level of anything that cannot be confirmed
 *
 * Verification is best effort by design: an offline machine still produces a
 * video, but the downgraded evidence and the recorded verification state are
 * visible to the QA gate, which refuses to mark such a video READY.
 */
export type VerificationOutcome = "verified" | "blocked" | "not_found" | "offline" | "error";

export interface VerificationResult {
  source_id: string;
  ok: boolean;
  /**
   * `blocked` means the publisher refused automated access (401/403/405/429).
   * That is *not* evidence the citation is fake, so it is reported separately
   * from `not_found`: the QA gate decides whether an unverifiable citation is
   * fatal, and it must be able to tell the two cases apart.
   */
  outcome: VerificationOutcome;
  method: "http" | "doi" | "offline" | "skipped";
  status: number | null;
  note: string;
  verified_at: string;
}

export interface VerificationOptions {
  /** Probe the network. When false, records an explicit offline state. */
  online?: boolean;
  timeoutMs?: number;
  maxSources?: number;
}

export class SourceRegistry {
  private readonly cache = new Map<string, Source>();

  constructor(private readonly options: VerificationOptions = {}) {}

  static sourceId(source: Pick<Source, "publisher" | "url" | "doi" | "pmid">): string {
    return deterministicId("src", source.publisher, source.doi ?? source.pmid ?? source.url);
  }

  /** Insert or merge a citation. Returns the canonical stored record. */
  register(input: Omit<Source, "source_id" | "accessed_at"> & { accessed_at?: string }): Source {
    const sourceId = SourceRegistry.sourceId(input);
    const existing = this.cache.get(sourceId);
    const source: Source = {
      ...input,
      source_id: sourceId,
      accessed_at: input.accessed_at ?? nowIso(),
    };
    if (existing) {
      // Later records may carry richer metadata (abstract, design, dates).
      const merged: Source = {
        ...existing,
        ...stripEmpty(source),
        source_id: sourceId,
      };
      this.cache.set(sourceId, merged);
      return merged;
    }
    this.cache.set(sourceId, source);
    return source;
  }

  get(sourceId: string): Source | undefined {
    return this.cache.get(sourceId);
  }

  all(): Source[] {
    return Array.from(this.cache.values());
  }

  size(): number {
    return this.cache.size;
  }

  /**
   * Verify citations. Resolves https URLs (HEAD, falling back to GET) and
   * confirms that DOIs resolve to a publisher record. Never throws for a single
   * bad citation: one dead link must not stop a production run.
   */
  async verifyAll(): Promise<VerificationResult[]> {
    const online = this.options.online ?? false;
    const sources = this.all().slice(0, this.options.maxSources ?? 40);
    const results: VerificationResult[] = [];
    for (const source of sources) {
      results.push(await this.verifyOne(source, online));
    }
    return results;
  }

  async verifyOne(source: Source, online: boolean): Promise<VerificationResult> {
    const at = nowIso();
    if (!online) {
      source.verified = false;
      source.verification_notes = [
        ...source.verification_notes.filter((n) => !n.startsWith("offline")),
        "offline: citation not probed; evidence level not confirmed",
      ];
      return {
        source_id: source.source_id,
        ok: false,
        outcome: "offline",
        method: "offline",
        status: null,
        note: "Network verification skipped (offline run)",
        verified_at: at,
      };
    }
    const target = source.doi ? `https://doi.org/${source.doi}` : source.url;
    // For a DOI, the question is "is this identifier registered?", so the
    // redirect itself is the answer. Following it to the publisher measures that
    // publisher's bot protection, not the citation.
    const followRedirects = !source.doi;
    try {
      const response = await httpRequest({
        url: target,
        method: "GET",
        integration: "source-verifier",
        timeoutMs: this.options.timeoutMs ?? 20_000,
        accept: "text",
        followRedirects,
        // Several major publishers (NIH ODS, Elsevier, BMJ) answer 403 to the
        // default fetch user agent, which would look identical to a dead link.
        headers: {
          "user-agent": "HealthOS/1.0 (source verification; +https://localhost/healthos)",
          accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
          "accept-language": "en",
        },
        retry: { policy: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 2000, factor: 2, jitterRatio: 0.2, maxAttemptDurationMs: 20_000 } },
      });
      const via = source.doi ? "doi.org" : "direct url";
      const isRedirect = response.status >= 300 && response.status < 400 && Boolean(response.location);
      if (response.ok || isRedirect) {
        source.verified = true;
        source.verification_notes = [
          isRedirect
            ? `verified ${at}: DOI registered, HTTP ${response.status} to ${response.location}`
            : `verified ${at}: HTTP ${response.status} via ${via}`,
        ];
        return {
          source_id: source.source_id,
          ok: true,
          outcome: "verified",
          method: source.doi ? "doi" : "http",
          status: response.status,
          note: isRedirect
            ? `DOI ${source.doi} registered, HTTP ${response.status} to ${response.location}`
            : `HTTP ${response.status} via ${via}`,
          verified_at: at,
        };
      }
      const blocked = BLOCKED_STATUS.has(response.status);
      source.verified = false;
      source.verification_notes = [
        blocked
          ? `inconclusive ${at}: HTTP ${response.status} from ${via}; publisher refused automated access, citation not disproven`
          : `unverified ${at}: HTTP ${response.status} via ${via}`,
      ];
      return {
        source_id: source.source_id,
        ok: false,
        outcome: blocked ? "blocked" : "not_found",
        method: source.doi ? "doi" : "http",
        status: response.status,
        note: blocked
          ? `HTTP ${response.status}: publisher refused automated access`
          : `HTTP ${response.status} via ${via}`,
        verified_at: at,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // httpRequest throws for every non-2xx response, so the status code of a
      // failed probe lives on the error rather than on a response object.
      const status =
        error instanceof HealthOSError && typeof error.details["status"] === "number"
          ? (error.details["status"])
          : null;
      if (status !== null) {
        const blocked = BLOCKED_STATUS.has(status);
        source.verified = false;
        source.verification_notes = [
          blocked
            ? `inconclusive ${at}: HTTP ${status} from ${source.doi ? "doi.org" : "publisher"}; publisher refused automated access, citation not disproven`
            : `unverified ${at}: HTTP ${status} from ${source.doi ? "doi.org" : "publisher"}`,
        ];
        return {
          source_id: source.source_id,
          ok: false,
          outcome: blocked ? "blocked" : "not_found",
          method: source.doi ? "doi" : "http",
          status,
          note: blocked
            ? `HTTP ${status}: publisher refused automated access`
            : `HTTP ${status}`,
          verified_at: at,
        };
      }
      source.verified = false;
      source.verification_notes = [`verification failed ${at}: ${message.slice(0, 200)}`];
      return {
        source_id: source.source_id,
        ok: false,
        outcome: "error",
        method: source.doi ? "doi" : "http",
        status: null,
        note: message.slice(0, 200),
        verified_at: at,
      };
    }
  }
}

/** Statuses that indicate refusal of the client, not a missing document. */
const BLOCKED_STATUS = new Set([401, 402, 403, 405, 406, 429, 451]);

function stripEmpty<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === "" || item === undefined || (Array.isArray(item) && item.length === 0)) continue;
    out[key] = item;
  }
  return out as Partial<T>;
}

/** Human-readable citation list for the description and the source card. */
export function formatCitations(sources: Source[], style: "full" | "short" | "url_only" = "full"): string[] {
  return sources.map((source) => {
    if (style === "url_only") return source.url;
    if (style === "short") return `${source.publisher} — ${shortTitle(source.title)}`;
    const year = source.publication_date ? ` (${source.publication_date.slice(0, 4)})` : "";
    return `${source.publisher}. ${shortTitle(source.title)}${year}. ${source.url}`;
  });
}

function shortTitle(title: string): string {
  return title.length > 110 ? `${title.slice(0, 107)}…` : title;
}

export interface ClaimAudit {
  claim_id: string;
  supported: boolean;
  evidence_level: string;
  source_count: number;
  verified_source_count: number;
  problems: string[];
}

export interface ClaimAuditSummary {
  ok: boolean;
  claims: ClaimAudit[];
  problems: string[];
}

/**
 * Audit claims against the registry.
 *
 * A claim with zero citations, or whose citations are all unverified while the
 * run claims to be online, is reported as a problem. This is what stops a
 * fabricated source from ever reaching a render. Citations that a publisher
 * merely refused to serve are reported separately as `inconclusive`: they still
 * need attention, but they are not treated as fabricated.
 */
export function auditClaims(
  claims: Claim[],
  sources: Source[],
  options: { requireVerification?: boolean; verification?: VerificationResult[] } = {},
): ClaimAuditSummary {
  const byId = new Map(sources.map((s) => [s.source_id, s]));
  const verification = new Map((options.verification ?? []).map((v) => [v.source_id, v]));
  const audits: ClaimAudit[] = [];
  const problems: string[] = [];
  for (const claim of claims) {
    const resolved = claim.support.map((id) => byId.get(id)).filter((s): s is Source => Boolean(s));
    const problemsForClaim: string[] = [];
    const inconclusiveForClaim: string[] = [];
    if (resolved.length === 0) problemsForClaim.push("no resolvable citation");
    if (claim.support.length > resolved.length) {
      problemsForClaim.push(`${claim.support.length - resolved.length} citation(s) not found in registry`);
    }
    if (options.requireVerification && resolved.length > 0 && !resolved.some((s) => s.verified)) {
      const blocked = resolved.filter((s) => verification.get(s.source_id)?.outcome === "blocked");
      if (blocked.length === resolved.length) {
        inconclusiveForClaim.push(
          `all ${resolved.length} citation(s) refused automated access; evidence not confirmed either way`,
        );
      } else {
        problemsForClaim.push("every citation is unverified");
      }
    }
    if (claim.status === "rejected") problemsForClaim.push("claim marked rejected");
    audits.push({
      claim_id: claim.claim_id,
      supported: problemsForClaim.length === 0,
      evidence_level: claim.evidence_level,
      source_count: resolved.length,
      verified_source_count: resolved.filter((s) => s.verified).length,
      problems: [...problemsForClaim, ...inconclusiveForClaim],
    });
    for (const problem of problemsForClaim) problems.push(`${claim.claim_id}: ${problem}`);
  }
  return { ok: problems.length === 0, claims: audits, problems };
}

export function buildSourceFileName(source: Source): string {
  return `${slugify(source.publisher, 40)}-${slugify(source.title, 50)}.json`;
}

export function assertRegistryUsable(registry: SourceRegistry, minSources = 1): void {
  if (registry.size() < minSources) {
    throw new HealthOSError(`Source registry holds ${registry.size()} citations; ${minSources} required`, {
      category: "INVALID_HEALTH_CLAIM",
      remediation: "Research a topic with citable evidence before scripting.",
    });
  }
}

export function parseSource(raw: unknown): Source {
  return parse(SourceSchema, raw, "source");
}


export const DISCLOSURE_DEFAULT = loadEnv().SYNTHETIC_MEDIA_DISCLOSURE;

