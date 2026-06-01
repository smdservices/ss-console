/**
 * Customer enumeration for the cost-anomaly worker.
 *
 * Reads the central `customer_configs` + `entities` tables and yields one
 * row per Operator customer with the per-customer D1 database id and
 * entity_id needed for downstream alert writes. Mirrors the projection
 * the ss-cost-telemetry Worker does — kept separate so changes in one
 * worker do not couple to the other.
 */

export interface CustomerRow {
  customer_slug: string
  entity_id: string
  per_customer_d1_database_id: string | null
}

interface ConfigRow {
  customer_slug: string
  entity_id: string
  connectors_json: string | null
}

export async function listCustomers(db: D1Database): Promise<CustomerRow[]> {
  const result = await db
    .prepare('SELECT customer_slug, entity_id, connectors_json FROM customer_configs')
    .all<ConfigRow>()
  const out: CustomerRow[] = []
  for (const row of result.results ?? []) {
    let perCustomerDbId: string | null = null
    if (row.connectors_json) {
      try {
        const parsed = JSON.parse(row.connectors_json) as Record<string, unknown>
        const dbId = parsed['per_customer_d1_database_id']
        if (typeof dbId === 'string' && dbId.length > 0) perCustomerDbId = dbId
      } catch {
        // Malformed connectors_json — projection layer's problem, not ours.
        // Treated as "no per-customer DB" so the row is skipped with a logged
        // reason rather than crashing the run.
      }
    }
    out.push({
      customer_slug: row.customer_slug,
      entity_id: row.entity_id,
      per_customer_d1_database_id: perCustomerDbId,
    })
  }
  return out
}
