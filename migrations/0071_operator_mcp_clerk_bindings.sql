-- MCP connector data plane — Operator ⇄ Claude connector (Phase 1)
-- ============================================================================
-- Two additions, both consumed by the console-hosted MCP endpoint
-- (src/pages/api/mcp.ts) when it validates a Clerk OAuth token and resolves the
-- customer the token was issued for:
--
--   1. customer_configs.mcp_connector_json — the projected `mcp_connector` block
--      (enabled / data_posture / access[]) from customer.yaml. Authored content,
--      git source of truth (ADR 0012), projected by customer-config-projection.ts
--      exactly like every other customer_configs column. NULLABLE: a row that
--      predates this column, or a customer.yaml with no mcp_connector block,
--      resolves on read to the fail-closed default (disabled, empty access).
--
--   2. mcp_clerk_bindings — the per-customer Clerk OAuth binding. This is
--      provisioning OUTPUT, not customer.yaml content: it is produced when the
--      Clerk OAuth application is created for the customer (oauthApplications
--      .create, a Worker-side action) and has no home in the git-sourced config.
--      The MCP token validator reads it to (a) DERIVE which customer a verified
--      token is for — `aud`-primary, per-customer `iss`-fallback, security
--      invariant F1 — and (b) pin the customer's issuer / azp. NO client secret
--      is stored: the console is an OAuth RESOURCE server and verifies tokens via
--      the issuer JWKS (public key); a public PKCE client has no secret to keep.
--
-- ISOLATION: both live on the console control-plane D1, NOT per-customer runtime
-- D1 (ADR 0007/0009). mcp_clerk_bindings is the cross-tenant wall —
-- resolveCustomerFromClaims gates on it before any per-user authz or data access.
--
-- Refers to: docs/design/operator/03-mcp-server-exposure.md
--            docs/design/operator/mcp-clerk-setup.md (§6 audience binding)
--            docs/adr/0012-customer-yaml-storage.md (git source of truth)
-- ============================================================================

ALTER TABLE customer_configs ADD COLUMN mcp_connector_json TEXT;

CREATE TABLE IF NOT EXISTS mcp_clerk_bindings (
  -- The customer this binding belongs to. entity_id is the customer_configs PK,
  -- the join key the validator uses to read the projected mcp_connector block.
  entity_id      TEXT PRIMARY KEY,
  -- Customer slug — human-readable audit + the customerId the endpoint surfaces
  -- to a tool handler.
  customer_slug  TEXT NOT NULL,
  -- Clerk instance issuer; the token `iss` MUST equal this exactly. Shared
  -- across OAuth apps within one Clerk instance, so `iss` alone identifies the
  -- customer only when each customer has its own instance; otherwise `audience`
  -- (RFC 8707) / `client_id` (azp) disambiguate.
  issuer         TEXT NOT NULL,
  -- The OAuth app client id; the token `azp` MUST be in this set when present.
  -- NULLABLE: most MCP clients (claude.ai included) self-register via Dynamic
  -- Client Registration, so their client id is dynamic and unknown to us — the
  -- azp check is skipped and isolation rests on issuer + the consent screen +
  -- the per-user access[] gate. Set only for a pre-registered OAuth app.
  client_id      TEXT,
  -- The resource-bound audience (RFC 8707) when Clerk emits one, else NULL
  -- (issuer-keyed fallback). See mcp-clerk-setup.md §6.
  audience       TEXT,
  -- The Clerk OAuth application id (oauth_app_...) when we pre-created one;
  -- NULL under Dynamic Client Registration (no app we own). Provenance only.
  clerk_app_id   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- iss is always present on a verified token; index it for the resolution read.
CREATE INDEX IF NOT EXISTS idx_mcp_clerk_bindings_issuer
  ON mcp_clerk_bindings (issuer);

-- One binding per customer slug.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_clerk_bindings_slug
  ON mcp_clerk_bindings (customer_slug);
