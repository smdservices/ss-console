/**
 * Customer enumeration for the cost-anomaly worker.
 *
 * Reads the central `customer_configs` table and yields one row per
 * Operator customer with the entity_id needed for downstream alert
 * writes. Cost rows themselves live in the central `cost_telemetry`
 * table (ADR 0062, migration 0083); the per-customer D1 id this module
 * used to project from connectors_json is retired with the fan-out.
 *
 * Note the reserved cost_telemetry slugs '_org' and '_unmapped' are
 * excluded by construction: they have no customer_configs row, so they
 * never enter anomaly detection.
 */

export interface CustomerRow {
  customer_slug: string
  entity_id: string
}

export async function listCustomers(db: D1Database): Promise<CustomerRow[]> {
  const result = await db
    .prepare('SELECT customer_slug, entity_id FROM customer_configs')
    .all<CustomerRow>()
  return result.results ?? []
}
