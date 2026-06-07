import type { APIRoute } from 'astro'
import { getPortalClient } from '../../../../../lib/portal/session'
import { getProductSubscription, listProductRoles } from '../../../../../lib/portal/product-access'
import { clearPto, setPto, updatePtoBackup } from '../../../../../lib/portal/operator/pto'
import {
  buildPtoClearedAuditEvent,
  buildPtoSetAuditEvent,
  recordRbacAuditEvent,
} from '../../../../../lib/portal/operator/rbac-audit'
import type { PortalUserRow } from '../../../../../lib/auth/clerk-bridge'
import type { Entity } from '../../../../../lib/db/entities'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/products/operator/pto
 *
 * Mark a user away or clear an active PTO row (per #882).  Driven by
 * HTML form submissions from the Settings → PTO page; no JSON.
 *
 * Form fields:
 *   action:          'set' | 'update_backup' | 'clear'
 *   targetUserId:    TEXT   — user being marked away.  Defaults to self
 *                              when omitted; principals MAY provide
 *                              another user's id.
 *   backupUserId:    TEXT   — optional backup user.  Empty / missing =
 *                              no backup.  Validated server-side.
 *
 * Authorization:
 *   - Clerk session required
 *   - Active Operator subscription on this entity
 *   - Caller has any role on (entity, 'operator') AND
 *     (targetUserId === caller OR caller is a principal)
 *
 * Self-service is the canonical flow.  A principal-managed PTO entry
 * for another user is allowed because partners need to be able to mark
 * a paralegal away after the paralegal has already left for vacation.
 *
 * Audit: every successful set / clear emits `audit:rbac_event` with
 * subAction='pto_set' or 'pto_cleared'.  update_backup re-emits a
 * pto_set event with the new backup so the audit trail captures
 * mid-PTO backup changes.  Idempotent no-ops are not audited.
 */

const PRODUCT_SLUG = 'operator'
const PTO_PAGE_URL = '/portal/products/operator/settings/pto'

function redirectWithStatus(status: string): Response {
  const target = `${PTO_PAGE_URL}?status=${encodeURIComponent(status)}`
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
  isPrincipal: boolean
}

async function authorize(locals: App.Locals): Promise<Response | AuthorizedContext> {
  const portalData = await getPortalClient(env.DB, locals)
  if (!portalData) return jsonError(401, 'Unauthorized')
  if (!portalData.client) return jsonError(403, 'Forbidden')

  const { user, client } = portalData
  const roles = await listProductRoles(env.DB, user.id, client.id, PRODUCT_SLUG)
  if (roles.length === 0) return jsonError(403, 'Forbidden')

  const subscription = await getProductSubscription(env.DB, client.id, PRODUCT_SLUG)
  if (!subscription) return jsonError(404, 'No active subscription')

  return { user, client, orgId: user.org_id, isPrincipal: roles.includes('principal') }
}

interface ParsedForm {
  action: 'set' | 'update_backup' | 'clear'
  targetUserId: string
  backupUserId: string | null
}

function parseForm(formData: FormData, defaultUserId: string): ParsedForm | string {
  const action = formData.get('action')
  if (action !== 'set' && action !== 'update_backup' && action !== 'clear') {
    return 'invalid_action'
  }

  const rawTarget = formData.get('targetUserId')
  const targetUserId =
    typeof rawTarget === 'string' && rawTarget.length > 0 ? rawTarget : defaultUserId

  const rawBackup = formData.get('backupUserId')
  const backupUserId = typeof rawBackup === 'string' && rawBackup.length > 0 ? rawBackup : null

  return { action, targetUserId, backupUserId }
}

interface UserSummary {
  id: string
  email: string
}

async function loadUserSummary(userId: string, orgId: string): Promise<UserSummary | null> {
  return await env.DB.prepare('SELECT id, email FROM users WHERE id = ? AND org_id = ?')
    .bind(userId, orgId)
    .first<UserSummary>()
}

async function emitPtoSet(
  ctx: AuthorizedContext,
  target: UserSummary,
  backupUserId: string | null
): Promise<void> {
  const backup = backupUserId ? await loadUserSummary(backupUserId, ctx.orgId) : null
  await recordRbacAuditEvent(
    buildPtoSetAuditEvent({
      customer_id: ctx.client.id,
      product_slug: PRODUCT_SLUG,
      actorUserId: ctx.user.id,
      actorClerkUserId: ctx.user.clerk_user_id,
      actorEmail: ctx.user.email,
      awayUserId: target.id,
      awayEmail: target.email,
      backupUserId: backup?.id ?? null,
      backupEmail: backup?.email ?? null,
    })
  )
}

async function handleClear(
  ctx: AuthorizedContext,
  parsed: ParsedForm,
  target: UserSummary
): Promise<Response> {
  const changed = await clearPto(env.DB, {
    entityId: ctx.client.id,
    userId: parsed.targetUserId,
    clearedBy: ctx.user.id,
  })
  if (changed) {
    await recordRbacAuditEvent(
      buildPtoClearedAuditEvent({
        customer_id: ctx.client.id,
        product_slug: PRODUCT_SLUG,
        actorUserId: ctx.user.id,
        actorClerkUserId: ctx.user.clerk_user_id,
        actorEmail: ctx.user.email,
        awayUserId: target.id,
        awayEmail: target.email,
      })
    )
  }
  return redirectWithStatus(changed ? 'pto_cleared' : 'no_change')
}

async function handleUpdateBackup(
  ctx: AuthorizedContext,
  parsed: ParsedForm,
  target: UserSummary
): Promise<Response> {
  const result = await updatePtoBackup(env.DB, {
    orgId: ctx.orgId,
    entityId: ctx.client.id,
    userId: parsed.targetUserId,
    backupUserId: parsed.backupUserId,
  })
  if (result.kind === 'not_away') return redirectWithStatus('not_away')
  if (result.kind === 'backup_invalid') return backupInvalidStatus(result.reason)
  await emitPtoSet(ctx, target, parsed.backupUserId)
  return redirectWithStatus('backup_updated')
}

async function handleSet(
  ctx: AuthorizedContext,
  parsed: ParsedForm,
  target: UserSummary
): Promise<Response> {
  const setResult = await setPto(env.DB, {
    orgId: ctx.orgId,
    entityId: ctx.client.id,
    userId: parsed.targetUserId,
    backupUserId: parsed.backupUserId,
    setBy: ctx.user.id,
  })
  if (setResult.kind === 'backup_invalid') return backupInvalidStatus(setResult.reason)
  if (setResult.kind === 'already_active') return redirectWithStatus('already_away')
  await emitPtoSet(ctx, target, parsed.backupUserId)
  return redirectWithStatus('pto_set')
}

export const POST: APIRoute = async ({ request, locals }) => {
  const ctxOrResponse = await authorize(locals)
  if (ctxOrResponse instanceof Response) return ctxOrResponse
  const ctx = ctxOrResponse

  const formData = await request.formData()
  const parsed = parseForm(formData, ctx.user.id)
  if (typeof parsed === 'string') return redirectWithStatus(parsed)

  if (parsed.targetUserId !== ctx.user.id && !ctx.isPrincipal) {
    return redirectWithStatus('not_self_or_principal')
  }

  const target = await loadUserSummary(parsed.targetUserId, ctx.orgId)
  if (!target) return redirectWithStatus('user_not_found')

  switch (parsed.action) {
    case 'clear':
      return handleClear(ctx, parsed, target)
    case 'update_backup':
      return handleUpdateBackup(ctx, parsed, target)
    case 'set':
      return handleSet(ctx, parsed, target)
  }
}

function backupInvalidStatus(reason: 'no_product_role' | 'self' | 'unknown_user'): Response {
  switch (reason) {
    case 'no_product_role':
      return redirectWithStatus('backup_no_role')
    case 'self':
      return redirectWithStatus('backup_self')
    case 'unknown_user':
      return redirectWithStatus('backup_unknown')
  }
}
