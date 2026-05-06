-- Migration 0035: Restore users.role CHECK constraint to ('admin', 'client').
--
-- Reverses the CHECK-removal half of migration 0033. With Outside View
-- retired (0034), the role enum is back to the closed two-value set the
-- original schema enforced, and the "future role additions become zero-
-- migration" rationale no longer applies — there is no roadmap item that
-- needs a third role.
--
-- Pre-flight verification (run before applying):
--   npx wrangler d1 execute ss-console-db --remote --command \
--     "SELECT DISTINCT role FROM users"
--
-- All distinct values MUST be in ('admin', 'client'). Migration 0034 already
-- verified prospect=0 at retirement; reverify at apply time because
-- intervening time has passed.
--
-- FK ceremony (same as 0033). SQLite has no ALTER TABLE DROP/ADD CONSTRAINT,
-- so rebuilding `users` requires the full FK-chain dance:
--   sessions.user_id and magic_links.user_id REFERENCE users(id),
--   so SQLite refuses DROP TABLE users while either child holds rows.
--
-- Verified-working approach (mirrors 0033):
--   1. Drop the FKs from sessions and magic_links (recreate without REFERENCES users)
--   2. Recreate users WITH the CHECK constraint
--   3. Re-add the FKs (recreate sessions and magic_links with REFERENCES users restored)
--   4. Recreate all 7 indexes
--
-- D1 transaction semantics: wrangler wraps this file in a single atomic
-- transaction (verified empirically against the original 0033 failure).
-- Partial-apply leaving prod in a half-state is not a risk.
--
-- Three "obvious" fixes that don't work — same as 0033, documented for
-- future contributors who will inevitably try them:
--   1. PRAGMA foreign_keys = OFF is a no-op inside a transaction.
--   2. PRAGMA defer_foreign_keys = ON does not decrement SQLite's deferred-
--      violation counter when a parent table is dropped and recreated under
--      the same name. (We still set it because it's harmless and signals intent.)
--   3. PRAGMA writable_schema = ON is blocked by D1: SQLITE_AUTH error.
--
-- Manual-only rollback at migrations/rollbacks/0035_restore_users_role_check_down.sql.

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

-- Step 3: Recreate users WITH role CHECK constraint restored.
-- No children FK to users at this point, so DROP succeeds. Schema otherwise
-- matches the post-0001+0004+0018 layout exactly (same as 0033 step 3),
-- with CHECK added back at line marked below.
CREATE TABLE users_new (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'client')),
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
-- Names match prod sqlite_master exactly (verified via 0033 hotfix).
CREATE INDEX idx_users_entity ON users(org_id, entity_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_magic_links_org_email ON magic_links(org_id, email);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);
CREATE INDEX idx_magic_links_user_expires ON magic_links(user_id, expires_at);
