-- Operator client change-request inbox — ADR 0041 §4.3
-- ============================================================================
--
-- When a domain is SMD-operated (its authority switch is `managed`), the client
-- portal renders that domain Read + Request: read-only data plus a "Request a
-- change" path. This table is where those requests land; the admin change-
-- request inbox reads them.
--
-- This is a console-side control-plane table (like config_change_audit), NOT
-- per-customer runtime D1 — so the admin inbox legitimately reads across
-- customers (it is a fleet-wide SMD surface). It carries no runtime state and
-- no secrets; just the client's request text and its handling status.
--
-- `domain` is one of the switchable authority domains (a request only makes
-- sense for a domain the client cannot currently operate). Forward-only,
-- additive. No drops.
-- ============================================================================

CREATE TABLE IF NOT EXISTS operator_change_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id          TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  customer_slug      TEXT NOT NULL,
  -- The switchable authority domain the request concerns (e.g. 'people_access',
  -- 'connectors'). Validated in code against SWITCHABLE_AUTHORITY_DOMAINS.
  domain             TEXT NOT NULL,
  -- Who filed it (client-internal user).
  requested_by_user_id TEXT NOT NULL,
  requested_by_email   TEXT NOT NULL,
  -- The request text the client wrote.
  summary            TEXT NOT NULL,
  -- Handling status. 'open' on file; SMD moves it through the rest.
  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'acknowledged', 'resolved', 'declined')),
  -- Resolution metadata (set by SMD when handled).
  resolved_by_email  TEXT,
  resolved_at        TEXT,
  resolution_note    TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_operator_change_requests_slug_created
  ON operator_change_requests (customer_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_change_requests_status_created
  ON operator_change_requests (status, created_at DESC);
