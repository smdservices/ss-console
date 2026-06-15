-- Record the verified JWT audience for MCP authentication diagnostics.
-- The audience is a public OAuth identifier, not bearer-token material.
ALTER TABLE operator_mcp_audit ADD COLUMN token_audience TEXT;
