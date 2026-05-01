-- Migration 0033 ROLLBACK: Reverse the prospect-role + drop-CHECK changes.
--
-- WARNING: Manual-only. This file is in migrations/rollbacks/ specifically
-- so wrangler does NOT auto-apply it (wrangler scans only the top-level
-- migrations/ directory).
--
-- Run only if 0033 (up) caused a regression that required reverting the
-- schema. Coordinated with Captain.
--
-- Pre-condition: no users.role = 'prospect' rows exist. The narrow CHECK
-- restored in Step 3 will reject any prospect rows during the INSERT into
-- users_new, halting the rollback safely. To proceed past prospect rows:
--   1. Decide what to do with them (delete? convert to client?).
--   2. Manual cleanup: `DELETE FROM users WHERE role = 'prospect';`
--      (or `UPDATE users SET role = 'client' WHERE role = 'prospect';`).
--   3. Then re-run this rollback.
--
-- This rollback uses the same FK chain dance as the up migration. It must,
-- because dropping users while sessions/magic_links FKs reference it would
-- fail with the same FOREIGN KEY constraint failed error that broke the
-- original 0033.
--
-- Invocation:
--   npx wrangler d1 execute ss-console-db --remote \
--     --file migrations/rollbacks/0033_add_prospect_role_down.sql

PRAGMA defer_foreign_keys = ON;

-- Step 1: Drop FK from sessions to users.
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

-- Step 2: Drop FK from magic_links to users.
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

-- Step 3: Recreate users WITH the original narrow CHECK constraint.
-- The INSERT will FAIL by CHECK if any prospect rows exist — intentional
-- safeguard. Cleanup prospect rows manually before re-running this file.
CREATE TABLE users_old (
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
INSERT INTO users_old (id, org_id, email, name, role, last_login_at, created_at, password_hash, entity_id)
SELECT id, org_id, email, name, role, last_login_at, created_at, password_hash, entity_id FROM users;
DROP TABLE users;
ALTER TABLE users_old RENAME TO users;

-- Step 4: Re-add FK from sessions to the narrowed users table.
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

-- Step 5: Re-add FK from magic_links to the narrowed users table.
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

-- Step 6: Recreate all 7 indexes.
CREATE INDEX idx_users_entity ON users(org_id, entity_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_magic_links_org_email ON magic_links(org_id, email);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);
CREATE INDEX idx_magic_links_user_expires ON magic_links(user_id, expires_at);
