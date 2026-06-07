-- ============================================================================
-- Migration 0045: customer_config_history table (ADR 0022 Stream 3)
-- ============================================================================
--
-- Closes the second substrate gap that ADR 0022 §"Time-machine substrate
-- commitment" flagged as production-blocking: every CI / drift-repair /
-- manual / bootstrap sync of customer.yaml records a versioned event row
-- here so the materialization history is queryable independent of git.
--
-- Posture (pointer-only — Simplifier critique #2):
--   Rows are pointers, not snapshots. git_sha references the commit; the
--   full byte-level snapshot lives in git itself (the source-of-truth per
--   ADR 0012) and, optionally, in an R2 shadow at
--   `r2://customers/<slug>/history/<git_sha>.yaml` for durability insurance
--   against repo loss + post-transformation byte capture. The shadow
--   column is nullable: PR 3 ships the substrate; the actual shadow-write
--   path lives wherever the CI sync code lands.
--
-- Why a separate table from customer_configs:
--   customer_configs is single-row-per-customer (a read replica for the
--   live config). It answers "what is config NOW." The history table
--   answers "when did config CHANGE, and how was it sourced." Git knows
--   the commit timeline; the portal needs the sync-event timeline (which
--   includes drift-repair re-syncs at the same SHA, manual overrides at
--   the portal, and bootstrap events tied to Machine provisioning).
--
-- Write contract (the sync code path — wherever it lives — calls
-- `recordCustomerConfigSync` from src/lib/portal/customer-config.ts):
--   1. Load the latest history row for the slug.
--   2. shouldRecordSync(prev, current_git_sha, source) decides no-op.
--      The only case that records on identical git_sha is source =
--      'drift-repair' (re-sync recovering from out-of-band edits).
--   3. INSERT the history row.
--   4. (Optionally) PUT the R2 shadow at the documented key; failure
--      leaves r2_shadow_key = NULL and surfaces as a P2 admin alert.
--   5. UPSERT customer_configs (unchanged behavior).
--
-- Read contract:
--   /admin/operator/config-history/<customer_slug>.astro reads the last
--   20 rows ORDER BY synced_at DESC. Snapshot bytes are resolved on demand
--   via the GitHub API (`git show <sha>:<path>`) or, when the shadow
--   exists, via the R2 shadow URL.
--
-- Forward-only, additive. No drops.
--
-- Source spec: docs/specs/operator/customer-config-history.md
-- Refers to:   docs/adr/0022-vertical-pack-architecture.md §"Time-machine substrate commitment"
--              docs/adr/0012-customer-yaml-storage.md (the customer.yaml storage model this layers on)
--              docs/adr/0016-honcho-disposition.md (mirror-don't-gate posture)
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_config_history (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_slug        TEXT NOT NULL,

  -- The commit the projection was built from. Joining this back to git
  -- reconstructs the customer.yaml bytes that were live at that sync.
  git_sha              TEXT NOT NULL,

  -- When the sync event landed in this database. May differ from the git
  -- commit time (CI is typically minutes behind merge; manual/bootstrap
  -- syncs are not tied to a commit time at all).
  synced_at            TEXT NOT NULL,

  -- Which sync code path produced the row. Enforced as a CHECK so the
  -- substrate is structurally aligned with the SyncSource enum exported
  -- from src/lib/operator/customer-yaml (added in PR 1).
  synced_by            TEXT NOT NULL CHECK (synced_by IN (
    'manual', 'ci', 'drift-repair', 'bootstrap'
  )),

  -- Who initiated the sync, when known. NULL for fully automated sources
  -- (ci, bootstrap); populated as 'system:<job-name>' or '<user-email>'
  -- for manual and drift-repair. Distinct from synced_by because two
  -- different actors can both be flavor 'manual'.
  actor                TEXT,

  -- The git_sha of the immediately preceding history row for this slug,
  -- or NULL for the first sync. Lets the admin page walk the chain
  -- without a second query.
  prev_git_sha         TEXT,

  -- Optional R2 shadow key at `customers/<slug>/history/<git_sha>.yaml`.
  -- NULL when the shadow write was skipped or failed; admin page falls
  -- back to GitHub API for snapshot reconstruction in that case.
  r2_shadow_key        TEXT,

  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Most-recent-first scan for the admin config-history page.
CREATE INDEX IF NOT EXISTS idx_cch_slug_synced
  ON customer_config_history (customer_slug, synced_at DESC);

-- Direct lookup by SHA (for snapshot-bytes resolution and drift-cron joins).
CREATE INDEX IF NOT EXISTS idx_cch_slug_sha
  ON customer_config_history (customer_slug, git_sha);
