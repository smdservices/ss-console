-- Operator ⇄ Claude MCP connector — dynamic access grants (ADR 0057)
-- ============================================================================
-- The authoritative authorization layer and the kill switch for the Claude
-- connector. A firm employee authenticates via Clerk (email-link login to the
-- firm mailbox); that proves *identity*. This table decides *allowance*: who may
-- reach the Operator through Claude, and until when.
--
-- It is read LIVE on every MCP request (see loadMcpCustomer / resolvePrincipals
-- in src/lib/operator/mcp/customer-resolution.ts), so a revoked or expired grant
-- denies the very next call — independent of the Clerk access token's own 1-day
-- JWT TTL. That is why the kill switch is instant and needs no opaque tokens or
-- introspection: the JWT proves who, this table decides whether.
--
-- Two authorization paths coexist (union, OR):
--   1. authored mcp_connector.access[].clerk_subjects in customer.yaml (static).
--   2. a live grant row here (dynamic) — JIT-created under an "open" issuance
--      policy on first authenticated firm-domain connect, or seeded for an
--      "allowlist" policy. Authored entries are unaffected by this table.
--
-- INVARIANTS (ADR 0057):
--   - expires_at is NOT NULL: every grant is bounded. There is no "forever"
--     grant. Email-link re-auth (gated by the firm mailbox being live) is the
--     renewal; a killed mailbox cannot re-auth, so access lapses within the TTL.
--   - revoked_at set => the grant is dead immediately on the next request.
--
-- ISOLATION: control-plane D1 (per ADR 0007/0009), same as mcp_clerk_bindings.
-- customer_slug scopes every read; a grant never crosses tenants.
--
-- Refers to: docs/adr/0057-operator-claude-connector-access-model.md
-- ============================================================================

CREATE TABLE IF NOT EXISTS mcp_issued_grants (
  -- The customer (Operator seat) this grant authorizes access to. Scopes every
  -- read; matches mcp_clerk_bindings.customer_slug.
  customer_slug  TEXT NOT NULL,
  -- The Clerk subject (token `sub`) this grant authorizes. The validator matches
  -- the verified token's sub against live grants for the customer.
  clerk_user_id  TEXT NOT NULL,
  -- The verified email the grant was issued for (audit + open-policy provenance).
  email          TEXT NOT NULL,
  -- The persona/profile the authorized session runs as (matches an active
  -- persona slug, like mcp_connector.access[].profile).
  profile        TEXT NOT NULL,
  issued_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Hard expiry — NOT NULL by invariant. ISO-8601 UTC; lexicographic compare is
  -- chronological. A grant is live only while expires_at > now AND revoked_at IS
  -- NULL.
  expires_at     TEXT NOT NULL,
  -- Set to kill the grant immediately (the explicit revoke path). NULL = active.
  revoked_at     TEXT,
  -- One grant per (customer, Clerk subject); re-issue updates the same row.
  PRIMARY KEY (customer_slug, clerk_user_id)
);

-- The live-grant scan is keyed by customer_slug (the PK's leftmost column already
-- serves it); no additional index is required.
