import type { APIRoute } from 'astro'
import { getPortalClient } from '../../../../../lib/portal/session'
import { getProductSubscription, listProductRoles } from '../../../../../lib/portal/product-access'
import { assignMatter, unassignMatter } from '../../../../../lib/portal/operator/matter-assignment'
import {
  buildMatterAssignmentAuditEvent,
  recordRbacAuditEvent,
} from '../../../../../lib/portal/operator/rbac-audit'
import type { PortalUserRow } from '../../../../../lib/auth/clerk-bridge'
import type { Entity } from '../../../../../lib/db/entities'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/products/operator/matter-assignment
 *
 * Assign or unassign a user to/from a matter for multi-paralegal firms
 * (per #882).  Driven by HTML <form method="POST"> submissions from the
 * Matter detail page; no JSON / fetch logic.  Form fields:
 *
 *   action:    'assign' | 'unassign'
 *   matterId:  TEXT   — opaque matter id (owned by Hermes D1)
 *   userId:    TEXT   — target user's local users.id
 *
 * Authorization:
 *   - Clerk session required (middleware enforces)
 *   - Active Operator subscription on this entity
 *   - Caller holds the `principal` OR `operator` role on
 *     (entity, 'operator') — operators can re-assign too because
 *     paralegal-to-paralegal handoff is a routine collaboration move
 *     in multi-paralegal firms.  Compliance is read-only and cannot
 *     mutate assignments.
 *
 * Audit: every successful assign or unassign emits an `audit:rbac_event`
 * log line via `recordRbacAuditEvent` with subAction='matter_assigned'
 * or 'matter_unassigned'.  Idempotent no-ops (re-assigning an active
 * grant, unassigning an already-cleared row) are NOT audited.
 *
 * Returns a 303 redirect back to the matter detail page with a
 * `?status=` query param so the page can surface a banner.
 */

const PRODUCT_SLUG = 'operator'

function matterUrl(matterId: string, status: string): string {
  const path = `/portal/products/operator/matters/${encodeURIComponent(matterId)}`
  return `${path}?status=${encodeURIComponent(status)}`
}

function redirectWithStatus(matterId: string, status: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: matterUrl(matterId, status) },
  })
}

function redirectListWithStatus(status: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/portal/products/operator/matters?status=${encodeURIComponent(status)}`,
    },
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

async function authorize(locals: App.Locals): Promise<Response | AuthorizedContext> {
  const portalData = await getPortalClient(env.DB, locals)
  if (!portalData) return jsonError(401, 'Unauthorized')
  if (!portalData.client) return jsonError(403, 'Forbidden')

  const { user, client } = portalData
  const roles = await listProductRoles(env.DB, user.id, client.id, PRODUCT_SLUG)
  const canMutate = roles.includes('principal') || roles.includes('staff')
  if (!canMutate) return jsonError(403, 'Forbidden')

  const subscription = await getProductSubscription(env.DB, client.id, PRODUCT_SLUG)
  if (!subscription) return jsonError(404, 'No active subscription')

  return { user, client, orgId: user.org_id }
}

type ParsedForm =
  | { kind: 'invalid_action' }
  | { kind: 'invalid_matter' }
  | { kind: 'invalid_user' }
  | { kind: 'ok'; action: 'assign' | 'unassign'; matterId: string; userId: string }

function parseForm(formData: FormData): ParsedForm {
  const action = formData.get('action')
  const matterId = formData.get('matterId')
  const userId = formData.get('userId')

  if (action !== 'assign' && action !== 'unassign') return { kind: 'invalid_action' }
  if (typeof matterId !== 'string' || matterId.length === 0) return { kind: 'invalid_matter' }
  if (typeof userId !== 'string' || userId.length === 0) return { kind: 'invalid_user' }

  return { kind: 'ok', action, matterId, userId }
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
 * Validate the target user actually holds a product role on this
 * customer's Operator subscription.  A user without any role on
 * (entity, 'operator') cannot be assigned matters — the routing
 * layer would have no permission to surface the matter to them.
 */
async function targetHasOperatorAccess(userId: string, entityId: string): Promise<boolean> {
  const roles = await listProductRoles(env.DB, userId, entityId, PRODUCT_SLUG)
  return roles.length > 0
}

async function emitAssignmentAudit(
  ctx: AuthorizedContext,
  subAction: 'matter_assigned' | 'matter_unassigned',
  matterId: string,
  target: TargetUserRow
): Promise<void> {
  await recordRbacAuditEvent(
    buildMatterAssignmentAuditEvent({
      subAction,
      customer_id: ctx.client.id,
      product_slug: PRODUCT_SLUG,
      actorUserId: ctx.user.id,
      actorClerkUserId: ctx.user.clerk_user_id,
      actorEmail: ctx.user.email,
      matterId,
      assigneeUserId: target.id,
      assigneeEmail: target.email,
    })
  )
}

export const POST: APIRoute = async ({ request, locals }) => {
  const ctxOrResponse = await authorize(locals)
  if (ctxOrResponse instanceof Response) return ctxOrResponse
  const ctx = ctxOrResponse

  const formData = await request.formData()
  const parsed = parseForm(formData)

  if (parsed.kind === 'invalid_action') return redirectListWithStatus('invalid_action')
  if (parsed.kind === 'invalid_matter') return redirectListWithStatus('invalid_matter')
  if (parsed.kind === 'invalid_user') return redirectListWithStatus('invalid_user')

  const target = await loadTargetUser(parsed.userId, ctx.orgId)
  if (!target) return redirectWithStatus(parsed.matterId, 'user_not_found')

  if (parsed.action === 'assign') {
    const hasAccess = await targetHasOperatorAccess(parsed.userId, ctx.client.id)
    if (!hasAccess) return redirectWithStatus(parsed.matterId, 'user_no_role')

    const changed = await assignMatter(env.DB, {
      orgId: ctx.orgId,
      entityId: ctx.client.id,
      matterId: parsed.matterId,
      assigneeUserId: parsed.userId,
      assignedBy: ctx.user.id,
    })
    if (changed) await emitAssignmentAudit(ctx, 'matter_assigned', parsed.matterId, target)
    return redirectWithStatus(parsed.matterId, changed ? 'assigned' : 'no_change')
  }

  const changed = await unassignMatter(env.DB, {
    entityId: ctx.client.id,
    matterId: parsed.matterId,
    assigneeUserId: parsed.userId,
    unassignedBy: ctx.user.id,
  })
  if (changed) await emitAssignmentAudit(ctx, 'matter_unassigned', parsed.matterId, target)
  return redirectWithStatus(parsed.matterId, changed ? 'unassigned' : 'no_change')
}
