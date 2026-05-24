/**
 * Per-user PTO / OOO state for multi-paralegal firms (#882).
 *
 * A user marks themselves "away" via the Settings → PTO page; while away,
 * the Hermes routing layer (#821) reads `user_pto` on every inbound
 * matter event and re-routes to the configured backup user (when set).
 * Without a backup, the action queues for principal handoff.
 *
 * Self-service is the canonical flow: the user themselves toggles the
 * away state.  Principals MAY mark another user away (e.g., a partner
 * setting a paralegal's vacation while she's already on the plane) via
 * the same set_pto() helper — the API endpoint enforces the
 * principal-or-self gate; this module records the actual `set_by`
 * identity so audit reflects who performed the action.
 *
 * The backup_user_id MUST already hold a `product_role` on
 * (entity, 'ai-employee') if provided — verified by set_pto() before
 * inserting the row.  We never silently downgrade an invalid backup to
 * "no backup" — that would fabricate routing behavior the user did not
 * consent to.  The caller receives a typed error instead.
 *
 * The schema's partial unique index enforces "one active PTO row per
 * (user, entity)" at the DB layer.  Calling set_pto() while a row is
 * already active is a no-op (returns the existing row) rather than
 * inserting a second; updating the backup mid-PTO is supported via
 * update_pto_backup().
 */

import { listProductRoles } from '../product-access'

export interface UserPtoRow {
  id: string
  entityId: string
  userId: string
  userEmail: string
  userName: string
  backupUserId: string | null
  backupEmail: string | null
  backupName: string | null
  setBy: string
  setAt: string
}

interface PtoDbRow {
  id: string
  entity_id: string
  user_id: string
  user_email: string
  user_name: string
  backup_user_id: string | null
  backup_email: string | null
  backup_name: string | null
  set_by: string
  set_at: string
}

function projectPtoRow(row: PtoDbRow): UserPtoRow {
  return {
    id: row.id,
    entityId: row.entity_id,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name,
    backupUserId: row.backup_user_id,
    backupEmail: row.backup_email,
    backupName: row.backup_name,
    setBy: row.set_by,
    setAt: row.set_at,
  }
}

/**
 * Read the active PTO row for a user, if any.  Returns null when the
 * user is not away.  The detail rows on the Users page and the PTO
 * settings page both use this; the routing layer reads it on every
 * inbound action.
 */
export async function getActivePto(
  db: D1Database,
  entityId: string,
  userId: string
): Promise<UserPtoRow | null> {
  const row = await db
    .prepare(
      `SELECT p.id            AS id,
              p.entity_id     AS entity_id,
              p.user_id       AS user_id,
              u.email         AS user_email,
              u.name          AS user_name,
              p.backup_user_id AS backup_user_id,
              b.email         AS backup_email,
              b.name          AS backup_name,
              p.set_by        AS set_by,
              p.set_at        AS set_at
         FROM user_pto p
         JOIN users u ON u.id = p.user_id
    LEFT JOIN users b ON b.id = p.backup_user_id
        WHERE p.entity_id = ?
          AND p.user_id = ?
          AND p.cleared_at IS NULL`
    )
    .bind(entityId, userId)
    .first<PtoDbRow>()
  if (!row) return null
  return projectPtoRow(row)
}

/**
 * List every user currently away on this entity.  Used by the principal
 * Users page to surface the firm-wide away view.
 */
export async function listActivePto(db: D1Database, entityId: string): Promise<UserPtoRow[]> {
  const result = await db
    .prepare(
      `SELECT p.id            AS id,
              p.entity_id     AS entity_id,
              p.user_id       AS user_id,
              u.email         AS user_email,
              u.name          AS user_name,
              p.backup_user_id AS backup_user_id,
              b.email         AS backup_email,
              b.name          AS backup_name,
              p.set_by        AS set_by,
              p.set_at        AS set_at
         FROM user_pto p
         JOIN users u ON u.id = p.user_id
    LEFT JOIN users b ON b.id = p.backup_user_id
        WHERE p.entity_id = ?
          AND p.cleared_at IS NULL
        ORDER BY p.set_at DESC`
    )
    .bind(entityId)
    .all<PtoDbRow>()
  return (result.results ?? []).map(projectPtoRow)
}

export interface SetPtoArgs {
  orgId: string
  entityId: string
  userId: string
  backupUserId: string | null
  setBy: string
}

export type SetPtoResult =
  | { kind: 'created'; row: UserPtoRow }
  | { kind: 'already_active'; row: UserPtoRow }
  | { kind: 'backup_invalid'; reason: 'no_product_role' | 'self' | 'unknown_user' }

