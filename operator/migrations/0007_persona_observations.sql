-- ============================================================================
-- Migration 0007: persona_observations table (ADR 0016 rewrite, 2026-05-24)
-- ============================================================================
--
-- Per-customer table that mirrors Honcho's conclusions for Captain visibility
-- and reversibility. Honcho runs unmodified per ADR 0016 ("mirror, don't
-- gate"); this table is the visibility surface, not an interception queue.
--
-- The `hermes-smd-memory-mirror` plugin in venturecrane/hermes-smd-overlay
-- is the writer: on `on_session_end` (plus a periodic backup poller for
-- abnormal session terminations), it queries Honcho's conclusions API for
-- new conclusions and writes a row here with full provenance + evidence
-- classification.
--
-- Schema is the authoritative copy from ADR 0016 §3.
--
-- Read discipline (ADR 0016):
--   The admin portal surfaces two distinct review queues:
--     • Evidenced conclusions: default-collapsed list
--     • Unevidenced + insufficient conclusions: prominent queue
--   No skill, capability adapter, or signature renderer reads from this
--   table at agent runtime.
--
-- Write discipline (ADR 0016):
--   `hermes-smd-memory-mirror` is the only writer. Honcho's own conclusion
--   store runs unmodified; this is a mirror with provenance, not a gate.
--   Captain dismissal triggers a paired physical DELETE against Honcho's
--   API (works around Honcho bug #658, temporal awareness).
--
-- Evidence-status discipline (ADR 0016):
--   Bug #626 in Honcho teaches its extraction prompt to over-attribute
--   ("the user has a dog" from one mention). The `evidence_status` column
--   is the defense: rows with no resolving source-message IDs are flagged
--   `unevidenced` and surface in the prominent review queue for Captain
--   inspection BEFORE they shape future drafts.
--
-- Privacy posture (ADR 0009):
--   Lives in the per-customer D1 database. No cross-customer table. No
--   row-level customer_id key — isolation is the binding boundary. The
--   `customer_slug` column is denormalized per ADR 0016 §3 for query
--   ergonomics; deployment-level isolation remains the safety mechanism.
--
-- TTL archival (ADR 0016):
--   A daily job in `hermes-smd-memory-mirror/archive.py` sweeps rows older
--   than `archive_after_days` (default 180), inserts into
--   `persona_observations_archive`, stamps `archived_at` + `archived_reason`
--   here, and physically deletes from Honcho. Captain can restore.
--
-- Source spec: docs/adr/0016-honcho-disposition.md §3 (rewrite, 2026-05-24)
-- Refers to:   docs/adr/0017-skill-curator-disposition.md (symmetric posture)
--              docs/adr/0019-customer-yaml-to-profile-config-translation.md
--              docs/specs/operator/calibration-session.md (#867)
--              docs/specs/operator/decommission-customer.md (#820)
-- ============================================================================

-- ---------- Persona observations (live mirror) ----------
-- One row per Honcho conclusion. The plugin writes on session-end + periodic
-- backup poll; Captain reviews in the admin portal; dismissal triggers paired
-- Honcho DELETE; TTL sweep archives stale rows.
CREATE TABLE persona_observations (
  conclusion_id              TEXT PRIMARY KEY,        -- Honcho's conclusion ID
  customer_slug              TEXT NOT NULL,
  persona_slug               TEXT NOT NULL,
  peer_id                    TEXT NOT NULL,           -- Honcho peer (customer_id:persona_slug)
  conclusion_text            TEXT NOT NULL,
  conclusion_type            TEXT NOT NULL,           -- 'explicit' | 'deductive' | 'inductive'
  source_message_ids         TEXT NOT NULL,           -- JSON array from Honcho reasoning tree
  confidence                 REAL,                    -- Honcho-provided confidence, if any
  evidence_status            TEXT NOT NULL,           -- 'evidenced' | 'unevidenced' | 'insufficient'
  mirrored_at                TEXT NOT NULL DEFAULT (datetime('now')),
  honcho_created_at          TEXT NOT NULL,
  archived_at                TEXT,                    -- TTL or Captain-archived
  archived_reason            TEXT,                    -- 'ttl' | other policy reasons
  dismissed_at               TEXT,                    -- Captain dismissal in admin portal
  dismissed_by               TEXT,                    -- Captain identifier
  dismissed_honcho_delete_at TEXT,                    -- when the paired Honcho DELETE landed
  active                     BOOLEAN GENERATED ALWAYS AS (archived_at IS NULL AND dismissed_at IS NULL) VIRTUAL,
  CHECK (conclusion_type IN ('explicit', 'deductive', 'inductive')),
  CHECK (evidence_status IN ('evidenced', 'unevidenced', 'insufficient'))
);

-- Review queues: the admin portal walks these indexes.
-- (Generated columns cannot appear in a partial-index predicate, so the
-- physical archived_at + dismissed_at predicate is used instead.)
CREATE INDEX persona_observations_unevidenced
  ON persona_observations (mirrored_at)
  WHERE evidence_status = 'unevidenced'
    AND archived_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX persona_observations_insufficient
  ON persona_observations (mirrored_at)
  WHERE evidence_status = 'insufficient'
    AND archived_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX persona_observations_evidenced
  ON persona_observations (mirrored_at)
  WHERE evidence_status = 'evidenced'
    AND archived_at IS NULL AND dismissed_at IS NULL;

-- Per-persona scan: powers the calibration-session per-persona pane plus
-- the decommission export. Includes archived/dismissed rows by design —
-- the export ships everything.
CREATE INDEX persona_observations_by_persona
  ON persona_observations (persona_slug, mirrored_at);

-- ---------- Persona observations archive (append-only) ----------
-- TTL sweep destination. Same schema for round-trip restore; no constraints
-- copied across so the archive can hold the historical record verbatim.
CREATE TABLE persona_observations_archive (
  conclusion_id              TEXT PRIMARY KEY,
  customer_slug              TEXT NOT NULL,
  persona_slug               TEXT NOT NULL,
  peer_id                    TEXT NOT NULL,
  conclusion_text            TEXT NOT NULL,
  conclusion_type            TEXT NOT NULL,
  source_message_ids         TEXT NOT NULL,
  confidence                 REAL,
  evidence_status            TEXT NOT NULL,
  mirrored_at                TEXT NOT NULL,
  honcho_created_at          TEXT NOT NULL,
  archived_at                TEXT NOT NULL,
  archived_reason            TEXT NOT NULL,
  dismissed_at               TEXT,
  dismissed_by               TEXT,
  dismissed_honcho_delete_at TEXT
);

CREATE INDEX persona_observations_archive_by_persona
  ON persona_observations_archive (persona_slug, mirrored_at);

-- ---------- Schema version ----------
PRAGMA user_version = 7;
