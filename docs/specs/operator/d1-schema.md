# D1 Schema

**Spec for issue #800.** One D1 database per customer (`hermes-{slug}-d1`). All tables namespaced to that database — there is no cross-customer table. Per-customer isolation is enforced at the database-binding layer (one binding per Machine), not at the row level.

## Contract

```sql
-- 1. Audit log (append-only; digests only — substantive content lives in R2)
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,           -- ULID, sortable
  ts            TEXT NOT NULL,              -- ISO 8601 UTC
  action_type   TEXT NOT NULL,
  actor         TEXT NOT NULL,              -- 'agent' | 'captain' | person_mappings.id
  actor_role    TEXT,                       -- 'principal' | 'operator' | 'compliance' | 'agent' | 'captain'
  skill_name    TEXT,
  matter_ref    TEXT,
  input_digest  TEXT,                       -- SHA-256
  output_digest TEXT,
  diff_digest   TEXT,
  trust_ceiling TEXT,
  metadata      TEXT                        -- JSON
);
CREATE INDEX idx_audit_ts ON audit_log(ts);
CREATE INDEX idx_audit_action_type ON audit_log(action_type, ts);
CREATE INDEX idx_audit_actor ON audit_log(actor, ts);

-- Accepted action_type values:
-- DRAFT_CREATED, DRAFT_APPROVED, DRAFT_REJECTED, DRAFT_EXPIRED,
-- MEMORY_RULE_ADDED, MEMORY_RULE_EDITED, MEMORY_RULE_DELETED,
-- TRUST_PROMOTED, TRUST_DEMOTED,
-- SKILL_ENABLED, SKILL_DISABLED,
-- AGENT_STOPPED, AGENT_RESUMED,
-- CONNECTOR_BOUND, CONNECTOR_UNBOUND, CONNECTOR_AUTH_EXPIRED,
-- CONNECTOR_AUTH_RESTORED, CONNECTOR_TOKEN_REFRESHED, CONNECTOR_HEALTH_PROBE_FAILED,
-- SCOPE_CHANGED, SENT_DETECTED, SENT_DIFF_INDEXED,
-- INVARIANT_VIOLATION, INVARIANT_BOOT_CHECK_FAILED,
-- INBOUND_RECEIVED (ADR 0027 — one row per untrusted inbound item; metadata
--   carries the provenance envelope, never the content bytes),
-- RBAC_EVENT, COMPLIANCE_PACKET_EXPORTED,
-- VOICE_GATE_PASSED, VOICE_GATE_NEAR_PASS, VOICE_GATE_FAILED,
-- FABRICATION_FILTER_TRIGGERED, ESCALATION_FIRED, ESCALATION_ACKNOWLEDGED,
-- DECOMMISSION_INITIATED, DECOMMISSION_DRAIN_COMPLETE,
-- DECOMMISSION_STEP_BEGIN, DECOMMISSION_STEP_COMPLETE, DECOMMISSION_STEP_FAILED
--   (per-step lifecycle rows; metadata.step names the step — added
--   2026-06-12 so the compliance trail distinguishes the nine steps
--   instead of reusing INITIATED/DRAIN_COMPLETE for every one),
-- DECOMMISSION_FINAL,
-- CAPTAIN_TIME_LOGGED,
-- HONCHO_CONCLUSION_DISMISSED (ADR 0016 rewrite — Captain dismissal in
--   admin portal, paired with physical DELETE against Honcho),
-- AGENT_SKILL_CREATED, AGENT_SKILL_REMOVED (ADR 0017 rewrite —
--   skill_manage create/write_file + Captain remove-action),
-- CUSTOMER_YAML_SYNCED, CUSTOMER_YAML_STRUCTURAL_CHANGE_DEFERRED
--   (ADR 0019 — customer-sync sidecar),
-- SUBAGENT_STOPPED, SUBAGENT_INCOMPLETE (ADR 0021 Stream C —
--   delegated subagent observability. SUBAGENT_STOPPED is emitted by
--   the overlay's hermes-smd-audit plugin on `subagent_stop` (one row
--   per child). SUBAGENT_INCOMPLETE is emitted by the PARENT skill
--   before refusing to assemble, when any subagent return fails the
--   assembly-time schema contract — the Devil's Advocate critique
--   safety constraint that the approver never sees a quietly
--   incomplete draft).
-- SUPPRESSED_WAKE (ADR 0021 Stream B — `pre_run.py` decides not to wake
--   the agent; emit BEFORE printing `wakeAgent: false`; audit-write
--   failure forces fallback to wake — see SuppressedWakeWriter).
-- EMITTED_WAKE (ss-console #2253 — the WAKE half of the same gate.
--   `pre_run.py` emits it on the real-decision wake path BEFORE printing
--   `wakeAgent: true`. Metadata mirrors SUPPRESSED_WAKE (inputs digest,
--   decision_basis, next_scheduled_at) plus plans_total / plans_emitted /
--   plans_truncated. Written BEST-EFFORT — the inverse contract to its
--   sibling: a suppress that cannot be audited escalates to a wake, but a
--   wake that cannot be audited still wakes. Not emitted on the fail-open
--   paths, which have no decision to record. With both types present, a
--   scheduled tick carrying NEITHER row is the dead-cron signal.
-- REPLY_SENT, REPLY_HELD, REPLY_FAILED (ADR 0055 — the Operator reply
--   channel; overlay hermes-smd-reply emits one row when it answers a
--   rostered colleague (SENT), holds the reply to draft (HELD: off-roster
--   sender, recipient mismatch, content floor, rate-limit, no inbox, empty
--   body), or the AgentMail send errors (FAILED). Metadata carries recipient
--   + message ids + reason + body_digest; never the body).

-- 2. Memory rules (hard rules; customer-defined)
CREATE TABLE memory_rules (
  id            TEXT PRIMARY KEY,           -- ULID
  rule_type     TEXT NOT NULL,              -- 'case_acceptance' | 'voice' | 'process' | 'scope' | 'escalation'
  category      TEXT,
  content       TEXT NOT NULL,
  source        TEXT NOT NULL,              -- 'direct_teach' | 'edit_inferred' | 'captain'
  source_ref    TEXT,                       -- audit_log.id
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_memory_rules_active ON memory_rules(rule_type, deleted_at);

-- 3. Person mappings
CREATE TABLE person_mappings (
  id            TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  role          TEXT NOT NULL,              -- 'partner' | 'paralegal' | 'client' | 'opposing_counsel' | ...
  email_addresses TEXT,                     -- JSON array
  external_ids  TEXT,                       -- JSON {"filevine": "...", "clio": "..."}
  firm_internal INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_person_active ON person_mappings(deleted_at);
CREATE INDEX idx_person_email ON person_mappings(email_addresses) WHERE deleted_at IS NULL;

-- 4. Skill state
CREATE TABLE skill_state (
  skill_name    TEXT PRIMARY KEY,
  trust_ceiling TEXT NOT NULL,              -- 'autonomous' | 'draft_for_review' | 'refused'
  content_hash  TEXT NOT NULL,
  activated_at  TEXT NOT NULL,
  last_run_at   TEXT,
  run_count     INTEGER NOT NULL DEFAULT 0,
  operator_may_approve INTEGER NOT NULL DEFAULT 0,  -- 0/1; principal-set per dashboard-roles.md
  config        TEXT                        -- JSON; per-skill params from customer.yaml
);

-- 5. Draft queue (pending review)
CREATE TABLE draft_queue (
  id            TEXT PRIMARY KEY,
  skill_name    TEXT NOT NULL,
  matter_ref    TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected' | 'expired'
  reviewed_at   TEXT,
  reviewed_by   TEXT,                       -- person_mappings.id
  r2_draft_key  TEXT NOT NULL,              -- R2 key per r2-vectorize-naming.md
  r2_sent_key   TEXT,
  priority      INTEGER NOT NULL DEFAULT 5,
  recipient_cohort_id TEXT                  -- FK voice cohort; for cost/voice analysis
);
CREATE INDEX idx_draft_pending ON draft_queue(status, priority, created_at) WHERE status = 'pending';

-- 6. Cost telemetry (per-day rollup; see cost-telemetry-events.md)
-- AMENDED 2026-07-03 (ADR 0062, #1660): tables 6 and 6a moved to the CENTRAL
-- ss-console D1 (migrations/0083_central_cost_telemetry.sql) with a
-- customer_slug tenant column. The per-customer copies below are historical
-- record; no new consumer may be designed against them.
CREATE TABLE cost_telemetry (
  date          TEXT NOT NULL,              -- YYYY-MM-DD
  driver        TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,
  units         REAL,
  unit_type     TEXT,
  PRIMARY KEY (date, driver)
);

-- 6a. Captain time events (event-sourced; rolls up into cost_telemetry per cost-telemetry-events.md)
-- Captain operations time is the one cost driver that is not auto-instrumented from a vendor API.
-- It is logged via the `crane operator log-time` CLI. Multiple events
-- per day per activity are expected (Captain may log two distinct calibration sessions in one
-- day); the table is intentionally not UPSERT-keyed.
CREATE TABLE captain_time_events (
  id            TEXT PRIMARY KEY,           -- ULID
  ts            TEXT NOT NULL,              -- ISO 8601 UTC of CLI invocation
  date          TEXT NOT NULL,              -- YYYY-MM-DD; --date flag, defaults to today UTC
  activity      TEXT NOT NULL,              -- enum from the activity-tag taxonomy
  minutes       INTEGER NOT NULL,           -- > 0 and ≤ 600
  amount_cents  INTEGER NOT NULL,           -- (minutes * 200 * 100) / 60 at $200/hr Captain rate
  note          TEXT                        -- optional free text, ≤ 280 chars
);
CREATE INDEX idx_captain_time_date ON captain_time_events(date);
CREATE INDEX idx_captain_time_activity ON captain_time_events(activity, date);

-- Each captain_time_events INSERT is paired with an UPSERT into cost_telemetry for the same
-- (date, 'captain_time') key so the §17.1 COGS/MRR rollup reads from a single view. See
-- cost-telemetry-events.md "Captain time logging" for the exact SQL.

-- 7. Invariant boot-check log
CREATE TABLE invariant_boot_checks (
  id            TEXT PRIMARY KEY,
  ts            TEXT NOT NULL,
  invariant_num INTEGER NOT NULL,           -- 1-8
  passed        INTEGER NOT NULL,           -- 0/1
  failure_detail TEXT
);
CREATE INDEX idx_boot_checks_ts ON invariant_boot_checks(ts DESC);

-- 8. Voice samples (D1 index over R2-stored markdown)
CREATE TABLE voice_samples (
  id            TEXT PRIMARY KEY,           -- ULID
  uploaded_at   TEXT NOT NULL,
  uploaded_by   TEXT NOT NULL,              -- person_mappings.id
  source        TEXT NOT NULL,              -- 'customer_upload' | 'bootstrap_scrape' | 'sent_folder'
  recipient_cohort_id TEXT,                 -- FK recipient_cohorts
  r2_key        TEXT NOT NULL,              -- per r2-vectorize-naming.md
  sanitized     INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  used_in_blind_test INTEGER NOT NULL DEFAULT 0,
  notes         TEXT
);
CREATE INDEX idx_voice_active ON voice_samples(active, recipient_cohort_id);

-- 9. Recipient cohorts (Layer 3 voice — v1)
CREATE TABLE recipient_cohorts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,       -- e.g. 'anxious-client' | 'opposing-counsel' | 'routine-vendor'
  description   TEXT,
  tone_descriptors TEXT,                    -- JSON array
  match_rules   TEXT NOT NULL,              -- JSON: how to route a recipient to this cohort
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- 10. Sent-folder watch state (per skill; opt-in)
CREATE TABLE sent_folder_state (
  skill_name    TEXT PRIMARY KEY,           -- one cursor per skill that watches sent folder
  enabled       INTEGER NOT NULL DEFAULT 0,
  last_cursor   TEXT,                       -- adapter-specific (Microsoft Graph deltaLink, etc.)
  last_checked_at TEXT,
  scope_snapshot TEXT NOT NULL              -- JSON: scope constraints at time of enablement
);

-- 11. Escalation events
CREATE TABLE escalation_events (
  id            TEXT PRIMARY KEY,
  ts            TEXT NOT NULL,
  trigger_skill TEXT NOT NULL,
  trigger_type  TEXT NOT NULL,              -- 'red_flag' | 'failure' | 'invariant_violation'
  recipients    TEXT NOT NULL,              -- JSON array of emails
  payload_digest TEXT NOT NULL,             -- SHA-256 of payload body (stored in R2)
  r2_payload_key TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT,                     -- person_mappings.id
  resolved_at   TEXT
);
CREATE INDEX idx_escalation_unacked ON escalation_events(acknowledged_at, ts) WHERE acknowledged_at IS NULL;
```

