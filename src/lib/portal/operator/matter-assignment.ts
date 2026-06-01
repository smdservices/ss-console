/**
 * Matter assignment — read + write helpers for multi-paralegal firms (#882).
 *
 * Matters live on the per-customer Hermes Machine D1 (ADR 0007 + 0009);
 * assignments are an identity-axis concern and live on the portal D1
 * alongside `product_roles` so the session resolver and the principal-
 * managed Users page can both read and mutate them without crossing the
 * Hermes bridge.
 *
 * Routing semantics: when Hermes processes an inbound matter event, it
 * reads `matter_assignments` to learn which user "owns" the matter today
 * and routes the action to that user (after consulting `user_pto` to
 * resolve away-state).  A matter with no active assignment falls back to
 * the firm's principals — the same legacy behavior as before #882.
 *
 * Idempotency: granting an already-active assignment is a no-op (returns
 * false).  Unassigning a non-existent or already-cleared assignment is
 * also a no-op (returns false).  A successful state change returns true
 * so callers can decide whether to emit audit.
 *
 * Authorization is the caller's responsibility — these helpers do NOT
 * verify roles.  The API endpoints check that the actor holds a
 * `principal` or `operator` role before invoking; the API also captures
 * the actor so the audit emission has a faithful identity.
 *
 * The matter_id is treated as opaque — we never query the Hermes D1 to
 * validate it exists.  An invalid matter_id silently fails the routing
 * check at runtime, which is the right failure mode (the matter id space
 * is owned by Hermes; the portal cannot meaningfully validate without
 * crossing the bridge that #821 ships).
 */

/**
 * One row from `matter_assignments` projected for portal consumption.
 * The portal renders these on the Matter detail page and uses them
 * server-side to scope the "my matters" filter on the list page.
 */
export interface MatterAssignment {
  id: string
  entityId: string
  matterId: string
  assigneeUserId: string
  assigneeEmail: string
  assigneeName: string
  assignedBy: string | null
  assignedAt: string
}

interface AssignmentDbRow {
  id: string
  entity_id: string
  matter_id: string
  assignee_user_id: string
  assignee_email: string
  assignee_name: string
  assigned_by: string | null
  assigned_at: string
}

function projectAssignmentRow(row: AssignmentDbRow): MatterAssignment {
  return {
    id: row.id,
    entityId: row.entity_id,
    matterId: row.matter_id,
    assigneeUserId: row.assignee_user_id,
    assigneeEmail: row.assignee_email,
    assigneeName: row.assignee_name,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
  }
}

/**
 * Return every active assignment on a single matter.  Used by the matter
 * detail page's assignment section.  A matter may carry zero, one, or
 * more co-counsel assignees; the detail page renders the full list.
 */
export async function listMatterAssignments(
  db: D1Database,
  entityId: string,
  matterId: string
): Promise<MatterAssignment[]> {
  const result = await db
    .prepare(
      `SELECT a.id            AS id,
              a.entity_id     AS entity_id,
              a.matter_id     AS matter_id,
              a.assignee_user_id AS assignee_user_id,
              u.email         AS assignee_email,
              u.name          AS assignee_name,
              a.assigned_by   AS assigned_by,
              a.assigned_at   AS assigned_at
         FROM matter_assignments a
         JOIN users u ON u.id = a.assignee_user_id
        WHERE a.entity_id = ?
          AND a.matter_id = ?
          AND a.unassigned_at IS NULL
        ORDER BY a.assigned_at ASC`
    )
    .bind(entityId, matterId)
    .all<AssignmentDbRow>()
  return (result.results ?? []).map(projectAssignmentRow)
}

/**
 * Return the set of matter ids the given user is currently assigned to,
 * scoped to an entity.  Used by the matters list page when scope=mine
 * to filter the Hermes-returned list down to the caller's matters.
 *
 * Returns a Set for O(1) membership lookups.  An empty set means "no
 * active assignments" — the page renders "no matters assigned to you
 * yet" rather than the unfiltered list.
 */
export async function listAssignedMatterIdsForUser(
  db: D1Database,
  entityId: string,
  userId: string
): Promise<Set<string>> {
  const result = await db
    .prepare(
      `SELECT matter_id FROM matter_assignments
        WHERE entity_id = ?
          AND assignee_user_id = ?
          AND unassigned_at IS NULL`
    )
    .bind(entityId, userId)
    .all<{ matter_id: string }>()
  return new Set((result.results ?? []).map((r) => r.matter_id))
}

export interface AssignMatterArgs {
  orgId: string
  entityId: string
  matterId: string
  assigneeUserId: string
  assignedBy: string
}

/**
 * Assign a matter to a user.  Idempotent: re-assigning an active
 * (entity, matter, user) is a no-op and returns false.  A fresh
 * assignment (including re-assign after unassign) inserts a new row
 * and returns true.
 */
export async function assignMatter(db: D1Database, args: AssignMatterArgs): Promise<boolean> {
  const existing = await db
    .prepare(
      `SELECT id FROM matter_assignments
        WHERE entity_id = ?
          AND matter_id = ?
          AND assignee_user_id = ?
          AND unassigned_at IS NULL`
    )
    .bind(args.entityId, args.matterId, args.assigneeUserId)
    .first<{ id: string }>()
  if (existing) return false

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO matter_assignments
         (id, org_id, entity_id, matter_id, assignee_user_id, assigned_by, assigned_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(id, args.orgId, args.entityId, args.matterId, args.assigneeUserId, args.assignedBy)
    .run()
  return true
}

export interface UnassignMatterArgs {
  entityId: string
  matterId: string
  assigneeUserId: string
  unassignedBy: string
}

/**
 * Soft-delete the active assignment row by setting `unassigned_at`.
 * Idempotent: clearing an already-cleared (or never-existed) assignment
 * returns false.
 */
export async function unassignMatter(db: D1Database, args: UnassignMatterArgs): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE matter_assignments
          SET unassigned_at = datetime('now'),
              unassigned_by = ?
        WHERE entity_id = ?
          AND matter_id = ?
          AND assignee_user_id = ?
          AND unassigned_at IS NULL`
    )
    .bind(args.unassignedBy, args.entityId, args.matterId, args.assigneeUserId)
    .run()
  return (result.meta?.changes ?? 0) > 0
}

/**
 * Closed vocabulary for the matters list `?scope=` parameter.
 *
 *   mine — only matters the caller is currently assigned to
 *   all  — every matter on the firm (legacy single-user behavior)
 *
 * Unknown values fall back to 'all' so a stale bookmark cannot silently
 * scope a partner's matters list to empty.
 */
export type MatterScope = 'mine' | 'all'

export const MATTER_SCOPES: readonly MatterScope[] = ['mine', 'all'] as const

const MATTER_SCOPE_SET: ReadonlySet<string> = new Set(MATTER_SCOPES)

/**
 * Parse the `?scope=` parameter from the matters list page.  Returns
 * 'all' as the safe default when the param is missing or holds an
 * unknown value.  The default mirrors the legacy single-user UX so
 * principals who never set the toggle continue to see the full list.
 */
export function parseMatterScope(value: string | null | undefined): MatterScope {
  if (typeof value !== 'string') return 'all'
  if (MATTER_SCOPE_SET.has(value)) return value as MatterScope
  return 'all'
}
