import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveAdminSessionFromClerk } from '../../lib/auth/admin-session-shim'
import {
  buildAdminUrl,
  buildPortalUrl,
  getAdminBaseUrl,
  getPortalBaseUrl,
} from '../../lib/config/app-url'

/**
 * Post-sign-in role dispatcher.
 *
 * Clerk's <SignIn /> redirects here after authentication completes. We
 * look up the authenticated user's role in the local users table and
 * forward them to the appropriate surface:
 *
 *   - role=admin → https://admin.smd.services/
 *   - role=client with an entity binding → https://portal.smd.services/
 *   - role=client without a binding → /auth/sign-in?status=no_subscription
 *
 * When the host base URLs are not configured (e.g., local dev without
 * ADMIN_BASE_URL/PORTAL_BASE_URL set), fall back to relative paths so the
 * subdomain rewrite in src/middleware.ts handles routing on a single
 * host.
 */

interface UserBindingRow {
  role: string
  entity_id: string | null
}

export const GET: APIRoute = async ({ locals, redirect }) => {
  const auth = locals.auth()
  if (!auth.userId) {
    return redirect('/auth/sign-in', 302)
  }

  // Admin path first — single-admin venture posture, fast path.
  const adminSession = await resolveAdminSessionFromClerk(auth.userId, env.DB, env.SESSIONS)
  if (adminSession) {
    const target = getAdminBaseUrl(env) ? buildAdminUrl(env, '/') : '/admin'
    return redirect(target, 302)
  }

  // Client path — check if the local users row exists and is bound to
  // an entity. The Clerk bridge ensures a users row exists by the time
  // a Clerk session lands here (JIT-created with role='client'); we
  // re-read here to inspect entity_id.
  const userRow = await env.DB.prepare(
    `SELECT role, entity_id FROM users WHERE clerk_user_id = ? LIMIT 1`
  )
    .bind(auth.userId)
    .first<UserBindingRow>()

  if (!userRow) {
    // Clerk session exists but no local users row yet — surface as
    // unbound until the next portal page load runs ensureLocalUser().
    return redirect('/auth/sign-in?status=no_subscription', 302)
  }

  if (userRow.role !== 'client') {
    // Defense in depth: any unexpected role lands at sign-in. The admin
    // path already returned above; this branch only catches future role
    // additions or data drift.
    return redirect('/auth/sign-in?status=no_subscription', 302)
  }

  // Bound clients land in the portal regardless of which binding path
  // (users.entity_id or entities.clerk_org_id via auth.orgId) resolves
  // their entity. resolveClerkPortalContext figures that out per-route;
  // we just route to portal home and let it render the right state.
  if (userRow.entity_id || auth.orgId) {
    const target = getPortalBaseUrl(env) ? buildPortalUrl(env, '/portal') : '/portal'
    return redirect(target, 302)
  }

  return redirect('/auth/sign-in?status=no_subscription', 302)
}
