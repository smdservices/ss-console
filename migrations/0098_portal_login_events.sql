-- 0098: portal_login_events — durable sign-in history for client-facing
-- accountability, plus the users.last_clerk_session_id skip cache.
--
-- Clerk owns identity but never writes users.last_login_at; only the legacy
-- magic-link flow does, so the portal Team page has shown stale dates since
-- the 2026-05-25 Clerk unification. The console detects a genuinely new
-- sign-in via the UNIQUE index on clerk_session_id: an INSERT OR IGNORE that
-- reports changes > 0 is a session the console has never seen, and only then
-- does users.last_login_at get stamped. That makes detection idempotent under
-- same-session request races AND multi-device session alternation (a
-- last-seen-column compare would misfire on the latter).
--
-- Scope: ALL authenticated sign-ins land here, including admin-only users
-- routed through the post-sign-in dispatcher — those rows carry a NULL
-- entity_id. Client-facing feeds read entity-scoped, so admin-only rows
-- never surface in a portal Activity feed. Magic-link logins are recorded
-- with method='magic_link' and a NULL clerk_session_id (SQLite UNIQUE
-- permits multiple NULLs).
--
-- created_at is written by JS as ISO-8601 (no SQL default): the activity
-- feed union sorts via Date.parse, and SQLite's space-separated datetime
-- parses as local time off-Workers.

CREATE TABLE IF NOT EXISTS portal_login_events (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  entity_id         TEXT,
  email             TEXT NOT NULL,
  clerk_user_id     TEXT,
  clerk_session_id  TEXT,
  method            TEXT NOT NULL DEFAULT 'clerk' CHECK (method IN ('clerk', 'magic_link')),
  created_at        TEXT NOT NULL
);

-- The login detector. INSERT OR IGNORE against this index is the source of
-- truth for "have we seen this session before".
CREATE UNIQUE INDEX IF NOT EXISTS idx_login_events_session
  ON portal_login_events (clerk_session_id);

CREATE INDEX IF NOT EXISTS idx_login_events_entity
  ON portal_login_events (entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_events_user
  ON portal_login_events (user_id, created_at DESC);

-- Best-effort hot-path skip cache only: lets the request path skip the
-- INSERT attempt when the session id matches. The unique index above is the
-- truth; a stale cache value costs one no-op INSERT, never a duplicate row.
ALTER TABLE users ADD COLUMN last_clerk_session_id TEXT;
