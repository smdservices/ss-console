-- ============================================================================
-- Migration 0003: Seed SMD Services organization record
-- ============================================================================
--
-- Creates the initial organization record for SMD Services.
-- This is the single-tenant org for the initial deployment.
--
-- ULID: 01JQFK0000SMDSERVICES000 (deterministic seed ID for reproducibility)
-- ============================================================================

INSERT INTO organizations (id, name, slug, domain, branding, settings)
VALUES (
  '01JQFK0000SMDSERVICES000',
  'SMD Services',
  'smd',
  'portal.smd.services',
  json('{"logo_url": null, "colors": {"primary": "#1a1a2e", "secondary": "#e94560"}, "fonts": {"heading": "Inter", "body": "Inter"}}'),
  json('{"default_rate": 150, "default_deposit_pct": 0.5, "payment_terms": "net_15", "milestone_threshold_hours": 40}')
);
