import type { Db } from "@hc/core";
import { nowIso, parseJsonArray, parseJsonColumn, stringifyColumn } from "@hc/core";
import type { Claim, Source, Topic } from "@hc/schemas";

/** Persistence for topics, sources and claims. All writes are idempotent. */
export class ResearchStore {
  constructor(private readonly db: Db) {}

  upsertTopic(topic: Topic): void {
    this.db.run(
      `INSERT INTO topics (
         id, slug, title, question, category, suggested_format, origin, origin_ref,
         trend_signal, trend_strength, evidence_level, novelty_score, visual_score,
         educational_score, shareability, priority_score, status, keywords, evidence_json,
         source_ids, generated_videos, notes, search_vector, discovered_at, updated_at,
         scored_at, rejected_reason
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         question = excluded.question,
         evidence_level = excluded.evidence_level,
         novelty_score = excluded.novelty_score,
         visual_score = excluded.visual_score,
         educational_score = excluded.educational_score,
         shareability = excluded.shareability,
         priority_score = excluded.priority_score,
         status = excluded.status,
         keywords = excluded.keywords,
         evidence_json = excluded.evidence_json,
         source_ids = excluded.source_ids,
         generated_videos = excluded.generated_videos,
         updated_at = excluded.updated_at,
         scored_at = excluded.scored_at,
         rejected_reason = excluded.rejected_reason`,
      [
        topic.topic_id,
        topic.slug,
        topic.title,
        topic.question,
        topic.category,
        topic.suggested_format,
        topic.origin,
        topic.origin_ref ?? null,
        topic.trend_signal ?? null,
        topic.trend_strength,
        topic.evidence_level,
        topic.novelty_score,
        topic.visual_score,
        topic.educational_score,
        topic.shareability,
        topic.priority_score,
        topic.status,
        stringifyColumn(topic.keywords),
        stringifyColumn(topic.evidence ?? {}),
        stringifyColumn(topic.source_ids),
        stringifyColumn(topic.generated_videos),
        topic.notes ?? null,
        topicToSearch(topic),
        topic.discovered_at,
        topic.updated_at,
        topic.updated_at,
        topic.rejected_reason ?? null,
      ],
    );
    this.db.run(
      `INSERT INTO topic_search (topic_id, search_text, updated_at) VALUES (?,?,?)
       ON CONFLICT(topic_id) DO UPDATE SET search_text = excluded.search_text, updated_at = excluded.updated_at`,
      [topic.topic_id, topicToSearch(topic), nowIso()],
    );
  }

  setTopicStatus(topicId: string, status: Topic["status"], reason?: string): void {
    this.db.run("UPDATE topics SET status = ?, updated_at = ?, rejected_reason = ? WHERE id = ?", [
      status,
      nowIso(),
      reason ?? null,
      topicId,
    ]);
  }

  linkGeneratedVideo(topicId: string, videoId: string): void {
    const row = this.db.get<{ generated_videos: string }>("SELECT generated_videos FROM topics WHERE id = ?", [topicId]);
    const videos = parseJsonArray<string>(row?.generated_videos);
    if (!videos.includes(videoId)) videos.push(videoId);
    this.db.run("UPDATE topics SET generated_videos = ?, updated_at = ? WHERE id = ?", [
      stringifyColumn(videos),
      nowIso(),
      topicId,
    ]);
  }

  getTopic(topicId: string): Topic | undefined {
    const row = this.db.get<Record<string, unknown>>("SELECT * FROM topics WHERE id = ?", [topicId]);
    return row ? rowToTopic(row) : undefined;
  }

  getTopicBySlug(slug: string): Topic | undefined {
    const row = this.db.get<Record<string, unknown>>("SELECT * FROM topics WHERE slug = ?", [slug]);
    return row ? rowToTopic(row) : undefined;
  }

  listTopics(options: { status?: string; limit?: number } = {}): Topic[] {
    const sql = options.status
      ? "SELECT * FROM topics WHERE status = ? ORDER BY priority_score DESC, slug ASC LIMIT ?"
      : "SELECT * FROM topics ORDER BY priority_score DESC, slug ASC LIMIT ?";
    const params = options.status ? [options.status, options.limit ?? 100] : [options.limit ?? 100];
    return this.db.all<Record<string, unknown>>(sql, params).map(rowToTopic);
  }

  countByStatus(): Record<string, number> {
    const rows = this.db.all<{ status: string; c: number }>(
      "SELECT status, COUNT(*) AS c FROM topics GROUP BY status",
    );
    const out: Record<string, number> = {};
    for (const row of rows) out[row.status] = row.c;
    return out;
  }

