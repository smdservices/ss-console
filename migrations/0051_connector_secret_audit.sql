-- Connector secret-set audit — ADR 0042 §Verification 5
-- ============================================================================
--
-- Append-only record that a client entered a static secret for a connector via
-- the write-only entry path. Records WHO set WHAT connector's key, WHEN, the
-- masked tail, and the non-secret storage ref. There is deliberately NO column
-- for the value: the raw secret is structurally incapable of landing here.
--
-- This is the console-side control-plane record (analogous to
-- config_change_audit but a different event class — config_change_audit's
-- change_type CHECK is scoped to autonomy-config governance, not connector
-- credential entry, and is intentionally not widened). The per-customer runtime
-- audit log on the Machine is separate (ADR 0009).
--
-- Append-only by convention: no UPDATE/DELETE code path.
-- Forward-only, additive. No drops.
-- ============================================================================

CREATE TABLE IF NOT EXISTS connector_secret_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_slug   TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  -- Capability the secret authenticates (e.g. 'CourtAccess', 'CallTracking').
  connector       TEXT NOT NULL,
  -- Who entered it.
  actor_user_id   TEXT NOT NULL,
  actor_email     TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  -- The ONLY value-derived data: the masked tail (e.g. "••••••1a2b"). Never
  -- the raw value. No column exists that could hold it.
  masked_tail     TEXT NOT NULL,
  -- Non-secret storage pointer returned by the vault transport.
  storage_ref     TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_connector_secret_audit_slug_created
  ON connector_secret_audit (customer_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_secret_audit_entity_created
  ON connector_secret_audit (entity_id, created_at DESC);
