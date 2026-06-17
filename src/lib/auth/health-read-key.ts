/**
 * Auth verifier for the fleet-health read endpoint
 * (`GET /api/admin/fleet/health`). The caller is the SMD dogfood Operator
 * (customer-zero) — a Machine, not a browser — so Clerk session auth is not
 * applicable. Instead, a dedicated bearer secret (`OPERATOR_HEALTH_READ_KEY`)
 * is held only by customer-zero and verified here with a constant-time compare.
 *
 * This is intentionally separate from `machine-key.ts` (the write credential
 * for heartbeat / runtime-summary pushes). Keeping the read and write keys
 * distinct means a compromised heartbeat key cannot be used to read fleet data,
 * and vice versa.
 *
 * No DB lookup is required: this endpoint is fleet-wide, not per-tenant, so
 * there is no slug to resolve.
 */

export function verifyHealthReadKey(request: Request, expectedKey: string | undefined): boolean {
  if (!expectedKey) return false
  const auth = request.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return false
  const provided = auth.slice('Bearer '.length)
  return constantTimeEqual(provided, expectedKey)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
