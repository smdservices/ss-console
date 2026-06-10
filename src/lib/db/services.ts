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
 *
 * READ-MIGRATION STATUS (ADR 0046, as of Stage 1b):
 * - Consulting services have a real forward writer (SOW finalize + the manual
 *   `createEngagement` path), so the consulting spine is authoritative. Stage 1b
 *   makes it READ + self-validating via `findConsultingSpineDrift` below; the
 *   full render-migration of the admin surfaces (client hub, services list) is
 *   deferred to Stage 3 so it lands once for BOTH delivery types together.
 * - Operator services currently have NO forward writer — the Stage 1 backfill
 *   (migration 0070) sourced them from the legacy `subscriptions` table (no
 *   `INSERT` in src; pre-Hermes-realignment), while the live operator registry
 *   is `customer_configs` (src/lib/portal/customer-config-projection.ts). So the
 *   operator UI still reads `customer_configs`/the fleet roster, NOT this spine.
 *   Operator-service creation on provisioning is Stage 3 (bounded by ADR 0012);
 *   only then does the operator UI migrate to the spine. Do not iterate the
 *   operator spine for display before that — it would silently drop any operator
 *   provisioned after the backfill.
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

// ===========================================================================
// Spine reconciliation (ADR 0046, Stage 1b)
// ===========================================================================

/** A consulting engagement that has no valid parent service row. */
export interface OrphanEngagement {
  id: string
  status: string
  /** NULL (never linked) or a dangling id pointing at no service row. */
  service_id: string | null
}

/** An active consulting service that has no delivery child. */
export interface ChildlessService {
  id: string
  status: string
}

/**
 * The two ways the consulting spine ↔ child invariant can break. Both lists
 * empty is the healthy state (the normal case).
 */
export interface ConsultingSpineDrift {
  /** In-flight engagements whose `service_id` is NULL or points at no service. */
  orphanEngagements: OrphanEngagement[]
  /** Active consulting services with no engagement pointing back at them. */
  childlessServices: ChildlessService[]
}

/** In-flight consulting engagement statuses — those expected to have a live parent. */
const IN_FLIGHT_ENGAGEMENT_STATUSES = ['scheduled', 'active', 'handoff', 'safety_net']

/**
 * Reconcile the consulting spine against its engagement children (ADR 0046,
 * Stage 1b). This is the READ that makes the otherwise write-only spine
 * load-bearing: the services list calls it on every load and surfaces drift,
 * so any future code path that creates an engagement without a service (or a
 * service without an engagement) fails loud instead of rotting silently.
 *
 * Scoped to consulting only — operator services have no forward writer yet
 * (see the file header), so reconciling them would flag false positives.
 */
export async function findConsultingSpineDrift(
  db: D1Database,
  orgId: string
): Promise<ConsultingSpineDrift> {
  const placeholders = IN_FLIGHT_ENGAGEMENT_STATUSES.map(() => '?').join(', ')

  const [orphans, childless] = await Promise.all([
    db
      .prepare(
        `SELECT e.id, e.status, e.service_id
           FROM engagements e
          WHERE e.org_id = ?
            AND e.status IN (${placeholders})
            AND (
              e.service_id IS NULL
              OR e.service_id NOT IN (SELECT s.id FROM services s WHERE s.org_id = ?)
            )`
      )
      .bind(orgId, ...IN_FLIGHT_ENGAGEMENT_STATUSES, orgId)
      .all<OrphanEngagement>(),
    db
      .prepare(
        `SELECT s.id, s.status
           FROM services s
          WHERE s.org_id = ?
            AND s.type = 'consulting'
            AND s.status = 'active'
            AND s.id NOT IN (
              SELECT e.service_id FROM engagements e
               WHERE e.org_id = ? AND e.service_id IS NOT NULL
            )`
      )
      .bind(orgId, orgId)
      .all<ChildlessService>(),
  ])

  return {
    orphanEngagements: orphans.results,
    childlessServices: childless.results,
  }
}

/** True when either drift class is non-empty. */
export function hasSpineDrift(drift: ConsultingSpineDrift): boolean {
  return drift.orphanEngagements.length > 0 || drift.childlessServices.length > 0
}