  upsertSource(source: Source): void {
    this.db.run(
      `INSERT INTO sources (
         id, title, url, publisher, authors, publication_date, accessed_at, source_type,
         evidence_level, study_design, sample_size, doi, pmid, identifier, relevance, summary,
         content_hash, raw_json, verified, verification_json, conflicting, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         url = excluded.url,
         publisher = excluded.publisher,
         authors = excluded.authors,
         publication_date = excluded.publication_date,
         accessed_at = excluded.accessed_at,
         source_type = excluded.source_type,
         evidence_level = excluded.evidence_level,
         study_design = excluded.study_design,
         sample_size = excluded.sample_size,
         doi = excluded.doi,
         pmid = excluded.pmid,
         relevance = excluded.relevance,
         summary = excluded.summary,
         verified = excluded.verified,
         verification_json = excluded.verification_json,
         conflicting = excluded.conflicting,
         updated_at = excluded.updated_at`,
      [
        source.source_id,
        source.title,
        source.url,
        source.publisher,
        stringifyColumn(source.authors ?? []),
        source.publication_date ?? null,
        source.accessed_at,
        source.source_type,
        source.evidence_level,
        source.study_design ?? null,
        source.sample_size ?? null,
        source.doi ?? null,
        source.pmid ?? null,
        null,
        source.relevance,
        source.summary,
        "",
        stringifyColumn({}),
        source.verified ? 1 : 0,
        stringifyColumn({ notes: source.verification_notes }),
        source.conflicting ? 1 : 0,
        source.accessed_at,
        nowIso(),
      ],
    );
  }

  upsertSources(sources: Source[]): void {
    this.db.tx(() => {
      for (const source of sources) this.upsertSource(source);
    });
  }

  getSource(sourceId: string): Source | undefined {
    const row = this.db.get<Record<string, unknown>>("SELECT * FROM sources WHERE id = ?", [sourceId]);
    return row ? rowToSource(row) : undefined;
  }

  countSources(): number {
    return this.db.count("SELECT COUNT(*) FROM sources");
  }

  countVerifiedSources(): number {
    return this.db.count("SELECT COUNT(*) FROM sources WHERE verified = 1");
  }

  upsertClaim(claim: Claim, topicId?: string, videoId?: string): void {
    this.db.run(
      `INSERT INTO claims (
         id, video_id, topic_id, text, normalised_text, claim_type, evidence_level, confidence,
         support, conflicting, hedge_required, risk_flags, status, created_at, updated_at,
         permitted_phrasing, forbidden_phrasing, figures, caveat, visual_hints, visual_strategy_hint
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         text = excluded.text,
         evidence_level = excluded.evidence_level,
         confidence = excluded.confidence,
         support = excluded.support,
         conflicting = excluded.conflicting,
         hedge_required = excluded.hedge_required,
         risk_flags = excluded.risk_flags,
         status = excluded.status,
         permitted_phrasing = excluded.permitted_phrasing,
         forbidden_phrasing = excluded.forbidden_phrasing,
         figures = excluded.figures,
         caveat = excluded.caveat,
         visual_hints = excluded.visual_hints,
         visual_strategy_hint = excluded.visual_strategy_hint,
         updated_at = excluded.updated_at`,
      [
        claim.claim_id,
        videoId ?? null,
        topicId ?? null,
        claim.text,
        claim.normalised_text,
        claim.claim_type,
        claim.evidence_level,
        claim.confidence,
        stringifyColumn(claim.support),
        stringifyColumn(claim.conflicting),
        claim.hedge_required ? 1 : 0,
        stringifyColumn(claim.risk_flags),
        claim.status,
        nowIso(),
        nowIso(),
        stringifyColumn(claim.permitted_phrasing),
        stringifyColumn(claim.forbidden_phrasing),
        stringifyColumn(claim.figures),
        claim.caveat,
        stringifyColumn(claim.visual_hints),
        claim.visual_strategy_hint,
      ],
    );
  }

  listClaims(videoId: string): Claim[] {
    return this.db
      .all<Record<string, unknown>>("SELECT * FROM claims WHERE video_id = ? ORDER BY id", [videoId])
      .map(rowToClaim);
  }

  /** Claims produced by the research stage, before a video exists. */
  listClaimsForTopic(topicId: string): Claim[] {
    return this.db
      .all<Record<string, unknown>>("SELECT * FROM claims WHERE topic_id = ? ORDER BY id", [topicId])
      .map(rowToClaim);
  }

  linkSourceClaim(sourceId: string, claimId: string, relation = "supports"): void {
    this.db.run(
      `INSERT INTO source_claims (source_id, claim_id, relation, created_at) VALUES (?,?,?,?)
       ON CONFLICT(source_id, claim_id) DO UPDATE SET relation = excluded.relation`,
      [sourceId, claimId, relation, nowIso()],
    );
  }

  linkVideoSource(videoId: string, sourceId: string, role = "support"): void {
    this.db.run(
      `INSERT INTO video_sources (video_id, source_id, role, created_at) VALUES (?,?,?,?)
       ON CONFLICT(video_id, source_id) DO UPDATE SET role = excluded.role`,
      [videoId, sourceId, role, nowIso()],
    );
  }
}

