/**
 * Parking lot data access layer.
 *
 * Per Decision Stack #11 (Scope Creep Protocol): out-of-scope client requests
 * captured during an engagement, then dispositioned at the pre-handoff review
 * as fold_in / follow_on / dropped. Items are immutable once created — the
 * description doesn't change after the fact; corrections are made by deleting
 * + re-logging.
 *
 * Schema note: parking_lot has NO `org_id` column (unlike milestones). Org
 * scoping is enforced by JOINing through `engagements.org_id` on every read,
 * and by the endpoint layer pre-validating engagement ownership before any
 * write. Cross-org reads return null/empty (no enumeration leak) rather than
 * throwing — same convention as `getMilestone`.
 *
 * All queries are parameterized to prevent SQL injection.
 */

export type Disposition = 'fold_in' | 'follow_on' | 'dropped'

export const DISPOSITIONS: Disposition[] = ['fold_in', 'follow_on', 'dropped']

export interface ParkingLotItem {
  id: string
  engagement_id: string
  description: string
  requested_by: string | null
  requested_at: string
  disposition: Disposition | null
  disposition_note: string | null
  reviewed_at: string | null
  follow_on_quote_id: string | null
  created_at: string
}

export interface CreateParkingLotData {
  description: string
  requested_by?: string | null
}

/**
 * List parking lot items for an engagement, oldest first.
 * Scoped to the caller's org via JOIN to prevent cross-tenant reads.
 */
export async function listParkingLot(
  db: D1Database,
  orgId: string,
  engagementId: string
): Promise<ParkingLotItem[]> {
  const result = await db
    .prepare(
      `SELECT pl.* FROM parking_lot pl
       INNER JOIN engagements e ON e.id = pl.engagement_id
       WHERE pl.engagement_id = ? AND e.org_id = ?
       ORDER BY pl.created_at ASC`
    )
    .bind(engagementId, orgId)
    .all<ParkingLotItem>()
  return result.results
}

/**
 * Get a single parking lot item by ID, scoped to the caller's org via JOIN.
 * Returns null (not 403) when the item exists but belongs to a different org,
 * to prevent tenant enumeration.
 */
export async function getParkingLotItem(
  db: D1Database,
  orgId: string,
  itemId: string
): Promise<ParkingLotItem | null> {
  const result = await db
    .prepare(
      `SELECT pl.* FROM parking_lot pl
       INNER JOIN engagements e ON e.id = pl.engagement_id
       WHERE pl.id = ? AND e.org_id = ?`
    )
    .bind(itemId, orgId)
    .first<ParkingLotItem>()
  return result ?? null
}

/**
 * Create a new parking lot item linked to an engagement. Returns the created
 * record. The caller MUST validate engagement ownership before invoking.
 */
export async function createParkingLotItem(
  db: D1Database,
  orgId: string,
  engagementId: string,
  data: CreateParkingLotData
): Promise<ParkingLotItem> {
  const id = crypto.randomUUID()

  await db
    .prepare(
      `INSERT INTO parking_lot (id, engagement_id, description, requested_by)
       VALUES (?, ?, ?, ?)`
    )
    .bind(id, engagementId, data.description, data.requested_by ?? null)
    .run()

  const item = await getParkingLotItem(db, orgId, id)
  if (!item) {
    throw new Error('Failed to retrieve created parking lot item')
  }
  return item
}

/**
 * Set or replace the disposition + note on an item. Stamps reviewed_at to
 * now(). Idempotent — re-dispositioning replaces both fields and refreshes
 * reviewed_at. Returns null if the item is not in the caller's org.
 */
export async function dispositionParkingLotItem(
  db: D1Database,
  orgId: string,
  itemId: string,
  disposition: Disposition,
  note: string
): Promise<ParkingLotItem | null> {
  const existing = await getParkingLotItem(db, orgId, itemId)
  if (!existing) return null

  await db
    .prepare(
      `UPDATE parking_lot
       SET disposition = ?, disposition_note = ?, reviewed_at = ?
       WHERE id = ?`
    )
    .bind(disposition, note, new Date().toISOString(), itemId)
    .run()

  return getParkingLotItem(db, orgId, itemId)
}

/**
 * Delete a parking lot item. Only allowed when disposition IS NULL — once
 * dispositioned, the item is part of the audit trail and stays. Returns
 * 'not_found' for cross-org or missing items, 'dispositioned' if the caller
 * tried to delete a dispositioned row, 'ok' on success.
 */
export async function deleteParkingLotItem(
  db: D1Database,
  orgId: string,
  itemId: string
): Promise<'ok' | 'not_found' | 'dispositioned'> {
  const existing = await getParkingLotItem(db, orgId, itemId)
  if (!existing) return 'not_found'
  if (existing.disposition !== null) return 'dispositioned'

  await db.prepare('DELETE FROM parking_lot WHERE id = ?').bind(itemId).run()
  return 'ok'
}
