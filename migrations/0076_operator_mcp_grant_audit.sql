-- Operator ⇄ Claude MCP connector — grant lifecycle audit ledger (ADR 0057)
-- ============================================================================
-- The append-only, immutable record of every access-grant issue and revoke on
-- the Claude connector. `mcp_issued_grants` (migration 0075) is the LIVE state
-- and is mutated in place (re-issue overwrites the row, revoke flips a column),
-- so the row itself is not an audit trail. This table is.
--
-- Every adminIssueGrant / revokeGrant (and, later, every JIT auto-issue) writes
-- one row here capturing WHO acted (the SMD admin `actor`, or the system for a
-- JIT mint), WHAT they did (`action`), for WHICH principal, with what TTL/expiry,
-- and WHEN. A law firm's access record must be reconstructable from an immutable
-- log even after the live grant row has been overwritten or deleted — this is
-- that log. Rows are never updated or deleted.
--
-- Distinct from operator_mcp_audit (request-time auth/tool_call events, whose
-- CHECK constraint is fixed to those two types) — grant lifecycle is a different
-- shape (it carries an admin actor and a TTL), so it gets its own ledger.
--
-- ISOLATION: control-plane D1 (per ADR 0007/0009). `customer_slug` scopes every
-- read; `entity_id` FK cascades with the entity.
--
-- Refers to: docs/adr/0057-operator-claude-connector-access-model.md
-- ============================================================================

CREATE TABLE operator_mcp_grant_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id     TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  customer_slug TEXT NOT NULL,
  -- 'issue' (admin or JIT mint) | 'revoke' (the explicit kill).
  action        TEXT NOT NULL CHECK (action IN ('issue', 'revoke')),
  -- The Clerk subject the grant authorizes (the grantee).
  clerk_user_id TEXT NOT NULL,
  email         TEXT NOT NULL,
  profile       TEXT,
  -- Bounded TTL the grant was issued with (issue events); NULL on revoke.
  ttl_days      INTEGER,
  -- The concrete expiry the grant resolved to (issue events); NULL on revoke.
  expires_at    TEXT,
  -- WHO performed the action: the SMD admin's email, or 'system:jit' for an
  -- open-policy auto-issue (slice 2e). Never null — every grant change has an
  -- accountable actor.
  actor         TEXT NOT NULL,
  reason        TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_operator_mcp_grant_audit_customer_created
  ON operator_mcp_grant_audit (customer_slug, created_at DESC);

CREATE INDEX idx_operator_mcp_grant_audit_subject_created
  ON operator_mcp_grant_audit (clerk_user_id, created_at DESC);