function topicToSearch(topic: Topic): string {
  return [topic.title, topic.question, ...topic.keywords].join(" ").toLowerCase();
}

function str(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function num(row: Record<string, unknown>, key: string, fallback = 0): number {
  const value = row[key];
  return typeof value === "number" ? value : fallback;
}

function rowToTopic(row: Record<string, unknown>): Topic {
  return {
    topic_id: str(row, "id"),
    slug: str(row, "slug"),
    title: str(row, "title"),
    question: str(row, "question"),
    category: str(row, "category") as Topic["category"],
    suggested_format: str(row, "suggested_format") as Topic["suggested_format"],
    origin: str(row, "origin"),
    origin_ref: str(row, "origin_ref") || undefined,
    trend_signal: str(row, "trend_signal") || undefined,
    trend_strength: num(row, "trend_strength"),
    evidence_level: str(row, "evidence_level") as Topic["evidence_level"],
    novelty_score: num(row, "novelty_score"),
    visual_score: num(row, "visual_score"),
    educational_score: num(row, "educational_score"),
    shareability: num(row, "shareability"),
    priority_score: num(row, "priority_score"),
    status: str(row, "status") as Topic["status"],
    keywords: parseJsonArray<string>(row["keywords"]),
    evidence: parseJsonColumn<Topic["evidence"]>(row["evidence_json"], undefined),
    source_ids: parseJsonArray<string>(row["source_ids"]),
    generated_videos: parseJsonArray<string>(row["generated_videos"]),
    performance: parseJsonColumn<Record<string, number>>(row["performance_json"], {}),
    notes: str(row, "notes") || undefined,
    discovered_at: str(row, "discovered_at"),
    updated_at: str(row, "updated_at"),
    rejected_reason: str(row, "rejected_reason") || undefined,
  };
}

function rowToSource(row: Record<string, unknown>): Source {
  const verification = parseJsonColumn<{ notes?: string[] }>(row["verification_json"], {});
  return {
    source_id: str(row, "id"),
    title: str(row, "title"),
    url: str(row, "url"),
    publisher: str(row, "publisher"),
    authors: parseJsonArray<string>(row["authors"]),
    publication_date: str(row, "publication_date") || undefined,
    accessed_at: str(row, "accessed_at"),
    source_type: str(row, "source_type") as Source["source_type"],
    evidence_level: str(row, "evidence_level") as Source["evidence_level"],
    study_design: (str(row, "study_design") || undefined) as Source["study_design"],
    sample_size: typeof row["sample_size"] === "number" ? row["sample_size"] : undefined,
    doi: str(row, "doi") || undefined,
    pmid: str(row, "pmid") || undefined,
    relevance: str(row, "relevance"),
    summary: str(row, "summary"),
    verified: num(row, "verified") === 1,
    conflicting: num(row, "conflicting") === 1,
    verification_notes: verification.notes ?? [],
  };
}

function rowToClaim(row: Record<string, unknown>): Claim {
  return {
    claim_id: str(row, "id"),
    text: str(row, "text"),
    normalised_text: str(row, "normalised_text"),
    claim_type: (str(row, "claim_type") || "mechanism") as Claim["claim_type"],
    evidence_level: str(row, "evidence_level") as Claim["evidence_level"],
    confidence: num(row, "confidence"),
    support: parseJsonArray<string>(row["support"]),
    conflicting: parseJsonArray<string>(row["conflicting"]),
    hedge_required: num(row, "hedge_required") === 1,
    // Read the dedicated columns, but keep the pre-003 prefixed rows as a
    // fallback so a database restored from an older backup still round-trips.
    permitted_phrasing: readPhrasing(row, "permitted_phrasing", "permit:"),
    forbidden_phrasing: readPhrasing(row, "forbidden_phrasing", "forbid:"),
    figures: parseJsonArray<Claim["figures"][number]>(row["figures"]),
    caveat: str(row, "caveat"),
    visual_hints: parseJsonArray<string>(row["visual_hints"]),
    visual_strategy_hint: (str(row, "visual_strategy_hint") || null) as Claim["visual_strategy_hint"],
    risk_flags: parseJsonArray<string>(row["risk_flags"]).filter((f) => !f.startsWith("permit:") && !f.startsWith("forbid:")) as Claim["risk_flags"],
    status: (str(row, "status") || "draft") as Claim["status"],
  };
}

function readPhrasing(row: Record<string, unknown>, column: string, prefix: string): string[] {
  const dedicated = parseJsonArray<string>(row[column]);
  if (dedicated.length > 0) return dedicated;
  return parseJsonArray<string>(row["risk_flags"])
    .filter((f) => f.startsWith(prefix))
    .map((f) => f.slice(prefix.length));
}
