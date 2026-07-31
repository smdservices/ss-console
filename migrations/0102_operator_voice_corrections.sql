-- 0102: operator_voice_corrections — the correction lifecycle, console-side
-- (ADR 0083 §4, #2091). Retires operator/migrations/0010_voice_corrections.sql.
--
-- WHY THE STORE MOVED, AND WHY IT IS NOT WHERE THE ISSUE GUESSED.
--
-- 0010 put corrections in the per-customer store on the seat and named
-- `adapter/voice/corrections.py::select_active` as its runtime consumer. That
-- module never existed — `operator/adapter/voice/` holds `diff.py`, `filter.py`,
-- `transform.py` and nothing else — so 0010 was schema with no runtime. It is
-- retired here rather than inherited: wrong shape (a before→after substitution
-- glossary, where ADR 0083 §4 makes a correction an EDIT TO AN OUTPUT CLASS's
-- property) and wrong place.
--
-- The obvious replacement — "put the whole record in the console D1, the seat
-- already writes there" — is not available. The seat cannot write this
-- database. `SMD_D1_AUDIT_BINDING` is a path on the Fly volume
-- (`operator/templates/fly.toml.template:84` → `/opt/data/audit/audit.db`) and
-- the overlay's `D1Client` is a sqlite3 client despite its name; audit rows
-- reach the console by console-initiated PULL over the runtime-read seam, never
-- by seat push. The one seat→console push that exists is the heartbeat, and
-- bootstrap.sh strips its key from the agent env precisely so a code-executing
-- agent cannot forge cross-tenant pushes (ADR 0023 locked-decision #10).
-- Handing the agent a console-write credential would reopen that, in service of
-- a feature whose entire point is the opposite.
--
-- SO THE LIFECYCLE IS SPLIT ALONG THE TRUST BOUNDARY, WHICH IS WHERE IT WANTED
-- TO BE ANYWAY:
--
--   CAPTURE lives on the seat, as an append-only `CORRECTION_PROPOSED` audit
--   row written through the uid-gated `correction_propose` broker verb. The
--   agent uid cannot open that ledger for write, so the only path in is the
--   broker — and the row it appends is one the broker built, not one the agent
--   handed it. Capture is already visible to the console over the existing
--   `audit_log` runtime-read kind, so this needed no new transport at all.
--
--   PROMOTION lives here. It is portal-authored: a Named Administrator decides,
--   and the person axis (`reviewer_user_id`), the priority, and the restorable
--   supersession chain are facts about that decision, not about the capture.
--
-- A `proposed` ROW IS NEVER A SOURCE OF SPEC BYTES. The promoted body is the
-- text the administrator submitted on the form; `statement` below is the record
-- of what was said, kept as provenance a human reads, never as a payload
-- anything copies. `spec_sha256` is recomputed server-side over the bytes
-- actually written to `vaults/<slug>/output-classes.json` (buildSpecDocument in
-- src/lib/operator/output-class-specs.ts) — a submitted digest is never stored.
--
-- Manual-only rollback at
-- migrations/rollbacks/0102_operator_voice_corrections_down.sql.

CREATE TABLE IF NOT EXISTS operator_voice_corrections (
  id                TEXT PRIMARY KEY,
  entity_id         TEXT NOT NULL,
  customer_slug     TEXT NOT NULL,

  -- The audience axis. 0010 scoped by `recipient_cohort`; ADR 0083 replaces
  -- that with the output class, which is the unit of configuration — the class
  -- IS the audience-and-purpose bundle, and it is what the seat installs.
  output_class      TEXT NOT NULL,
  spec_property     TEXT NOT NULL CHECK (spec_property IN ('voice', 'format')),

  -- The person axis, carried over from 0010's `reviewer_user_id`. NULL means
  -- firm-wide: a property that holds regardless of who is reviewing.
  reviewer_user_id  TEXT,

  -- What was said, and where it was said. PROVENANCE, NOT CONTENT: `statement`
  -- is the text the Operator captured from a conversation, kept so the human
  -- deciding can read what was actually said. It is never the promoted bytes —
  -- those are identified by `spec_key` + `spec_sha256` and live in R2 — and
  -- nothing may derive a spec from this column. See the header.
  --
  -- NULL on a `portal` row: an administrator authoring directly stated nothing
  -- to capture, and their content is the spec itself. An `agent_capture` row
  -- without a statement would be a capture of nothing, so the CHECK below
  -- refuses it rather than storing an empty witness.
  statement         TEXT,
  stated_by         TEXT,
  source_ref        TEXT,

  -- Where the record came from. 'agent_capture' rows are witnessed statements;
  -- 'portal' rows are an administrator authoring directly, with no capture
  -- behind them. The distinction is load-bearing for review, so it is a column
  -- rather than an inference.
  origin            TEXT NOT NULL CHECK (origin IN ('agent_capture', 'portal')),

  -- Tiebreak when several corrections address one (class, property, reviewer).
  -- Higher wins, matching 0010's convention.
  priority          INTEGER NOT NULL DEFAULT 0,

  status            TEXT NOT NULL CHECK (status IN (
    'proposed',
    'promoted',
    'declined',
    'superseded'
  )),

  -- Promotion facts. Present exactly on a row that was promoted: who did it,
  -- when, the R2 key written, and the digest computed over the written bytes.
  promoted_by_user_id TEXT,
  promoted_by_email   TEXT,
  promoted_at         TEXT,
  spec_key            TEXT,
  spec_sha256         TEXT,

  -- A correction is an edit, so it must be restorable: the row that overrode
  -- this one. Set only alongside status='superseded' so the two cannot tell
  -- different stories about the same row.
  superseded_by     TEXT REFERENCES operator_voice_corrections(id),

  created_at        TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (superseded_by IS NULL OR status = 'superseded'),
  -- A witnessed correction must carry the witness. A capture with no statement
  -- records that something was said without recording what, which is worse than
  -- no row: a reviewer would have nothing to review and might promote anyway.
  CHECK (origin <> 'agent_capture' OR statement IS NOT NULL),
  -- Promotion is all-or-nothing: a row claiming a promoter must carry the
  -- evidence of the write, and a row carrying that evidence must be promoted.
  -- This is the schema-level form of "no success state for a write that did
  -- not happen".
  CHECK (
    (status = 'promoted') =
    (promoted_by_user_id IS NOT NULL AND promoted_at IS NOT NULL
     AND spec_key IS NOT NULL AND spec_sha256 IS NOT NULL)
  )
);

-- The resolution read: the live corrections for one customer's class property.
CREATE INDEX IF NOT EXISTS idx_voice_corrections_scope
  ON operator_voice_corrections (customer_slug, output_class, spec_property, priority DESC);

-- The review queue, and the audit walk.
CREATE INDEX IF NOT EXISTS idx_voice_corrections_status
  ON operator_voice_corrections (entity_id, status, created_at DESC);
