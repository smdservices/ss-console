/**
 * Open alerts stranded by the per-field NULL-hold.
 *
 * Every condition holds rather than resolving when its source field goes NULL —
 * a seat that stopped reporting has gone quiet, not recovered. The cost of that
 * correctness is that an alert can sit open with nothing left to evaluate it.
 * This query finds those, one LEFT JOIN, per-condition clauses hand-written
 * because each condition knows its own source column. No UI (four seats); the
 * runbook documents the manual-resolve UPDATE.
 *
 * Extracted from index.ts (ss#2234) to keep that file under its line ceiling,
 * the same move `token-expiry.ts` and `spec-control.ts` made. The `substr`
 * offsets are 1-indexed and point at the character after the prefix's colon.
 */

import type { StaleHold } from './index'

export async function getStaleHolds(db: D1Database): Promise<StaleHold[]> {
  const result = await db
    .prepare(
      `SELECT s.customer_slug AS customer_slug, s.condition AS condition
         FROM fleet_alert_state s
         LEFT JOIN fleet_status f ON f.customer_slug = s.customer_slug
        WHERE s.status = 'open'
          AND (
            f.customer_slug IS NULL
            OR (s.condition = 'scheduler_error' AND f.scheduler_ok IS NULL)
            OR (s.condition = 'work_overdue' AND f.scheduler_max_overdue_seconds IS NULL)
            OR (s.condition = 'heartbeat_red' AND f.last_heartbeat_ts IS NULL)
            OR (s.condition = 'hard_stop' AND f.sticky_stop_level IS NULL)
            OR (s.condition = 'connector_check_error' AND f.connector_check_ok IS NULL)
            OR (
              s.condition LIKE 'connector_down:%'
              AND (
                f.connectors_json IS NULL
                OR json_extract(f.connectors_json, '$."' || substr(s.condition, 16) || '"') IS NULL
              )
            )
            OR (
              s.condition LIKE 'connector_token_expiring:%'
              AND (
                f.connector_token_age_json IS NULL
                OR json_extract(f.connector_token_age_json, '$."' || substr(s.condition, 26) || '"') IS NULL
              )
            )
            OR (s.condition = 'spec_control_unprovable' AND f.spec_control_ok IS NULL)
            -- A spec_control_broken key that VANISHES from the map is not
            -- stranded: a withdrawn declaration auto-resolves through
            -- openSpecControlKeys. Only a whole-map NULL strands it, so this
            -- clause deliberately does not test the individual key.
            OR (s.condition LIKE 'spec_control_broken:%' AND f.spec_control_json IS NULL)
            OR (s.condition = 'webhook_surface_unprovable' AND f.webhook_surface_ok IS NULL)
            -- ss#2287, same shape as spec_control_broken above: a tool that
            -- merely vanishes from the map is a WITHDRAWN expectation and
            -- auto-resolves through openWebhookSurfaceKeys. Only a whole-map
            -- NULL strands it.
            OR (s.condition LIKE 'webhook_surface_missing:%' AND f.webhook_surface_json IS NULL)
          )
        ORDER BY s.customer_slug ASC, s.condition ASC`
    )
    .all<StaleHold>()
  return result.results ?? []
}
