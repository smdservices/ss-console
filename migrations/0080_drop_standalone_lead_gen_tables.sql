-- Migration 0080: Drop standalone lead-gen machine tables.
--
-- Part of the clean rip of the automated lead-generation
-- "scrape-score-enrich machine" (job-monitor + review-mining producers,
-- the enrichment pipeline, generator/pipeline config, and their admin UI).
-- Every reader of these tables was removed in the same PR; they are
-- machine-only and referenced by no surviving code.
--
-- This migration touches ONLY standalone machine tables. The shared client
-- spine (entities, context, contacts, outreach_events) is untouched — those
-- carry the A&P pilot record and all commercial data. The destructive work
-- on those shared tables (junk-row purge + inert-column drop) is a separate,
-- isolated migration applied after this PR soaks.
--
-- Production table state at teardown (verified live 2026-07-01):
--   lead_signals            rows: 0   (legacy; superseded by `entities`)
--   generator_config        rows: 2   (job_monitor, review_mining config)
--   pipeline_settings       rows: 0
--   pipeline_settings_audit rows: 0
--   enrichment_runs         present   (per-module enrichment telemetry)
--   places_lookup_cache     present   (Google Places reverse-address cache)
--   candidate_merge_log     present   (dedup near-miss review log)
--   scan_requests           already dropped by migration 0034 (excluded here)
--
-- No FK references these tables from surviving tables, so drop order is free.
--
-- Rollback: migrations/rollbacks/0080_drop_standalone_lead_gen_tables_down.sql
-- (manual-only, schema-only; restoring functionality requires reverting the
-- teardown PR — the tables are inert without the workers + pipeline code).

DROP TABLE IF EXISTS pipeline_settings_audit;
DROP TABLE IF EXISTS pipeline_settings;
DROP TABLE IF EXISTS generator_config;
DROP TABLE IF EXISTS enrichment_runs;
DROP TABLE IF EXISTS places_lookup_cache;
DROP TABLE IF EXISTS candidate_merge_log;
DROP TABLE IF EXISTS lead_signals;
