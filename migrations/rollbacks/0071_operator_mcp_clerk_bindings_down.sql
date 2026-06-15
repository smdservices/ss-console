-- Rollback for 0071_operator_mcp_clerk_bindings.sql — MANUAL, Captain-coordinated.
-- See migrations/rollbacks/README.md. Reverses the MCP connector data plane.
--
-- Safe to run: the MCP endpoint fail-closes when no binding row resolves, so
-- dropping these leaves the endpoint dark (401s everything) rather than broken.
-- D1 (modern SQLite) supports DROP COLUMN and DROP TABLE.

DROP INDEX IF EXISTS idx_mcp_clerk_bindings_slug;
DROP INDEX IF EXISTS idx_mcp_clerk_bindings_issuer;
DROP TABLE IF EXISTS mcp_clerk_bindings;

ALTER TABLE customer_configs DROP COLUMN mcp_connector_json;
