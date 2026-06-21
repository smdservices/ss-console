-- Rollback for 0074_drop_matter_substrate.sql — recreates the three tables
-- exactly as 0043 created them. MANUAL ONLY: do not place in migrations/ (wrangler
-- would auto-apply it right after the up migration — see this dir's README.md).
-- ============================================================================

-- ---------- matter_assignments ----------
CREATE TABLE IF NOT EXISTS matter_assignments (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  matter_id       TEXT NOT NULL,
  assignee_user_id TEXT NOT NULL REFERENCES users(id),
  assigned_by     TEXT REFERENCES users(id),
  assigned_at     TEXT NOT NULL DEFAULT (datetime('now')),
  unassigned_at   TEXT,
  unassigned_by   TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_matter_assignments_entity_matter
  ON matter_assignments(entity_id, matter_id) WHERE unassigned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_matter_assignments_assignee
  ON matter_assignments(assignee_user_id, entity_id) WHERE unassigned_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_matter_assignments_unique_active
  ON matter_assignments(entity_id, matter_id, assignee_user_id)
  WHERE unassigned_at IS NULL;

-- ---------- user_pto ----------
CREATE TABLE IF NOT EXISTS user_pto (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  backup_user_id  TEXT REFERENCES users(id),
  set_by          TEXT NOT NULL REFERENCES users(id),
  set_at          TEXT NOT NULL DEFAULT (datetime('now')),
  cleared_at      TEXT,
  cleared_by      TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_pto_active
  ON user_pto(user_id, entity_id) WHERE cleared_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_pto_unique_active
  ON user_pto(user_id, entity_id) WHERE cleared_at IS NULL;

-- ---------- user_notification_prefs ----------
CREATE TABLE IF NOT EXISTS user_notification_prefs (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  event_type      TEXT NOT NULL,
  scope           TEXT NOT NULL CHECK (scope IN ('mine', 'all')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, entity_id, event_type, scope)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_user_entity
  ON user_notification_prefs(user_id, entity_id);
