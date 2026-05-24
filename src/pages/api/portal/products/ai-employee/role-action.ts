import type { APIRoute } from 'astro'
import { getPortalClient } from '../../../../../lib/portal/session'
import { getProductSubscription, listProductRoles } from '../../../../../lib/portal/product-access'
import {
  grantProductRole,
  revokeProductRole,
  isAIEmployeeRole,
  type AIEmployeeRole,
} from '../../../../../lib/portal/product-roles-mutations'
import type { PortalUserRow } from '../../../../../lib/auth/clerk-bridge'
import type { Entity } from '../../../../../lib/db/entities'
import {
  buildRoleAuditEvent,
  recordRbacAuditEvent,
} from '../../../../../lib/portal/ai-employee/rbac-audit'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/products/ai-employee/role-action
 *
 * Action endpoint for granting and revoking AI Employee product roles.
 * Driven by HTML <form method="POST"> submissions from the user-list
 * page; no JSON / fetch logic. Form fields:
 *
 *   action:  'grant' | 'revoke'  — which mutation to run
 *   userId:  TEXT                — target user's local users.id
 *   role:    'principal' | 'operator' | 'compliance'
 *
 * Authorization:
 *   - Clerk session required (middleware enforces)
 *   - The caller must hold the `principal` role on the active entity's
 *     AI Employee subscription
 *
 * Self-protection: a principal cannot revoke their own last principal
 * role (would lock the customer out of self-service management).
 *
 * Returns a 303 redirect back to the user-list page with a `status`
 * query param so the page can surface a banner.
 *
 * Audit: every successful grant or revoke emits an `audit:rbac_event`
 * log line via `recordRbacAuditEvent`. No-op cases (idempotent re-grant
 * of an active role, idempotent re-revoke of an already-revoked role)
 * are NOT audited — nothing changed. The lock-out self-protection
 * (`cannot_revoke_last_principal`) is also not audited; it never
 * mutated state.
 */

const PRODUCT_SLUG = 'ai-employee'
const USERS_PAGE_URL = '/portal/products/ai-employee/settings/users'

function redirectWithStatus(status: string): Response {
  const target = `${USERS_PAGE_URL}?status=${encodeURIComponent(status)}`
  return new Response(null, {
    status: 303,
    headers: { Location: target },
  })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface AuthorizedContext {
  user: PortalUserRow
  client: Entity
  orgId: string
}

/**
 * Resolve portal context and enforce principal-on-AI-Employee
 * authorization. Returns a Response on failure (for the caller to
 * return directly) or the authorized context on success.
 */
async function authorize(locals: App.Locals): Promise<Response | AuthorizedContext> {
  const portalData = await getPortalClient(env.DB, locals)
  if (!portalData) return jsonError(401, 'Unauthorized')
  if (!portalData.client) return jsonError(403, 'Forbidden')

  const { user, client } = portalData
  const callerRoles = await listProductRoles(env.DB, user.id, client.id, PRODUCT_SLUG)
  if (!callerRoles.includes('principal')) return jsonError(403, 'Forbidden')

  const subscription = await getProductSubscription(env.DB, client.id, PRODUCT_SLUG)
  if (!subscription) return jsonError(404, 'No active subscription')

  return { user, client, orgId: user.org_id }
}

interface ParsedAction {
  kind: 'grant' | 'revoke'
  targetUserId: string
  role: AIEmployeeRole
}

function parseForm(formData: FormData): ParsedAction | string {
  const action = formData.get('action')
  const targetUserId = formData.get('userId')
  const role = formData.get('role')
  if (action !== 'grant' && action !== 'revoke') return 'invalid_action'
  if (typeof targetUserId !== 'string' || targetUserId === '') return 'invalid_user'
  if (!isAIEmployeeRole(role)) return 'invalid_role'
  return { kind: action, targetUserId, role }
}

interface TargetUserRow {
  id: string
  email: string
}

async function loadTargetUser(userId: string, orgId: string): Promise<TargetUserRow | null> {
  return await env.DB.prepare('SELECT id, email FROM users WHERE id = ? AND org_id = ?')
    .bind(userId, orgId)
    .first<TargetUserRow>()
}

/**
 * Self-protection check: when a principal tries to revoke their own
 * `principal` role, ensure another active principal exists on the same
 * (entity, product) tuple. Returns true if the revoke is safe to
 * proceed, false if it would lock the customer out.
 */
async function isSafeSelfPrincipalRevoke(
  ctx: AuthorizedContext,
  parsed: ParsedAction
): Promise<boolean> {
  if (parsed.role !== 'principal' || parsed.targetUserId !== ctx.user.id) return true
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM product_roles
      WHERE entity_id = ? AND product_slug = ? AND role = 'principal'
        AND user_id != ?
        AND revoked_at IS NULL`
  )
    .bind(ctx.client.id, PRODUCT_SLUG, ctx.user.id)
    .first<{ n: number }>()
  return (row?.n ?? 0) > 0
}

async function emitRoleAudit(
  ctx: AuthorizedContext,
  parsed: ParsedAction,
  target: TargetUserRow,
  subAction: 'role_granted' | 'role_revoked'
): Promise<void> {
  await recordRbacAuditEvent(
    buildRoleAuditEvent({
      subAction,
      customer_id: ctx.client.id,
      product_slug: PRODUCT_SLUG,
      actorUserId: ctx.user.id,
      actorClerkUserId: ctx.user.clerk_user_id,
      actorEmail: ctx.user.email,
      targetUserId: target.id,
      targetEmail: target.email,
      role: parsed.role,
    })
  )
}

async function handleRevoke(
  ctx: AuthorizedContext,
  parsed: ParsedAction,
  target: TargetUserRow
): Promise<Response> {
  if (!(await isSafeSelfPrincipalRevoke(ctx, parsed))) {
    return redirectWithStatus('cannot_revoke_last_principal')
  }
  const changed = await revokeProductRole(env.DB, {
    userId: parsed.targetUserId,
    entityId: ctx.client.id,
    productSlug: PRODUCT_SLUG,
    role: parsed.role,
  })
  if (changed) await emitRoleAudit(ctx, parsed, target, 'role_revoked')
  return redirectWithStatus(changed ? 'revoked' : 'no_change')
}

async function handleGrant(
  ctx: AuthorizedContext,
  parsed: ParsedAction,
  target: TargetUserRow
): Promise<Response> {
  const changed = await grantProductRole(env.DB, {
    orgId: ctx.orgId,
    userId: parsed.targetUserId,
    entityId: ctx.client.id,
    productSlug: PRODUCT_SLUG,
    role: parsed.role,
    grantedBy: ctx.user.id,
  })
  if (changed) await emitRoleAudit(ctx, parsed, target, 'role_granted')
  return redirectWithStatus(changed ? 'granted' : 'no_change')
}

export const POST: APIRoute = async ({ request, locals }) => {
  const ctxOrResponse = await authorize(locals)
  if (ctxOrResponse instanceof Response) return ctxOrResponse
  const ctx = ctxOrResponse

  const formData = await request.formData()
  const parsed = parseForm(formData)
  if (typeof parsed === 'string') return redirectWithStatus(parsed)

  const target = await loadTargetUser(parsed.targetUserId, ctx.orgId)
  if (target === null) {
    return redirectWithStatus('user_not_found')
  }

  return parsed.kind === 'revoke'
    ? handleRevoke(ctx, parsed, target)
    : handleGrant(ctx, parsed, target)
}
