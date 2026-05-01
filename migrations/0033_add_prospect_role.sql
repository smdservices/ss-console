-- Migration 0033 v2: Add 'prospect' role to users; drop role CHECK constraint.
--
-- Replaces the original 0033 (rejected by SQLite in two consecutive prod
-- deploys with FOREIGN KEY constraint failed [SQLITE_CONSTRAINT_FOREIGNKEY
-- 7500]). The original used the standard SQLite rename-recreate-copy-drop
-- pattern on `users` to widen the role CHECK constraint. SQLite refuses
-- DROP TABLE users while child rows hold FK references to it, and two child
-- tables do: sessions.user_id (migration 0006) and magic_links.user_id
-- (migration 0027).
--
-- D1 transaction semantics. Wrangler wraps each migration file in a single
-- atomic D1 transaction. Empirically verified: after the original 0033
-- failed at DROP TABLE users (which had created users_new and INSERTed
-- into it), querying prod for users_new returned no rows — the entire
-- transaction rolled back. So partial-apply leaving prod in a half-state
-- is not a risk. (This corrects the inaccurate "D1 does not transaction-
-- wrap" comment in the original 0033 header.)
--
-- Three "obvious" fixes were ruled out via local testing:
--   1. PRAGMA foreign_keys = OFF is a no-op inside a transaction (verified:
--      pragma_foreign_keys returns 1 mid-transaction). Unavailable since
--      D1 wraps every migration in a transaction.
--   2. PRAGMA defer_foreign_keys = ON does not decrement SQLite's deferred-
--      violation counter when a parent table is dropped and recreated
--      under the same name. COMMIT still fails. (We still set it below
--      because it's harmless and signals intent.)
--   3. PRAGMA writable_schema = ON is blocked by D1: SQLITE_AUTH error.
--
-- Verified-working approach: drop the FKs from sessions and magic_links
-- temporarily (recreate those tables without REFERENCES users), recreate
-- users with the new schema, then re-add the FKs (recreate sessions and
-- magic_links with REFERENCES users restored). Verified end-to-end
-- against a SQLite copy of the prod schema with FK enforcement on:
-- all row counts preserved, all 7 indexes recreated, prospect inserts
-- succeed, FKs intact post-migration. Verified nothing else FK-references
-- sessions or magic_links (no cascading FK chain).
--
-- Captain decision: drop the role CHECK constraint entirely. Future role
-- additions become zero-migration code-only changes. App-layer TypeScript
-- types already enforce role values at every insert site. Defense-in-depth
-- at the DB layer is traded for migration ergonomics — a worthwhile trade
-- in SQLite, which has no ALTER TABLE DROP CONSTRAINT and forces this
-- entire FK ceremony for every CHECK change.
--
-- Manual-only rollback. The companion down migration lives at
-- migrations/rollbacks/0033_add_prospect_role_down.sql so it does NOT
-- auto-apply (wrangler scans only the top-level migrations/ directory).
-- The original 0033 down was in migrations/ and would have auto-applied
-- right after a successful up, instantly reverting it.

PRAGMA defer_foreign_keys = ON;

-- Step 1: Drop FK from sessions to users (recreate sessions without
-- REFERENCES users). org_id REFERENCES organizations(id) is preserved.
CREATE TABLE sessions_tmp (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL,
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  role        TEXT NOT NULL,
  email       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO sessions_tmp (id, token, user_id, org_id, role, email, expires_at, created_at)
SELECT id, token, user_id, org_id, role, email, expires_at, created_at FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_tmp RENAME TO sessions;

-- Step 2: Drop FK from magic_links to users (same pattern). org_id FK preserved.
CREATE TABLE magic_links_tmp (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  user_id         TEXT NOT NULL,
  email           TEXT NOT NULL,
  token           TEXT NOT NULL UNIQUE,
  expires_at      TEXT NOT NULL,
  used_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO magic_links_tmp (id, org_id, user_id, email, token, expires_at, used_at, created_at)
SELECT id, org_id, user_id, email, token, expires_at, used_at, created_at FROM magic_links;
DROP TABLE magic_links;
ALTER TABLE magic_links_tmp RENAME TO magic_links;

-- Step 3: Recreate users WITHOUT role CHECK constraint (Captain decision).
-- No children FK to users at this point, so DROP succeeds. Schema otherwise
-- matches the post-0001+0004+0018 layout exactly.
CREATE TABLE users_new (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  password_hash   TEXT,
  entity_id       TEXT,
  UNIQUE(org_id, email)
);
INSERT INTO users_new (id, org_id, email, name, role, last_login_at, created_at, password_hash, entity_id)
SELECT id, org_id, email, name, role, last_login_at, created_at, password_hash, entity_id FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Step 4: Re-add FK from sessions to the new users table.
CREATE TABLE sessions_new (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  role        TEXT NOT NULL,
  email       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO sessions_new (id, token, user_id, org_id, role, email, expires_at, created_at)
SELECT id, token, user_id, org_id, role, email, expires_at, created_at FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

-- Step 5: Re-add FK from magic_links to the new users table.
CREATE TABLE magic_links_new (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  email           TEXT NOT NULL,
  token           TEXT NOT NULL UNIQUE,
  expires_at      TEXT NOT NULL,
  used_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO magic_links_new (id, org_id, user_id, email, token, expires_at, used_at, created_at)
SELECT id, org_id, user_id, email, token, expires_at, used_at, created_at FROM magic_links;
DROP TABLE magic_links;
ALTER TABLE magic_links_new RENAME TO magic_links;

-- Step 6: Recreate all 7 indexes that the rebuilds dropped.
-- Names match prod sqlite_master exactly (verified via wrangler d1 execute
-- --remote at hotfix authoring time).
CREATE INDEX idx_users_entity ON users(org_id, entity_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_magic_links_org_email ON magic_links(org_id, email);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);
CREATE INDEX idx_magic_links_user_expires ON magic_links(user_id, expires_at);