## Per-customer isolation

Cross-Machine query prohibition (invariant #7) is enforced at the **D1 binding layer**, not via row-level customer_id columns. Each Machine binds exactly one D1 database (`hermes-{slug}-d1`). The runtime verifies at boot that:

1. Exactly one D1 binding exists
2. The bound database name equals `hermes-{customer-slug}-d1` where `customer-slug` matches `customer.yaml.customer_id`

Boot-check failure → exit 3, writes `INVARIANT_7_VIOLATION` to stdout, refuses to serve any request. The check is logged to `invariant_boot_checks` only after the binding verification passes — if it fails, the Machine never reaches the D1 write phase.

## Failure modes

- **Migration drift** (Machine running an older schema than the one in `operator/migrations/`): boot-check inspects `PRAGMA user_version`; mismatch → exit 5, alert Captain. Migrations are forward-only — there is no rollback path because audit-log immutability would be violated.
- **D1 write quota exceeded** (Cloudflare paid plan: 50M writes/month per database): adapter returns `upstream_error`; degraded mode; Captain alerted. v1 customer profile is well under this ceiling.
- **Concurrent writes** to the same `draft_queue.id`: SQLite UNIQUE handles. Application-layer retry on conflict.
- **Audit-log delete attempt** (compromised process): D1 supports DELETE; we enforce immutability at the application layer by granting the agent runtime only INSERT permission on `audit_log` via Cloudflare D1 role-restricted bindings. Captain has DELETE permission for legally-mandated redactions only (per legal hold + retention policy in compliance-evidence-packet.md).

## Verification

1. **Migration test**: `tests/operator/d1-migrations.test.ts` runs the full migration sequence against an empty D1, asserts every table + index created, asserts `PRAGMA user_version` matches latest migration number.
2. **Boot-check test**: `tests/operator/d1-boot-check.test.ts` provisions a Machine with a deliberately-wrong D1 binding name; asserts boot exits 3 with `INVARIANT_7_VIOLATION`.
3. **Audit immutability test**: as the agent runtime user, attempt DELETE on audit_log; assert permission denied. As Captain, attempt DELETE; assert allowed.
4. **Quota smoke**: in CI, run 10k draft inserts against a fresh D1 in <60s (sanity check on D1 perf for heavy customer profile).

## Implementation notes

- Migrations at `operator/migrations/{NNNN}_{name}.sql`. Migration runner: `operator/adapter/run_migrations.py` (called by `provision-customer.sh` step 3). **Neither the runner nor the step exists — verified 2026-07-31 (#2091); no `hermes-*-d1` database is provisioned. Per ADR 0062 this set is historical. See `operator/migrations/README.md`.**
- D1 bindings declared per-Machine in `config/fly/hermes-template.toml`; substituted by `provision-customer.sh` with `customer-slug`.
- Audit-log INSERT-only role configured at the Cloudflare Worker binding level (not in D1 itself — D1 doesn't have per-role permissions yet). Worker enforces.
- ULIDs generated via `operator/adapter/ulid.py`; lexicographically sortable, suitable as PK with timestamp prefix.
- Heavy-write tables (`audit_log`, `cost_telemetry`) batched with 50ms write window to reduce D1 cost.

[AMBIGUITY: Cloudflare D1 currently does not support per-role permissions at the database level — INSERT-only enforcement happens in the Worker layer. If a compromised Worker bypasses that enforcement, audit-log immutability is broken. PRD §10.1 calls audit_log "immutable rows" but Tech Lead Risk flagged this. Decide: (a) accept Worker-layer enforcement as v1 sufficient + add Logpush mirror for compliance evidence, or (b) defer launch until D1 ships per-role permissions.]
