import type { APIRoute } from 'astro'
import { getPortalClient } from '../../../../../lib/portal/session'
import { getProductSubscription, listProductRoles } from '../../../../../lib/portal/product-access'
import {
  grantProductRole,
  revokeProductRole,
  isAIEmployeeRole,
} from '../../../../../lib/portal/product-roles-mutations'
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
 * Revoking a non-last principal grant from yourself is allowed.
 *
 * Returns a 303 redirect back to the user-list page with a `status`
 * query param so the page can surface a toast.
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

export const POST: APIRoute = async ({ request, locals }) => {
  const portalData = await getPortalClient(env.DB, locals)
  if (!portalData) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!portalData.client) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { user, client } = portalData
  const orgId = user.org_id

  // Caller must hold the principal role on this entity / product.
  const callerRoles = await listProductRoles(env.DB, user.id, client.id, PRODUCT_SLUG)
  if (!callerRoles.includes('principal')) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Subscription must exist before any role changes (status filter inside
  // getProductSubscription is provisioning|active|paused — all acceptable
  // for the principal to manage members).
  const subscription = await getProductSubscription(env.DB, client.id, PRODUCT_SLUG)
  if (!subscription) {
    return new Response(JSON.stringify({ error: 'No active subscription' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const formData = await request.formData()
  const action = formData.get('action')
  const targetUserId = formData.get('userId')
  const role = formData.get('role')

  if (action !== 'grant' && action !== 'revoke') {
    return redirectWithStatus('invalid_action')
  }
  if (typeof targetUserId !== 'string' || targetUserId === '') {
    return redirectWithStatus('invalid_user')
  }
  if (!isAIEmployeeRole(role)) {
    return redirectWithStatus('invalid_role')
  }

  // Target user must actually exist in our local users table. We don't
  // validate Clerk-side org membership here — that's enforced upstream
  // (the user-list page only renders members who already have at least
  // one product_roles row, and granting a role to a Clerk-org outsider
  // would silently no-op when they next sign in since the local user
  // row wouldn't be JIT-created until they authenticate).
  const targetUser = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND org_id = ?')
    .bind(targetUserId, orgId)
    .first<{ id: string }>()
  if (!targetUser) {
    return redirectWithStatus('user_not_found')
  }

  if (action === 'revoke') {
    // Self-protection: cannot revoke the last principal grant on this
    // entity (would lock the customer out). Count other active
    // principals before allowing.
    if (role === 'principal' && targetUserId === user.id) {
      const otherPrincipals = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM product_roles
          WHERE entity_id = ? AND product_slug = ? AND role = 'principal'
            AND user_id != ?
            AND revoked_at IS NULL`
      )
        .bind(client.id, PRODUCT_SLUG, user.id)
        .first<{ n: number }>()
      if (!otherPrincipals || otherPrincipals.n === 0) {
        return redirectWithStatus('cannot_revoke_last_principal')
      }
    }

    const changed = await revokeProductRole(env.DB, {
      userId: targetUserId,
      entityId: client.id,
      productSlug: PRODUCT_SLUG,
      role,
    })
    return redirectWithStatus(changed ? 'revoked' : 'no_change')
  }

  // action === 'grant'
  const changed = await grantProductRole(env.DB, {
    orgId,
    userId: targetUserId,
    entityId: client.id,
    productSlug: PRODUCT_SLUG,
    role,
    grantedBy: user.id,
  })
  return redirectWithStatus(changed ? 'granted' : 'no_change')
}
