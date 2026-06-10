/**
 * Service data access layer (ADR 0046, Stage 1).
 *
 * `services` is the polymorphic commercial spine — one row per "thing a client
 * bought." Consulting engagements and operator subscriptions are typed delivery
 * children that point UP at a service via `service_id`. See migrations 0068-0070.
 *
 * All queries are parameterized. Ids are `'svc_' + crypto.randomUUID()` — the
 * `svc_` prefix is a TRUE INVARIANT shared with the backfill (0069/0070), so it
 * can never be used to distinguish backfilled from runtime-created rows.
 *
 * IMPORTANT: the SOW-signature finalization batch (src/lib/sow/service-finalize.ts)
 * INLINES its own `INSERT INTO services` rather than calling `createService` —
 * it must stay inside one atomic `db.batch([...])`. Do NOT "DRY" the two
 * together; that would break the atomic engagement+invoice+service creation.
 */

export interface Service {
  id: string
  org_id: string
  entity_id: string
  /** Nullable: backfilled operator rows have no quote (operator quotes arrive in Stage 2). */
  quote_id: string | null
  type: ServiceType
  cadence: ServiceCadence
  status: ServiceStatus
  /** REAL to match invoices.amount/quotes.total_price. NULL for one_time; authored per-quote for operator. */
  recurring_price: number | null
  started_at: string | null
  ended_at: string | null
  created_at: string
  updated_at: string
}

export type ServiceType = 'consulting' | 'operator'
export type ServiceCadence = 'one_time' | 'recurring'
export type ServiceStatus = 'proposed' | 'active' | 'completed' | 'churned'

export const SERVICE_STATUSES: { value: ServiceStatus; label: string }[] = [
  { value: 'proposed', label: 'Proposed' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'churned', label: 'Churned' },
]

/**
 * Commercial-lifecycle transitions — deliberately coarser than the delivery
 * lifecycle on the child (engagement/subscription). `engagements.status` and
 * `subscriptions.status` remain authoritative; `services.status` is a rollup.
 */
export const SERVICE_VALID_TRANSITIONS: Record<ServiceStatus, ServiceStatus[]> = {
  proposed: ['active', 'churned'],
  active: ['completed', 'churned'],
  completed: [],
  churned: [],
}

/**
 * Project a consulting engagement's delivery status onto the commercial
 * rollup. MUST stay in lockstep with the CASE in
 * migrations/0069_service_spine_backfill_consulting.sql (asserted in tests).
 */
export function projectConsultingStatus(engagementStatus: string): ServiceStatus {
  switch (engagementStatus) {
    case 'completed':
      return 'completed'
    case 'cancelled':
      return 'churned'
    // scheduled | active | handoff | safety_net → a committed/live revenue line
    default:
      return 'active'
  }
}

/**
 * Project an operator subscription's status onto the commercial rollup. MUST
 * stay in lockstep with the CASE in
 * migrations/0070_service_spine_backfill_operator.sql (asserted in tests).
 */
export function projectOperatorStatus(subscriptionStatus: string): ServiceStatus {
  switch (subscriptionStatus) {
    case 'cancelled':
      return 'churned'
    // provisioning | active | paused → a committed/live revenue line
    default:
      return 'active'
  }
}

export interface CreateServiceData {
  entity_id: string
  type: ServiceType
  cadence: ServiceCadence
  quote_id?: string | null
  recurring_price?: number | null
  status?: ServiceStatus
  started_at?: string | null
}

export interface ServiceFilters {
  type?: ServiceType
  status?: ServiceStatus
}

export async function createService(
  db: D1Database,
  orgId: string,
  data: CreateServiceData
): Promise<Service> {
  const id = `svc_${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const status = data.status ?? 'proposed'

  await db
    .prepare(
      `INSERT INTO services (id, org_id, entity_id, quote_id, type, cadence, status, recurring_price, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      orgId,
      data.entity_id,
      data.quote_id ?? null,
      data.type,
      data.cadence,
      status,
      data.recurring_price ?? null,
      data.started_at ?? null,
      now,
      now
    )
    .run()

  const created = await getService(db, orgId, id)
  if (!created) {
    throw new Error(`Failed to create service ${id}`)
  }
  return created
}

export async function getService(
  db: D1Database,
  orgId: string,
  id: string
): Promise<Service | null> {
  return (
    (await db
      .prepare('SELECT * FROM services WHERE id = ? AND org_id = ?')
      .bind(id, orgId)
      .first<Service>()) ?? null
  )
}

export async function listServices(
  db: D1Database,
  orgId: string,
  filters?: ServiceFilters
): Promise<Service[]> {
  const conditions: string[] = ['org_id = ?']
  const params: (string | number)[] = [orgId]

  if (filters?.type) {
    conditions.push('type = ?')
    params.push(filters.type)
  }
  if (filters?.status) {
    conditions.push('status = ?')
    params.push(filters.status)
  }

  const result = await db
    .prepare(`SELECT * FROM services WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`)
    .bind(...params)
    .all<Service>()
  return result.results
}

export async function getServicesForEntity(
  db: D1Database,
  orgId: string,
  entityId: string
): Promise<Service[]> {
  const result = await db
    .prepare('SELECT * FROM services WHERE org_id = ? AND entity_id = ? ORDER BY created_at DESC')
    .bind(orgId, entityId)
    .all<Service>()
  return result.results
}

export async function updateServiceStatus(
  db: D1Database,
  orgId: string,
  serviceId: string,
  newStatus: ServiceStatus
): Promise<Service | null> {
  const existing = await getService(db, orgId, serviceId)
  if (!existing) {
    return null
  }

  const validNext = SERVICE_VALID_TRANSITIONS[existing.status] ?? []
  if (!validNext.includes(newStatus)) {
    throw new Error(
      `Invalid service status transition: ${existing.status} -> ${newStatus}. Valid transitions: ${validNext.join(', ') || 'none (terminal state)'}`
    )
  }

  // Terminal commercial states stamp ended_at.
  const stampEnded = newStatus === 'completed' || newStatus === 'churned'
  const updates = ['status = ?', "updated_at = datetime('now')"]
  const params: (string | number | null)[] = [newStatus]
  if (stampEnded) {
    updates.push('ended_at = ?')
    params.push(new Date().toISOString())
  }
  params.push(serviceId, orgId)

  await db
    .prepare(`UPDATE services SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`)
    .bind(...params)
    .run()

  return getService(db, orgId, serviceId)
}
