-- Multi-user matter handling substrate (per #882)
-- ============================================================================
--
-- Adds the three tables the multi-paralegal firm UX needs:
--
--   1. matter_assignments        — which user "owns" a given matter today
--   2. user_pto                  — per-user OOO state + optional backup user
--   3. user_notification_prefs   — per-user notification routing rules
--
-- All three live on the portal D1 (not the per-customer Hermes D1) for the
-- same reason `product_roles` does: identity-axis state belongs near the
-- session resolver, not the per-customer agent runtime.  The Hermes-side
-- bridge (#821) reads these tables on every routing decision to decide which
-- assignee / backup the next inbound action lands with, and which subset of
-- the team is notified.
--
-- Matter IDs are foreign to the portal (the matter row itself lives on the
-- Hermes D1 per ADR 0007 + 0009).  We do not enforce a foreign key — instead
-- the `entity_id` + `matter_id` tuple is treated as opaque, and the row is
-- soft-cleared (`unassigned_at`) rather than deleted on matter close so the
-- audit trail of "who held this matter when" survives.
--
-- Forward-only, additive.  No drops.
-- ============================================================================

-- ---------- matter_assignments ----------
-- One row per (entity, matter, user) assignment cycle.  A matter may be
-- reassigned over its lifetime; each (assign, unassign) pair appends new
-- rows rather than mutating the prior — preserves the "who held this matter
-- when" audit trail.  The "currently assigned" set is the rows whose
-- `unassigned_at IS NULL`.
--
-- A matter MAY be assigned to multiple users simultaneously (collaborative
-- co-counsel pattern) — the UNIQUE constraint is per (entity, matter, user,
-- active-row), enforced by the partial unique index below.  Re-assigning a
-- matter that already has an active row for that user is a no-op (see
-- assignMatter() in src/lib/portal/operator/matter-assignment.ts).
CREATE TABLE IF NOT EXISTS matter_assignments (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),

  -- Opaque matter identifier.  Owned by the per-customer Hermes D1.  No
  -- FK reference because the row is unreachable from the portal Worker.
  matter_id       TEXT NOT NULL,

  -- The assigned user (paralegal, principal, etc.).  REFERENCES users so a
  -- soft-deleted user row cleans up cleanly via the existing user mgmt
  -- flow.  This is the user the Operator routes inbound actions to.
  assignee_user_id TEXT NOT NULL REFERENCES users(id),

  assigned_by     TEXT REFERENCES users(id),
  assigned_at     TEXT NOT NULL DEFAULT (datetime('now')),

  -- Soft-delete via unassigned_at.  Preserves the audit trail; the
  -- "currently assigned" predicate is `unassigned_at IS NULL`.
  unassigned_at   TEXT,
  unassigned_by   TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_matter_assignments_entity_matter
  ON matter_assignments(entity_id, matter_id) WHERE unassigned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_matter_assignments_assignee
  ON matter_assignments(assignee_user_id, entity_id) WHERE unassigned_at IS NULL;

-- Partial unique index: a given user holds at most one ACTIVE assignment
-- per (entity, matter).  Re-grant of an already-held assignment is a no-op.
-- Re-assigning after unassign succeeds (the prior row is soft-deleted so
-- this index does not match it).
CREATE UNIQUE INDEX IF NOT EXISTS idx_matter_assignments_unique_active
  ON matter_assignments(entity_id, matter_id, assignee_user_id)
  WHERE unassigned_at IS NULL;

-- ---------- user_pto ----------
-- Per-user away state.  A user with an active row in this table is "away";
-- the Hermes routing layer reads this table on every inbound action and,
-- when present, routes to the backup user (if any).  A user has at most
-- one active PTO row at a time — the partial unique index enforces this.
--
-- Designed for self-service: the user themselves marks themselves away.
-- Principals MAY also mark another user away via the principal-managed
-- branch in src/lib/portal/operator/pto.ts (see set_by column).  Both
-- cases emit an `audit:rbac_event` with subAction='pto_set'.
--
-- The backup user (nullable) is recommended but not required — a PTO row
-- without a backup leaves the routing decision to the principal at handoff
-- time.  The Hermes routing layer treats a null-backup PTO as "queue the
-- action without auto-routing" rather than fabricating a substitute.
CREATE TABLE IF NOT EXISTS user_pto (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  user_id         TEXT NOT NULL REFERENCES users(id),

  -- Optional backup user.  When the routing layer sees an inbound action
  -- destined for `user_id` and an active PTO row, it re-routes to
  -- `backup_user_id` if set.  When null, the action queues without
  -- auto-routing (the principal handles it at standup).  REFERENCES the
  -- same users table; the backup must hold a product_role on (entity,
  -- 'operator') — that check is enforced by set_pto() in pto.ts, not
  -- the schema.
  backup_user_id  TEXT REFERENCES users(id),

  set_by          TEXT NOT NULL REFERENCES users(id),
  set_at          TEXT NOT NULL DEFAULT (datetime('now')),

  -- Soft-delete via cleared_at.  Preserves the audit trail of when the
  -- user was away — useful for backfilling "the AI routed Smith v. Co. to
  -- you on the 14th because Alex was out" explanations.
  cleared_at      TEXT,
  cleared_by      TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_pto_active
  ON user_pto(user_id, entity_id) WHERE cleared_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_pto_unique_active
  ON user_pto(user_id, entity_id) WHERE cleared_at IS NULL;

-- ---------- user_notification_prefs ----------
-- Per-user notification routing rules.  Mirrors the closed NotificationType
-- vocabulary from src/lib/portal/operator/notifications.ts plus a
-- per-event-scope axis ('mine' = matters assigned to this user only;
-- 'all' = every matter on the firm).
--
-- A user with NO row in this table receives the default routing (every
-- event for every matter — the legacy single-user behavior).  Once the user
-- writes their first preference row, the resolver in notification-prefs.ts
-- treats the row set as authoritative: any (event_type, scope) tuple
-- absent from the user's row set is treated as opted-out.  This is the
-- "don't notify everyone for everything" AC from #882: opting in is
-- per-user, per-event-type, per-scope.
--
-- The schema does NOT pick the defaults for the user — that decision belongs
-- to the seeding flow on first sign-in (handled in the Settings → Notifications
-- page form post; see notification-prefs.ts).  Schema-side: a row is a
-- positive opt-in.
CREATE TABLE IF NOT EXISTS user_notification_prefs (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  user_id         TEXT NOT NULL REFERENCES users(id),

  -- Event type vocabulary mirrors NotificationType in
  -- src/lib/portal/operator/notifications.ts:
  --   'draft_ready' | 'error' | 'calibration_prompt' | 'weekly_digest'
  event_type      TEXT NOT NULL,

  -- Scope: 'mine' = only matters assigned to this user;
  --        'all'  = every matter on the firm.
  scope           TEXT NOT NULL CHECK (scope IN ('mine', 'all')),

  -- ISO 8601 UTC timestamp.  Updated on upsert so the audit log can read
  -- "when did Alex opt out of weekly digests?" off the most recent row.
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (user_id, entity_id, event_type, scope)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_user_entity
  ON user_notification_prefs(user_id, entity_id);