/**
 * Mark a user away.  Returns:
 *
 *   - `created`        — fresh PTO row inserted.  Emit audit.
 *   - `already_active` — user was already marked away; backup not
 *                        changed.  No audit.  Use updatePtoBackup() to
 *                        change the backup separately.
 *   - `backup_invalid` — backup_user_id failed validation.  No row
 *                        inserted.  Caller surfaces an error to the
 *                        user.  Reasons:
 *                          - no_product_role: backup has no
 *                            (entity, 'ai-employee') role
 *                          - self: backup_user_id === user_id (would
 *                            create a self-routing loop)
 *                          - unknown_user: backup_user_id has no users
 *                            row on this org/entity
 */
export async function setPto(db: D1Database, args: SetPtoArgs): Promise<SetPtoResult> {
  const existing = await getActivePto(db, args.entityId, args.userId)
  if (existing) return { kind: 'already_active', row: existing }

  if (args.backupUserId !== null) {
    const validation = await validateBackupUser(db, {
      entityId: args.entityId,
      orgId: args.orgId,
      userId: args.userId,
      backupUserId: args.backupUserId,
    })
    if (validation !== 'ok') return { kind: 'backup_invalid', reason: validation }
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO user_pto
         (id, org_id, entity_id, user_id, backup_user_id, set_by, set_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(id, args.orgId, args.entityId, args.userId, args.backupUserId, args.setBy)
    .run()
  const row = await getActivePto(db, args.entityId, args.userId)
  if (!row) {
    throw new Error(
      `setPto inserted user_pto row but follow-up read returned null (entity=${args.entityId}, user=${args.userId})`
    )
  }
  return { kind: 'created', row }
}

export interface UpdatePtoBackupArgs {
  orgId: string
  entityId: string
  userId: string
  backupUserId: string | null
}

export type UpdatePtoBackupResult =
  | { kind: 'updated'; row: UserPtoRow }
  | { kind: 'not_away' }
  | { kind: 'backup_invalid'; reason: 'no_product_role' | 'self' | 'unknown_user' }

/**
 * Update the backup user on an already-active PTO row.  Returns
 * `not_away` when the user has no active PTO row (use setPto() first).
 * Returns `backup_invalid` on the same validation failures as setPto().
 */
export async function updatePtoBackup(
  db: D1Database,
  args: UpdatePtoBackupArgs
): Promise<UpdatePtoBackupResult> {
  const existing = await getActivePto(db, args.entityId, args.userId)
  if (!existing) return { kind: 'not_away' }

  if (args.backupUserId !== null) {
    const validation = await validateBackupUser(db, {
      entityId: args.entityId,
      orgId: args.orgId,
      userId: args.userId,
      backupUserId: args.backupUserId,
    })
    if (validation !== 'ok') return { kind: 'backup_invalid', reason: validation }
  }

  await db
    .prepare(
      `UPDATE user_pto
          SET backup_user_id = ?
        WHERE id = ?`
    )
    .bind(args.backupUserId, existing.id)
    .run()
  const refreshed = await getActivePto(db, args.entityId, args.userId)
  if (!refreshed) {
    throw new Error(
      `updatePtoBackup mutated user_pto row but follow-up read returned null (id=${existing.id})`
    )
  }
  return { kind: 'updated', row: refreshed }
}

export interface ClearPtoArgs {
  entityId: string
  userId: string
  clearedBy: string
}

/**
 * Clear an active PTO row.  Returns true when a row flipped from active
 * to cleared; false when no row existed.  Idempotent.
 */
export async function clearPto(db: D1Database, args: ClearPtoArgs): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE user_pto
          SET cleared_at = datetime('now'),
              cleared_by = ?
        WHERE entity_id = ?
          AND user_id = ?
          AND cleared_at IS NULL`
    )
    .bind(args.clearedBy, args.entityId, args.userId)
    .run()
  return (result.meta?.changes ?? 0) > 0
}

interface ValidateBackupArgs {
  entityId: string
  orgId: string
  userId: string
  backupUserId: string
}

async function validateBackupUser(
  db: D1Database,
  args: ValidateBackupArgs
): Promise<'ok' | 'no_product_role' | 'self' | 'unknown_user'> {
  if (args.backupUserId === args.userId) return 'self'

  const user = await db
    .prepare('SELECT id FROM users WHERE id = ? AND org_id = ?')
    .bind(args.backupUserId, args.orgId)
    .first<{ id: string }>()
  if (!user) return 'unknown_user'

  const roles = await listProductRoles(db, args.backupUserId, args.entityId, 'ai-employee')
  if (roles.length === 0) return 'no_product_role'

  return 'ok'
}
