/**
 * People & access view-model for the admin Operator console
 * (`/admin/operator/[customer]/people`) — design §5.7.
 *
 * Lists a client's own users and their client-internal Operator roles
 * (principal / staff / compliance — the role vocabulary the client portal owns
 * in src/lib/portal/operator/client-rbac.ts, imported read-only here).
 *
 * Scope (deliberate, this PR): READ-ONLY. The design lets SMD add/remove client
 * users and set roles, but that mutates access controls — a guardrailed action
 * that needs an explicit Captain directive to wire. So this surface shows who
 * has what, and defers the grant/revoke write to a follow-on rather than
 * shipping an unauthorized access-control mutation. The page says so plainly.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { isClientRole, type ClientRole } from '../portal/operator/client-rbac'

export const OPERATOR_PRODUCT_SLUG = 'operator'

export interface OperatorUser {
  user_id: string
  email: string
  name: string | null
  /** Active operator roles, in the canonical order principal → staff → compliance. */
  roles: ClientRole[]
}

interface RoleUserRow {
  user_id: string
  email: string
  name: string | null
  role: string
}

const ROLE_ORDER: Record<ClientRole, number> = { principal: 0, staff: 1, compliance: 2 }

/**
 * List every user who holds at least one active (non-revoked) Operator role on
 * this client, with their roles grouped. One batched read of product_roles
 * joined to users; SMD-side, scoped to one entity. Unknown role strings (a role
 * added to the schema but not to client-rbac yet) are dropped from display
 * rather than guessed.
 */
export async function listOperatorUsers(db: D1Database, entityId: string): Promise<OperatorUser[]> {
  const result = await db
    .prepare(
      `SELECT pr.user_id AS user_id, u.email AS email, u.name AS name, pr.role AS role
         FROM product_roles pr
         JOIN users u ON u.id = pr.user_id
        WHERE pr.entity_id = ? AND pr.product_slug = ? AND pr.revoked_at IS NULL
        ORDER BY u.email ASC`
    )
    .bind(entityId, OPERATOR_PRODUCT_SLUG)
    .all<RoleUserRow>()

  const byUser = new Map<string, OperatorUser>()
  for (const row of result.results ?? []) {
    if (!isClientRole(row.role)) continue
    const existing = byUser.get(row.user_id)
    if (existing) {
      if (!existing.roles.includes(row.role)) existing.roles.push(row.role)
    } else {
      byUser.set(row.user_id, {
        user_id: row.user_id,
        email: row.email,
        name: row.name,
        roles: [row.role],
      })
    }
  }
  const users = [...byUser.values()]
  for (const u of users) u.roles.sort((a, b) => ROLE_ORDER[a] - ROLE_ORDER[b])
  return users
}

export interface RoleBadge {
  label: string
  classes: string
}

const BADGE_STRUCTURE =
  'inline-flex items-center px-2 py-0.5 rounded-[var(--ss-radius-badge)] ' +
  'text-[10px] font-medium uppercase tracking-wide whitespace-nowrap'

/** Badge for a client-internal role. */
export function roleBadge(role: ClientRole): RoleBadge {
  switch (role) {
    case 'principal':
      return {
        label: 'Principal',
        classes: `${BADGE_STRUCTURE} bg-[color:var(--ss-color-primary)] text-white`,
      }
    case 'staff':
      return {
        label: 'Staff',
        classes: `${BADGE_STRUCTURE} bg-[color:var(--ss-color-complete)] text-white`,
      }
    case 'compliance':
      return {
        label: 'Compliance',
        classes: `${BADGE_STRUCTURE} bg-[color:var(--ss-color-attention)] text-white`,
      }
  }
}

/** Count of users holding the principal role — onboarding seeds exactly one. */
export function principalCount(users: readonly OperatorUser[]): number {
  return users.filter((u) => u.roles.includes('principal')).length
}
