import type { Migration } from "../db.js";

export const search: Migration = {
  id: 2,
  name: "search",
  sql: `
-- 002: FTS-style search support for topic discovery scoring.
-- SQLite has no external-content FTS guarantee across versions, so the studio
-- keeps a normalised search_vector column (maintained in code) and a
-- lightweight trigram index for candidate lookup. Portable to PostgreSQL,
-- where an equivalent tsvector column can replace it.

CREATE TABLE topic_search (
  topic_id    TEXT PRIMARY KEY,
  search_text TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_topic_search_text ON topic_search(search_text);

CREATE TABLE source_claims (
  source_id    TEXT NOT NULL,
  claim_id     TEXT NOT NULL,
  relation     TEXT NOT NULL DEFAULT 'supports', -- supports | conflicts | context
  excerpt      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  PRIMARY KEY (source_id, claim_id)
);
CREATE INDEX idx_source_claims_claim ON source_claims(claim_id);

CREATE TABLE video_sources (
  video_id    TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'support',  -- support | context | methodology
  created_at  TEXT NOT NULL,
  PRIMARY KEY (video_id, source_id)
);

CREATE TABLE video_claims (
  video_id   TEXT NOT NULL,
  claim_id   TEXT NOT NULL,
  scene_id   TEXT,
  spoken_as  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, claim_id)
);

CREATE TABLE video_assets (
  video_id   TEXT NOT NULL,
  asset_id   TEXT NOT NULL,
  scene_id   TEXT,
  slot       TEXT NOT NULL DEFAULT 'visual',
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, asset_id, scene_id, slot)
);
`,
};
