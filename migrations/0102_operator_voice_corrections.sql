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
-- ============================================================================
-- THE DECISION: TWO STORES, SPLIT ON THE TRUST BOUNDARY. DO NOT MERGE THEM.
-- ============================================================================
--
-- This is a deliberate architectural choice, not an artifact of how the code
-- grew. Stated here in full because the next person to read it will see two
-- stores holding one concept and reach for the obvious simplification.
--
--   CAPTURE BELONGS WHERE THE AGENT IS, AND WHERE IT CANNOT ESCALATE.
--   PROMOTION BELONGS WHERE THE HUMAN IS.
--
-- The seat store is not a fallback for a console store we could not reach. It
-- is the stronger of the two: the capture ledger is owned by the broker uid and
-- the agent uid cannot open it read-write at all, so "the agent cannot forge a
-- promotion" is a filesystem fact rather than a property of a credential the
-- agent holds and might leak. Moving capture into this database would replace
-- that with a console-write credential in the agent's environment — weaker, and
-- reopening the tenant-forgery hole ADR 0023 locked-decision #10 closed by
-- stripping exactly such a key from the agent env in bootstrap.sh.
--
-- The console store is not a mirror of the seat store. It holds what the seat
-- has no business holding: which human decided, when, over which class
-- property, at what priority, replacing which earlier correction. Those are
-- facts about a review, and a review happens here.
--
-- If a future change puts both halves in one place, the question to answer
-- first is: can the agent write the store that promotion reads? If yes, the
-- gap this design exists to hold is gone, and #2091 has been undone.
--
-- SO THE LIFECYCLE IS SPLIT ALONG THE TRUST BOUNDARY, WHICH IS WHERE IT WANTED
-- TO BE ANYWAY:
--
--   CAPTURE lives on the seat, as an append-only `CORRECTION_PROPOSED` audit
--   row written through the uid-gated `correction_propose` broker verb. The
--   agent uid cannot open that ledger for write, so the only path in is the
--   broker — and the row it appends is one the broker built, not one the agent
--   handed it.
--
--   VISIBILITY IS AN OPEN GAP, NAMED SO IT IS NOT MISTAKEN FOR DONE. A capture
--   rides the existing `audit_log` runtime-read kind, so it reaches the console
--   with no new transport — but nothing yet PRESENTS it as a proposal awaiting
--   a decision. A dedicated runtime-read kind in `hermes-smd-overlay`
--   (`shared/runtime_read.py`) is a follow-up in that repo, owned by the team
--   lead. Until it lands, an administrator can author a spec and cite a capture
--   by hand; they cannot yet be SHOWN the queue of captures. No `(runtime)` row
--   of #2091 is closed by this migration, and none should be marked met on the
--   strength of it.
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

  -- TWO TEXTS, AND THE DIFFERENCE BETWEEN THEM IS THE SECURITY PROPERTY.
  --
  -- `statement` is what was SAID — text the Operator captured from a
  -- conversation, present on an `agent_capture` row. It is provenance a human
  -- reads before deciding, and nothing may derive a spec from it. An
  -- agent-originated byte never becomes a ceiling.
  --
  -- `promoted_body` is what a Named Administrator AUTHORED, and is the exact
  -- bytes this console wrote to R2 and `spec_sha256` digests. Human-authored,
  -- and therefore safe to keep and to re-offer for editing: restoring a
  -- superseded correction means showing these bytes back to a person who
  -- submits them again through the same reviewed form. It is never an
  -- automatic rewrite, and nothing reads this column on the write path.
  --
  -- Separate columns are what let the guard be a rule rather than a judgement:
  -- `statement` is never a byte source; `promoted_body` is only ever replayed
  -- through a human. Merging them — "they are both just the correction text" —
  -- collapses that distinction, and is the refactor this schema is arranged to
  -- prevent.
  --
  -- `statement` is NULL on a `portal` row: an administrator authoring directly
  -- stated nothing to capture, and their content is the spec itself. An
  -- `agent_capture` row without a statement would be a capture of nothing, so
  -- the CHECK below refuses it rather than storing an empty witness.
  statement         TEXT,
  stated_by         TEXT,
  source_ref        TEXT,
  promoted_body     TEXT,

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
  -- different stories about the same row. Restorable in the full sense —
  -- `promoted_body` above keeps the superseded text, so the chain is a history
  -- a person can read and re-submit, not just a list of ids.
  superseded_by     TEXT REFERENCES operator_voice_corrections(id),

  created_at        TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (superseded_by IS NULL OR status = 'superseded'),
  -- A witnessed correction must carry the witness. A capture with no statement
  -- records that something was said without recording what, which is worse than
  -- no row: a reviewer would have nothing to review and might promote anyway.
  CHECK (origin <> 'agent_capture' OR statement IS NOT NULL),
  -- Promotion is all-or-nothing: a row that was promoted must carry the whole
  -- evidence of the write, and a row that was never promoted must carry none of
  -- it. This is the schema-level form of "no success state for a write that did
  -- not happen" — a `proposed` or `declined` row cannot borrow a digest and
  -- look like something that reached a seat.
  --
  -- The live set is BOTH sides of the supersession, not just `promoted`. A
  -- superseded row was promoted once; its promoter, key, digest and body are
  -- history that stays true, and `promoted_body` in particular is the only copy
  -- of the replaced text. Writing this as `status = 'promoted'` instead refuses
  -- every supersession — caught by executing the migration rather than reading
  -- it, which is the only way this class of error surfaces before production.
  -- Counted, not ANDed. `(a IS NOT NULL AND b IS NOT NULL AND …)` is false when
  -- only SOME of the evidence is present, so pairing it with the status leaves a
  -- `proposed` row free to carry a stray digest — partial evidence, which is
  -- exactly the shape that lets a row look more complete than it is. Requiring
  -- the count to be all-six or none-at-all admits no middle.
  CHECK (
    (
      (promoted_by_user_id IS NOT NULL)
      + (promoted_by_email IS NOT NULL)
      + (promoted_at IS NOT NULL)
      + (spec_key IS NOT NULL)
      + (spec_sha256 IS NOT NULL)
      + (promoted_body IS NOT NULL)
    ) = (CASE WHEN status IN ('promoted', 'superseded') THEN 6 ELSE 0 END)
  )
);

-- The resolution read: the live corrections for one customer's class property.
CREATE INDEX IF NOT EXISTS idx_voice_corrections_scope
  ON operator_voice_corrections (customer_slug, output_class, spec_property, priority DESC);

-- The review queue, and the audit walk.
CREATE INDEX IF NOT EXISTS idx_voice_corrections_status
  ON operator_voice_corrections (entity_id, status, created_at DESC);
