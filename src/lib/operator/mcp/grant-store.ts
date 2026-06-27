import type { D1Database } from '@cloudflare/workers-types'

/**
 * Writer for the Operator ⇄ Claude MCP access-grant table (`mcp_issued_grants`,
 * ADR 0057). Slice 2a shipped the live READ (loadMcpCustomer); this is the write
 * side that makes the kill switch operable.
 *
 * Two issue paths exist by design and must stay distinct:
 *   - adminIssueGrant — an SMD admin deliberately granting; MAY lift a prior
 *     revocation (clears revoked_at).
 *   - jitIssueGrant (slice 2e, open-by-domain) — auto-issue on first authenticated
 *     firm-domain connect; MUST refuse if a revoked row exists (sticky revoke), so
 *     a revoked user cannot re-mint their way back in.
 *
 * Every issue and revoke also writes one append-only row to
 * operator_mcp_grant_audit. The live grant row is mutable state (re-issue
 * overwrites it, revoke flips a column); the audit ledger is the immutable record
 * of who changed access, for whom, when — a law-firm obligation.
 */

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

/** Bounded-TTL invariant (ADR 0057): never null, never infinite. */
export const GRANT_TTL_DEFAULT_DAYS = 30
export const GRANT_TTL_MAX_DAYS = 90

/**
 * Open-by-domain JIT (slice 2e) carries a SHORTER ceiling than admin-issued
 * grants: no human approves each auto-mint, so the standing-access window is
 * tighter. The route grants min(connector.ttl_days, this).
 */
export const MCP_OPEN_GRANT_TTL_DAYS = 7

/**
 * Per-customer active-grant ceiling for open-by-domain auto-issue. A compromised
 * firm mailbox shouldn't fan out unbounded grants; at the cap, JIT refuses (the
 * breach is audited) until grants lapse or an admin intervenes. Admin issuance is
 * not capped (a human is in the loop).
 */
export const MCP_OPEN_GRANT_CAP = 50

/** Clamp an authored/submitted TTL into [1, GRANT_TTL_MAX_DAYS]; junk → default. */
export function clampTtlDays(raw: number): number {
  if (!Number.isFinite(raw) || raw < 1) return GRANT_TTL_DEFAULT_DAYS
  return Math.min(Math.floor(raw), GRANT_TTL_MAX_DAYS)
}

export interface GrantAuditContext {
  /** entities.id — for the audit FK + cascade. */
  entityId: string
  /** Who acted: an SMD admin email, or 'system:jit' for an open-policy mint. */
  actor: string
  reason: string | null
}

export interface IssueGrantInput {
  customerSlug: string
  clerkUserId: string
  email: string
  profile: string
  ttlDays: number
}

export interface GrantListRow {
  clerk_user_id: string
  email: string
  profile: string
  issued_at: string
  expires_at: string
  revoked_at: string | null
}

/**
 * Admin-issued grant. UPSERT on the (customer_slug, clerk_user_id) PK; refreshes
 * issued_at and **clears revoked_at** — an admin re-granting deliberately lifts a
 * prior revocation. Returns the concrete expiry the grant resolved to.
 */
export async function adminIssueGrant(
  db: D1Database,
  input: IssueGrantInput,
  ctx: GrantAuditContext
): Promise<{ expiresAt: string }> {
  const ttlDays = clampTtlDays(input.ttlDays)
  await db
    .prepare(
      'INSERT INTO mcp_issued_grants ' +
        '(customer_slug, clerk_user_id, email, profile, expires_at, issued_at, revoked_at) ' +
        `VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?), ${NOW_SQL}, NULL) ` +
        'ON CONFLICT(customer_slug, clerk_user_id) DO UPDATE SET ' +
        'email = excluded.email, profile = excluded.profile, ' +
        'expires_at = excluded.expires_at, issued_at = excluded.issued_at, revoked_at = NULL'
    )
    .bind(input.customerSlug, input.clerkUserId, input.email, input.profile, `+${ttlDays} days`)
    .run()
  const row = await db
    .prepare(
      'SELECT expires_at FROM mcp_issued_grants WHERE customer_slug = ? AND clerk_user_id = ?'
    )
    .bind(input.customerSlug, input.clerkUserId)
    .first<{ expires_at: string }>()
  const expiresAt = row?.expires_at ?? ''
  await recordGrantAudit(db, {
    entityId: ctx.entityId,
    customerSlug: input.customerSlug,
    action: 'issue',
    clerkUserId: input.clerkUserId,
    email: input.email,
    profile: input.profile,
    ttlDays,
    expiresAt,
    actor: ctx.actor,
    reason: ctx.reason,
  })
  return { expiresAt }
}

/**
 * Revoke a grant: set revoked_at on the live (un-revoked) row. The next MCP
 * request sees the principal vanish (loadMcpCustomer filters revoked_at IS NULL).
 * Idempotent — re-revoking an already-revoked grant changes nothing and writes no
 * audit row. Returns whether a live grant was actually killed.
 */
