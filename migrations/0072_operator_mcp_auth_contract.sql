-- Expand the provisional binding in place so the pre-deploy application can
-- continue reading its legacy columns while migration and deployment are
-- sequenced. Runtime parsing and triggers make resource_uri required.
ALTER TABLE mcp_clerk_bindings ADD COLUMN resource_uri TEXT;

UPDATE mcp_clerk_bindings
SET resource_uri =
  'https://smd.services/api/operator/' || customer_slug || '/mcp';

CREATE UNIQUE INDEX idx_mcp_clerk_bindings_resource_uri
  ON mcp_clerk_bindings (resource_uri);

CREATE TRIGGER require_mcp_clerk_binding_resource_uri_insert
BEFORE INSERT ON mcp_clerk_bindings
WHEN NEW.resource_uri IS NULL OR NEW.resource_uri = ''
BEGIN
  SELECT RAISE(ABORT, 'mcp_clerk_bindings.resource_uri is required');
END;

CREATE TRIGGER require_mcp_clerk_binding_resource_uri_update
BEFORE UPDATE OF resource_uri ON mcp_clerk_bindings
WHEN NEW.resource_uri IS NULL OR NEW.resource_uri = ''
BEGIN
  SELECT RAISE(ABORT, 'mcp_clerk_bindings.resource_uri is required');
END;

CREATE TABLE operator_mcp_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id       TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  customer_slug   TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN ('auth', 'tool_call')),
  decision        TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  reason          TEXT NOT NULL,
  clerk_subject   TEXT,
  local_user_id   TEXT,
  profile         TEXT,
  tool            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_operator_mcp_audit_customer_created
  ON operator_mcp_audit (customer_slug, created_at DESC);

CREATE INDEX idx_operator_mcp_audit_subject_created
  ON operator_mcp_audit (clerk_subject, created_at DESC);
