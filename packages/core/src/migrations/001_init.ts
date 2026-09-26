import type { Migration } from "../db.js";

export const init: Migration = {
  id: 1,
  name: "init",
  sql: `
-- 001: core content, research, asset and job tables.
-- Portable subset: TEXT ids, ISO-8601 timestamps, JSON stored as TEXT.
-- Types map mechanically to PostgreSQL: TEXT->text/uuid, INTEGER->bigint,
-- REAL->double precision, TEXT(json)->jsonb.

CREATE TABLE topics (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  question          TEXT NOT NULL,
  category          TEXT NOT NULL,
  suggested_format  TEXT NOT NULL,
  origin            TEXT NOT NULL,              -- provider that surfaced it
  origin_ref        TEXT,                       -- provider id / url / feed
  trend_signal      TEXT,                       -- NOT evidence
  trend_strength    REAL NOT NULL DEFAULT 0,
  evidence_level    TEXT NOT NULL DEFAULT 'unassessed',
  novelty_score     REAL NOT NULL DEFAULT 0,
  visual_score      REAL NOT NULL DEFAULT 0,
  educational_score REAL NOT NULL DEFAULT 0,
  shareability      REAL NOT NULL DEFAULT 0,
  priority_score    REAL NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'DISCOVERED',
  keywords          TEXT NOT NULL DEFAULT '[]',
  evidence_json     TEXT NOT NULL DEFAULT '{}',
  source_ids        TEXT NOT NULL DEFAULT '[]',
  generated_videos  TEXT NOT NULL DEFAULT '[]',
  notes             TEXT,
  search_vector     TEXT NOT NULL DEFAULT '',
  discovered_at     TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  scored_at         TEXT,
  rejected_reason   TEXT
);
CREATE INDEX idx_topics_status ON topics(status);
CREATE INDEX idx_topics_category ON topics(category);
CREATE INDEX idx_topics_priority ON topics(priority_score DESC);
CREATE INDEX idx_topics_origin ON topics(origin, origin_ref);

CREATE TABLE sources (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  publisher         TEXT NOT NULL,
  authors           TEXT,
  publication_date  TEXT,
  accessed_at       TEXT NOT NULL,
  source_type       TEXT NOT NULL,              -- journal | guideline | government | textbook | news
  evidence_level    TEXT NOT NULL DEFAULT 'unrated',
  study_design      TEXT,                       -- rct | meta_analysis | cohort | case_control | review | narrative | preprint
  sample_size       INTEGER,
  doi               TEXT,
  pmid              TEXT,
  identifier        TEXT,                       -- provider-native id
  relevance         TEXT NOT NULL DEFAULT '',
  summary           TEXT NOT NULL DEFAULT '',
  content_hash      TEXT NOT NULL DEFAULT '',
  raw_json          TEXT NOT NULL DEFAULT '{}',
  verified          INTEGER NOT NULL DEFAULT 0,
  verification_json TEXT NOT NULL DEFAULT '{}',
  conflicting       INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_sources_identity ON sources(publisher, identifier);
CREATE INDEX idx_sources_evidence ON sources(evidence_level);

CREATE TABLE claims (
  id                TEXT PRIMARY KEY,
  video_id          TEXT,
  topic_id          TEXT,
  text              TEXT NOT NULL,
  normalised_text   TEXT NOT NULL,
  claim_type        TEXT NOT NULL DEFAULT 'mechanism',
  evidence_level    TEXT NOT NULL DEFAULT 'unrated',
  confidence        REAL NOT NULL DEFAULT 0,
  support           TEXT NOT NULL DEFAULT '[]',  -- json array of source ids
  conflicting       TEXT NOT NULL DEFAULT '[]',
  hedge_required    INTEGER NOT NULL DEFAULT 0,
  risk_flags        TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'draft',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_claims_video ON claims(video_id);
CREATE INDEX idx_claims_status ON claims(status);

CREATE TABLE videos (
  id                TEXT PRIMARY KEY,
  topic_id          TEXT,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  format            TEXT NOT NULL,
  category          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PLANNED',
  target_duration   REAL NOT NULL DEFAULT 42,
  duration_seconds  REAL,
  hook              TEXT NOT NULL DEFAULT '',
  hook_type         TEXT NOT NULL DEFAULT 'question',
  template_id       TEXT NOT NULL DEFAULT '',
  voice_id          TEXT NOT NULL DEFAULT 'default',
  palette_id        TEXT NOT NULL DEFAULT 'neutral',
  render_hash       TEXT,
  content_hash      TEXT,
  job_id            TEXT,
  qa_state          TEXT NOT NULL DEFAULT '{}',
  rights_state      TEXT NOT NULL DEFAULT '{}',
  originality_state TEXT NOT NULL DEFAULT '{}',
  final_path        TEXT,
  thumbnail_path    TEXT,
  publish_state     TEXT NOT NULL DEFAULT '{}',
  experiment_id     TEXT,
  variant           TEXT NOT NULL DEFAULT 'A',
  metadata_json     TEXT NOT NULL DEFAULT '{}',
  manifest_json     TEXT NOT NULL DEFAULT '{}',
  error_state       TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  published_at      TEXT
);
CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_format ON videos(format);
CREATE INDEX idx_videos_created ON videos(created_at DESC);

CREATE TABLE scripts (
  id                TEXT PRIMARY KEY,
  video_id          TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  hook              TEXT NOT NULL,
  body              TEXT NOT NULL,
  cta               TEXT NOT NULL DEFAULT '',
  words             TEXT NOT NULL DEFAULT '[]',  -- json: [{text, scene, kind}]
  word_count        INTEGER NOT NULL DEFAULT 0,
  estimated_ms      INTEGER NOT NULL DEFAULT 0,
  content_hash      TEXT NOT NULL,
  authored_by       TEXT NOT NULL DEFAULT 'system',
  review_json       TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  UNIQUE(video_id, version)
);
CREATE INDEX idx_scripts_video ON scripts(video_id);

CREATE TABLE storyboards (
  id                TEXT PRIMARY KEY,
  video_id          TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  template_id       TEXT NOT NULL,
  scene_count       INTEGER NOT NULL,
  duration_seconds  REAL NOT NULL,
  payload           TEXT NOT NULL,               -- validated storyboard json
  content_hash      TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  UNIQUE(video_id, version)
);

CREATE TABLE assets (
  id                TEXT PRIMARY KEY,
  provider          TEXT NOT NULL,
  provider_ref      TEXT,
  kind              TEXT NOT NULL,              -- photo | video | svg | audio | font | generated
  role              TEXT NOT NULL DEFAULT 'layer',
  local_path        TEXT NOT NULL,
  content_hash      TEXT NOT NULL,
  width             INTEGER,
  height            INTEGER,
  duration_seconds  REAL,
  bytes             INTEGER NOT NULL DEFAULT 0,
  title             TEXT NOT NULL DEFAULT '',
  creator           TEXT,
  source_url        TEXT,
  license           TEXT NOT NULL DEFAULT 'unknown',
  license_url       TEXT,
  license_evidence  TEXT NOT NULL DEFAULT '{}',
  attribution       TEXT NOT NULL DEFAULT '',
  commercial_use    INTEGER NOT NULL DEFAULT 0,
  redistribution    INTEGER NOT NULL DEFAULT 0,
  content_safety    TEXT NOT NULL DEFAULT 'unknown',
  downloaded_at     TEXT,
  expires_at        TEXT,
  tags              TEXT NOT NULL DEFAULT '[]',
  rights_state      TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_assets_hash ON assets(content_hash, kind);
CREATE INDEX idx_assets_provider ON assets(provider);
CREATE INDEX idx_assets_license ON assets(license);

CREATE TABLE asset_usages (
  id            TEXT PRIMARY KEY,
  asset_id      TEXT NOT NULL,
  video_id      TEXT NOT NULL,
  scene_id      TEXT,
  purpose       TEXT NOT NULL DEFAULT 'visual_layer',
  created_at    TEXT NOT NULL,
  UNIQUE(asset_id, video_id, scene_id, purpose)
);
CREATE INDEX idx_asset_usages_video ON asset_usages(video_id);

CREATE TABLE rights_audit (
  id            TEXT PRIMARY KEY,
  subject_type  TEXT NOT NULL,                  -- video | asset
  subject_id    TEXT NOT NULL,
  event         TEXT NOT NULL,                  -- registered | verified | rejected | published | expired
  decision      TEXT NOT NULL,                  -- allow | block | review
  reason        TEXT NOT NULL DEFAULT '',
  evidence      TEXT NOT NULL DEFAULT '{}',
  actor         TEXT NOT NULL DEFAULT 'system',
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_rights_subject ON rights_audit(subject_type, subject_id);

CREATE TABLE renders (
  id                TEXT PRIMARY KEY,
  video_id          TEXT NOT NULL,
  cache_key         TEXT NOT NULL,
  renderer_version  TEXT NOT NULL,
  engine            TEXT NOT NULL,
  width             INTEGER NOT NULL,
  height            INTEGER NOT NULL,
  fps               INTEGER NOT NULL,
  frame_count       INTEGER NOT NULL,
  duration_seconds  REAL NOT NULL,
  output_path       TEXT NOT NULL,
  output_hash       TEXT,
  output_bytes      INTEGER,
  thumbnail_path    TEXT,
  duration_ms       INTEGER NOT NULL DEFAULT 0,
  cpu_ms            INTEGER,
  peak_rss_bytes    INTEGER,
  reused            INTEGER NOT NULL DEFAULT 0,
  manifest_json     TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_renders_cache ON renders(cache_key);

CREATE TABLE render_cache (
  cache_key     TEXT PRIMARY KEY,
  video_id      TEXT NOT NULL,
  output_path   TEXT NOT NULL,
  output_hash   TEXT NOT NULL,
  output_bytes  INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL
);

CREATE TABLE qa_reports (
  id              TEXT PRIMARY KEY,
  video_id        TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  decision        TEXT NOT NULL,                -- pass | reject
  gates_json      TEXT NOT NULL DEFAULT '{}',
  findings_json   TEXT NOT NULL DEFAULT '[]',
  metrics_json    TEXT NOT NULL DEFAULT '{}',
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_qa_video ON qa_reports(video_id, created_at DESC);

CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  video_id        TEXT,
  topic_id        TEXT,
  kind            TEXT NOT NULL,                -- video | topic | system
  stage           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|running|retry_wait|done|failed|cancelled
  priority        INTEGER NOT NULL DEFAULT 100,
  idempotency_key TEXT NOT NULL,
  payload_json    TEXT NOT NULL DEFAULT '{}',
  attempt         INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  last_error      TEXT,
  next_attempt_at TEXT,
  lease_owner     TEXT,
  lease_expires_at TEXT,
  progress        REAL NOT NULL DEFAULT 0,
  result_json     TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT
);
CREATE UNIQUE INDEX idx_jobs_idempotency ON jobs(idempotency_key);
CREATE INDEX idx_jobs_queue ON jobs(status, stage, priority, next_attempt_at);
CREATE INDEX idx_jobs_video ON jobs(video_id);

CREATE TABLE job_events (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL,
  stage         TEXT NOT NULL,
  status        TEXT NOT NULL,
  attempt       INTEGER NOT NULL DEFAULT 0,
  error_category TEXT,
  message       TEXT,
  duration_ms   INTEGER,
  details_json  TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_job_events_job ON job_events(job_id, created_at);

CREATE TABLE platform_posts (
  id                 TEXT PRIMARY KEY,
  video_id           TEXT NOT NULL,
  platform           TEXT NOT NULL,
  account_id         TEXT,
  status             TEXT NOT NULL DEFAULT 'queued', -- queued|uploading|processing|published|failed|skipped
  mode               TEXT NOT NULL DEFAULT 'AUTO_PUBLISH_AFTER_ALL_GATES',
  media_id           TEXT,
  container_id       TEXT,
  remote_id          TEXT,
  permalink          TEXT,
  title               TEXT NOT NULL DEFAULT '',
  description         TEXT NOT NULL DEFAULT '',
  caption             TEXT NOT NULL DEFAULT '',
  hashtags            TEXT NOT NULL DEFAULT '[]',
  disclosure          TEXT NOT NULL DEFAULT '',
  scheduled_at        TEXT,
  published_at        TEXT,
  disclosure_applied  INTEGER NOT NULL DEFAULT 0,
  error              TEXT,
  attempt            INTEGER NOT NULL DEFAULT 0,
  metadata_json      TEXT NOT NULL DEFAULT '{}',
  campaign_id         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE(video_id, platform)
);
CREATE INDEX idx_posts_status ON platform_posts(status);
CREATE INDEX idx_posts_platform ON platform_posts(platform);

CREATE TABLE analytics (
  id                 TEXT PRIMARY KEY,
  platform_post_id   TEXT NOT NULL,
  video_id           TEXT NOT NULL,
  platform           TEXT NOT NULL,
  measured_at        TEXT NOT NULL,
  window_start       TEXT NOT NULL,
  window_end         TEXT NOT NULL,
  views              REAL NOT NULL DEFAULT 0,
  watch_time_seconds REAL NOT NULL DEFAULT 0,
  avg_percent_viewed REAL,
  retention_25       REAL,
  retention_50       REAL,
  retention_75       REAL,
  completion_rate    REAL,
  likes              REAL NOT NULL DEFAULT 0,
  shares             REAL NOT NULL DEFAULT 0,
  saves              REAL NOT NULL DEFAULT 0,
  comments           REAL NOT NULL DEFAULT 0,
  profile_visits     REAL NOT NULL DEFAULT 0,
  follows            REAL NOT NULL DEFAULT 0,
  link_clicks        REAL NOT NULL DEFAULT 0,
  revenue_micros     REAL NOT NULL DEFAULT 0,
  normalised_json    TEXT NOT NULL DEFAULT '{}',
  UNIQUE(platform_post_id, window_end)
);
CREATE INDEX idx_analytics_video ON analytics(video_id);

CREATE TABLE errors (
  id               TEXT PRIMARY KEY,
  job_id           TEXT,
  video_id         TEXT,
  stage            TEXT NOT NULL,
  category         TEXT NOT NULL,
  message          TEXT NOT NULL,
  remediation      TEXT,
  attempt          INTEGER NOT NULL DEFAULT 0,
  details_json     TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL,
  resolved_at      TEXT
);
CREATE INDEX idx_errors_created ON errors(created_at DESC);
CREATE INDEX idx_errors_category ON errors(category);

CREATE TABLE experiments (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  hypothesis       TEXT NOT NULL,
  variable         TEXT NOT NULL,
  variants_json    TEXT NOT NULL DEFAULT '[]',
  metric           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'running',
  allocation_json  TEXT NOT NULL DEFAULT '{}',
  results_json     TEXT NOT NULL DEFAULT '{}',
  started_at       TEXT NOT NULL,
  ended_at         TEXT
);

CREATE TABLE links (
  id              TEXT PRIMARY KEY,
  video_id        TEXT NOT NULL,
  platform_post_id TEXT,
  kind            TEXT NOT NULL,               -- affiliate | sponsor | product | funnel
  campaign_id     TEXT NOT NULL,
  url             TEXT NOT NULL,
  short_code      TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',
  sponsor         TEXT,
  product_ref     TEXT,
  disclosure      TEXT NOT NULL DEFAULT '',
  clicks          REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_links_campaign ON links(campaign_id);

CREATE TABLE kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE learning_models (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,                    -- global | format:<id> | category:<id> | hook:<id>
  payload     TEXT NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  UNIQUE(scope)
);

CREATE TABLE topic_scores (
  id            TEXT PRIMARY KEY,
  topic_id      TEXT NOT NULL,
  kind          TEXT NOT NULL,                  -- discovery | performance | learning
  payload       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_topic_scores_topic ON topic_scores(topic_id, kind);
`,
};

