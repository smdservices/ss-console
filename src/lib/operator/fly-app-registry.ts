/**
 * Explicit `customer_id → Fly app` registry — the single source of truth for
 * mapping a customer to its per-customer Fly app.
 *
 * Deliberately NOT a `hermes-${id}` string convention: addressing the wrong app
 * is a cross-tenant action (setting a secret on the wrong Machine, or reading
 * the wrong Machine's runtime), so an unlisted customer is **rejected** rather
 * than guessed (ADR 0036). Graduates to a customer.yaml/D1 lookup as customers
 * are added (ADR 0012). customer-zero ("smd") → `hermes-smd`.
 *
 * Both the OAuth token relay (`src/lib/oauth/store.ts`, ADR 0036) and the
 * console→Machine runtime read transport (`runtime-read-transport.ts`, ADR
 * 0043) resolve through here so the two paths can never drift on which app a
 * customer maps to.
 */

const CUSTOMER_FLY_APPS: Readonly<Record<string, string>> = Object.freeze({
  smd: 'hermes-smd',
})

/**
 * Resolve a customer_id to its Fly app name, or null when the customer is not
 * in the registry. A null result MUST be treated as "refuse to target any app"
 * — never fall back to a guessed name.
 */
export function resolveCustomerFlyApp(customerId: string): string | null {
  return CUSTOMER_FLY_APPS[customerId] ?? null
}

/** Test/introspection helper: the registered customer_ids. */
export function registeredCustomerIds(): string[] {
  return Object.keys(CUSTOMER_FLY_APPS)
}
