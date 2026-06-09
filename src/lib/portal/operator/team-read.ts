/**
 * Team read path (client-portal §5.7). The people on this account — who holds
 * which role, and who is currently away — projected read-only for the Team
 * surface.
 *
 * This is the read half of the `people_access` domain. The write half (grant /
 * revoke / invite / set-PTO) lives in the existing mutation endpoints, now gated
 * by `isPeopleAccessOperable`. At launch the surface is Read + Request, so this
 * projection is the load-bearing view: a principal seeing the roster SMD
 * manages, with a path to request a change.
 *
 * The roster query mirrors the legacy users page (one row per person, roles
 * aggregated) but returns plain data, not markup — the dual-mode surface decides
 * how to render it. PTO reuses `listActivePto`. Defensive throughout: a missing
 * name falls back to the email; never a fabricated member.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { listActivePto, type UserPtoRow } from './pto'

/** Canonical client role display order: principal, then staff, then compliance. */
const ROLE_ORDER: Record<string, number> = { principal: 0, staff: 1, compliance: 2 }

export interface TeamMember {
  id: string
  name: string
  email: string
  lastLoginAt: string | null
  roles: string[]
}

export interface TeamRoster {
  members: TeamMember[]
  awayCount: number
  pto: UserPtoRow[]
}

interface MemberDbRow {
  id: string
  email: string
  name: string | null
  last_login_at: string | null
  role: string
  granted_at: string
}

/**
 * Every local user with at least one active (non-revoked) Operator role on this
 * entity, one entry per person with roles aggregated and ordered. Plus the
 * firm-wide active-PTO roster. Read-only; never mutates.
 */
export async function loadTeamRoster(
  db: D1Database,
  entityId: string,
  orgId: string
): Promise<TeamRoster> {
  const rows = await db
    .prepare(
      `SELECT u.id            AS id,
              u.email         AS email,
              u.name          AS name,
              u.last_login_at AS last_login_at,
              pr.role         AS role,
              pr.granted_at   AS granted_at
         FROM product_roles pr
         JOIN users u ON u.id = pr.user_id
        WHERE pr.entity_id = ?
          AND pr.org_id = ?
          AND pr.product_slug = 'operator'
          AND pr.revoked_at IS NULL
        ORDER BY u.name, pr.granted_at ASC`
    )
    .bind(entityId, orgId)
    .all<MemberDbRow>()

  const members = aggregateMembers(rows.results ?? [])
  const pto = await listActivePto(db, entityId)
  return { members, awayCount: pto.length, pto }
}

/**
 * Collapse per-role DB rows into one TeamMember per person, roles ordered.
 * Exported for unit testing the aggregation independent of D1.
 */
export function aggregateMembers(rows: readonly MemberDbRow[]): TeamMember[] {
  const byUser = new Map<string, TeamMember>()
  for (const row of rows) {
    if (typeof row.id !== 'string' || row.id.length === 0) continue
    if (typeof row.email !== 'string' || row.email.length === 0) continue
    const existing = byUser.get(row.id)
    if (existing) {
      if (row.role && !existing.roles.includes(row.role)) existing.roles.push(row.role)
    } else {
      byUser.set(row.id, {
        id: row.id,
        email: row.email,
        name: row.name && row.name.length > 0 ? row.name : row.email,
        lastLoginAt: row.last_login_at,
        roles: row.role ? [row.role] : [],
      })
    }
  }
  const members = Array.from(byUser.values())
  for (const m of members) {
    m.roles.sort((a, b) => (ROLE_ORDER[a] ?? 99) - (ROLE_ORDER[b] ?? 99))
  }
  return members
}

/** Human-readable last-login date, or "Never". Total — never throws on bad input. */
export function formatLastLogin(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Never'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
