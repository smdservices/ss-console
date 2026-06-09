/**
 * Mutations on the product_roles table. Shared between the user-list
 * page's form actions and any future API-driven role management.
 *
 * Authorization is the caller's responsibility — these helpers do NOT
 * verify that the actor holds the `principal` role. The action route
 * checks that before invoking.
 *
 * Both helpers are idempotent. Granting a role that is already active
 * is a no-op (returns false). Revoking a role that is already revoked
 * (or never existed) is a no-op (returns false). A successful change
 * returns true.
 */

const ALLOWED_OPERATOR_ROLES = ['principal', 'staff', 'compliance'] as const
export type OperatorRole = (typeof ALLOWED_OPERATOR_ROLES)[number]

export function isOperatorRole(value: unknown): value is OperatorRole {
  return typeof value === 'string' && (ALLOWED_OPERATOR_ROLES as readonly string[]).includes(value)
}

export interface GrantArgs {
  orgId: string
  userId: string
  entityId: string
  productSlug: string
  role: string
  grantedBy: string
}

export interface RevokeArgs {
  userId: string
  entityId: string
  productSlug: string
  role: string
}

/**
 * Insert a fresh product_roles row, or restore one that was previously
 * revoked. If an active row already exists, returns false (no-op).
 *
 * The active vs. revoked check is the indexed predicate
 * `revoked_at IS NULL`. Restoring a previously revoked grant inserts
 * a new row rather than mutating the prior one — preserves audit
 * history of when each grant was created and revoked.
 */
export async function grantProductRole(db: D1Database, args: GrantArgs): Promise<boolean> {
  const existing = await db
    .prepare(
      `SELECT id FROM product_roles
        WHERE user_id = ? AND entity_id = ? AND product_slug = ? AND role = ?
          AND revoked_at IS NULL`
    )
    .bind(args.userId, args.entityId, args.productSlug, args.role)
    .first<{ id: string }>()

  if (existing) return false

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO product_roles
         (id, org_id, user_id, entity_id, product_slug, role, granted_by, granted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(id, args.orgId, args.userId, args.entityId, args.productSlug, args.role, args.grantedBy)
    .run()
  return true
}

/**
 * Soft-delete the active product_roles row for the given tuple by
 * setting `revoked_at`. Returns false if no active row exists.
 *
 * Multiple historical rows for the same tuple are possible (each
 * grant/revoke cycle inserts a new row). This helper only acts on
 * the currently-active grant — the predicate `revoked_at IS NULL`
 * matches exactly one row per the UNIQUE constraint shape.
 */
export async function revokeProductRole(db: D1Database, args: RevokeArgs): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE product_roles
          SET revoked_at = datetime('now')
        WHERE user_id = ? AND entity_id = ? AND product_slug = ? AND role = ?
          AND revoked_at IS NULL`
    )
    .bind(args.userId, args.entityId, args.productSlug, args.role)
    .run()
  return (result.meta?.changes ?? 0) > 0
}
