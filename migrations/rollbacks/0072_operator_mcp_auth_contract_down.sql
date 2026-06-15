DROP INDEX IF EXISTS idx_operator_mcp_audit_subject_created;
DROP INDEX IF EXISTS idx_operator_mcp_audit_customer_created;
DROP TABLE IF EXISTS operator_mcp_audit;

DROP TRIGGER IF EXISTS require_mcp_clerk_binding_resource_uri_update;
DROP TRIGGER IF EXISTS require_mcp_clerk_binding_resource_uri_insert;
DROP INDEX IF EXISTS idx_mcp_clerk_bindings_resource_uri;
ALTER TABLE mcp_clerk_bindings DROP COLUMN resource_uri;
