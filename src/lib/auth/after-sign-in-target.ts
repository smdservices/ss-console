/**
 * Pure surface-selection logic for the post-sign-in dispatcher
 * (src/pages/auth/after-sign-in.ts).
 *
 * Kept env-free (no `cloudflare:workers` import) so it is unit-testable in a
 * plain Node/vitest context, mirroring the pattern used by
 * src/lib/portal/operator-access.ts (pure resolve, side effects in the route).
 *
 * Why host-awareness: Clerk is one shared identity across the smd.services
 * subdomains (production root-domain deployment → session works on every
 * subdomain automatically). A single human can legitimately be BOTH an admin
 * and a customer-seat user (SMD operating its own dogfooded Operator). The
 * old dispatcher checked admin first and always trumped to the admin host,
 * stranding the portal seat. We instead honor the host the user signed in
 * from — server-observed, never user-supplied — so a dual-eligible user lands
 * on the surface they were actually trying to reach. Single-role users are
 * unaffected: the host-preference only fires when the user qualifies for that
 * surface, and the admin-first default is preserved otherwise.
 */

export type SignedInSurface = 'admin' | 'portal' | 'none'

export interface ChooseSignedInSurfaceOptions {
  /** Hostname of the request that hit the dispatcher (server-observed). */
  host: string
  /** Hostname of the configured admin base URL, or null when unset (local dev). */
  adminHost: string | null
  /** Hostname of the configured portal base URL, or null when unset (local dev). */
  portalHost: string | null
  /** True when the signed-in user resolves to an admin row (role='admin'). */
  adminEligible: boolean
  /** True when the signed-in user is bound to a customer entity (portal seat). */
  portalEligible: boolean
}

/**
 * Decide which surface to route a freshly-signed-in user to.
 *
 * Order:
 *   1. Host preference — if the user qualifies for the surface whose host they
 *      signed in from, send them there (lets a dual-eligible user reach either
 *      surface by signing in on its subdomain).
 *   2. Admin-first default — preserves prior single-admin-venture behavior for
 *      users who are only admin, or who signed in on the apex/an unknown host.
 *   3. Portal — users bound to a customer but not admin.
 *   4. 'none' — authenticated but unprovisioned (caller shows no_subscription).
 */
export function chooseSignedInSurface(opts: ChooseSignedInSurfaceOptions): SignedInSurface {
  const { host, adminHost, portalHost, adminEligible, portalEligible } = opts

  if (portalEligible && portalHost !== null && host === portalHost) return 'portal'
  if (adminEligible && adminHost !== null && host === adminHost) return 'admin'

  if (adminEligible) return 'admin'
  if (portalEligible) return 'portal'
  return 'none'
}

/**
 * Extract the hostname from a base URL string, or null when the input is
 * missing/blank/unparseable. Used to compare the request host against the
 * configured admin/portal origins without throwing on local-dev (unset) config.
 */
export function hostnameOf(baseUrl: string | null | undefined): string | null {
  if (!baseUrl) return null
  try {
    return new URL(baseUrl).hostname
  } catch {
    return null
  }
}