export async function revokeGrant(
  db: D1Database,
  input: { customerSlug: string; clerkUserId: string },
  ctx: GrantAuditContext
): Promise<{ changed: boolean; email: string | null; profile: string | null }> {
  const existing = await db
    .prepare(
      'SELECT email, profile FROM mcp_issued_grants WHERE customer_slug = ? AND clerk_user_id = ?'
    )
    .bind(input.customerSlug, input.clerkUserId)
    .first<{ email: string; profile: string }>()
  const res = await db
    .prepare(
      `UPDATE mcp_issued_grants SET revoked_at = ${NOW_SQL} ` +
        'WHERE customer_slug = ? AND clerk_user_id = ? AND revoked_at IS NULL'
    )
    .bind(input.customerSlug, input.clerkUserId)
    .run()
  const changed = (res.meta?.changes ?? 0) > 0
  if (changed) {
    await recordGrantAudit(db, {
      entityId: ctx.entityId,
      customerSlug: input.customerSlug,
      action: 'revoke',
      clerkUserId: input.clerkUserId,
      email: existing?.email ?? '',
      profile: existing?.profile ?? null,
      ttlDays: null,
      expiresAt: null,
      actor: ctx.actor,
      reason: ctx.reason,
    })
  }
  return { changed, email: existing?.email ?? null, profile: existing?.profile ?? null }
}

/** All grants for a customer (incl. revoked/expired) for the admin view. */
export async function listGrants(db: D1Database, customerSlug: string): Promise<GrantListRow[]> {
  const res = await db
    .prepare(
      'SELECT clerk_user_id, email, profile, issued_at, expires_at, revoked_at ' +
        'FROM mcp_issued_grants WHERE customer_slug = ? ORDER BY issued_at DESC'
    )
    .bind(customerSlug)
    .all<GrantListRow>()
  return res.results ?? []
}

/** Count live (un-revoked, un-expired) grants for the open-policy cap. */
export async function countActiveGrants(db: D1Database, customerSlug: string): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM mcp_issued_grants ' +
        `WHERE customer_slug = ? AND revoked_at IS NULL AND expires_at > ${NOW_SQL}`
    )
    .bind(customerSlug)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export type JitResult =
  | { issued: true; expiresAt: string }
  | { issued: false; reason: 'revoked' | 'cap_exceeded' }

/**
 * Open-by-domain JIT mint (slice 2e). STICKY REVOKE: refuses if a revoked grant
 * already exists for the subject — a revoked user cannot auto-mint their way back
 * (only adminIssueGrant lifts a revocation). Refuses at the per-customer cap.
 * Unlike adminIssueGrant, it never clears revoked_at (the refuse-on-revoked check
 * guarantees any row it upserts is already un-revoked).
 */
export async function jitIssueGrant(
  db: D1Database,
  input: IssueGrantInput,
  ctx: GrantAuditContext
): Promise<JitResult> {
  const existing = await db
    .prepare(
      'SELECT revoked_at FROM mcp_issued_grants WHERE customer_slug = ? AND clerk_user_id = ?'
    )
    .bind(input.customerSlug, input.clerkUserId)
    .first<{ revoked_at: string | null }>()
  if (existing && existing.revoked_at !== null) return { issued: false, reason: 'revoked' }
  if ((await countActiveGrants(db, input.customerSlug)) >= MCP_OPEN_GRANT_CAP) {
    return { issued: false, reason: 'cap_exceeded' }
  }

  const ttlDays = clampTtlDays(input.ttlDays)
  await db
    .prepare(
      'INSERT INTO mcp_issued_grants ' +
        '(customer_slug, clerk_user_id, email, profile, expires_at, issued_at, revoked_at) ' +
        `VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?), ${NOW_SQL}, NULL) ` +
        'ON CONFLICT(customer_slug, clerk_user_id) DO UPDATE SET ' +
        'email = excluded.email, profile = excluded.profile, ' +
        'expires_at = excluded.expires_at, issued_at = excluded.issued_at'
    )
    .bind(input.customerSlug, input.clerkUserId, input.email, input.profile, `+${ttlDays} days`)
    .run()
  const row = await db
    .prepare(
      'SELECT expires_at FROM mcp_issued_grants WHERE customer_slug = ? AND clerk_user_id = ?'
    )
    .bind(input.customerSlug, input.clerkUserId)
    .first<{ expires_at: string }>()
  const expiresAt = row?.expires_at ?? ''
  await recordGrantAudit(db, {
    entityId: ctx.entityId,
    customerSlug: input.customerSlug,
    action: 'issue',
    clerkUserId: input.clerkUserId,
    email: input.email,
    profile: input.profile,
    ttlDays,
    expiresAt,
    actor: ctx.actor,
    reason: ctx.reason,
  })
  return { issued: true, expiresAt }
}

interface GrantAuditRow {
  entityId: string
  customerSlug: string
  action: 'issue' | 'revoke'
  clerkUserId: string
  email: string
  profile: string | null
  ttlDays: number | null
  expiresAt: string | null
  actor: string
  reason: string | null
}

async function recordGrantAudit(db: D1Database, row: GrantAuditRow): Promise<void> {
  await db
    .prepare(
      'INSERT INTO operator_mcp_grant_audit ' +
        '(entity_id, customer_slug, action, clerk_user_id, email, profile, ttl_days, ' +
        'expires_at, actor, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      row.entityId,
      row.customerSlug,
      row.action,
      row.clerkUserId,
      row.email,
      row.profile,
      row.ttlDays,
      row.expiresAt,
      row.actor,
      row.reason
    )
    .run()
}
