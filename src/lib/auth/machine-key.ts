/**
 * Auth verifier for per-customer AI Employee Machine → control-plane writes
 * (the heartbeat endpoint at `POST /api/internal/heartbeat` in Wave 1).
 *
 * Wave 1 shape: SINGLE SHARED SECRET. One `MACHINE_HEARTBEAT_KEY` Worker
 * secret authenticates every Machine; the `X-Tenant-Slug` header carries
 * the tenant identity. No per-tenant DB key lookup means no timing-oracle
 * path on slug enumeration — verification is a constant-time string
 * compare against the env secret regardless of which slug is presented.
 *
 * The slug is resolved to `entity_id` via a separate `customer_configs`
 * lookup AFTER the bearer compare succeeds. A miss on the slug returns
 * 401 (not 404) so the response shape is identical to a bad-key response;
 * a probing attacker cannot tell whether they have a valid key or whether
 * the slug exists.
 *
 * Upgrade path for customer #2 (per ADR 0023 §"Cross-cutting calls" #10):
 * swap this module's body to read a per-tenant `key_hash` from a new
 * `machine_credentials` table, with HMAC-SHA256 + per-row salt and
 * dual-key rotation (current + prev hash with TTL). Callers stay the
 * same — only this file changes. Documented in ADR 0023 line ~136.
 */

import type { D1Database } from '@cloudflare/workers-types'

export type VerifyResult = { ok: true; entityId: string; slug: string } | { ok: false; status: 401 }

const FAIL: VerifyResult = { ok: false, status: 401 }

/**
 * Verify an inbound Machine request carries a valid bearer + slug.
 * Returns the resolved entity_id on success, 401 otherwise.
 *
 * Failure cases (all return the same shape — no information disclosure
 * about which check failed):
 * - Missing or malformed Authorization header
 * - Server misconfigured (env.MACHINE_HEARTBEAT_KEY unset)
 * - Bearer value does not match the shared key
 * - X-Tenant-Slug header missing or empty
 * - Slug not found in customer_configs
 */
export async function verifyMachineRequest(
  request: Request,
  expectedKey: string | undefined,
  db: D1Database
): Promise<VerifyResult> {
  const auth = request.headers.get('Authorization') ?? ''
  const slug = request.headers.get('X-Tenant-Slug') ?? ''
  if (!auth.startsWith('Bearer ')) return FAIL
  const provided = auth.slice('Bearer '.length)
  const expected = expectedKey ?? ''
  if (!expected) return FAIL
  if (!constantTimeEqual(provided, expected)) return FAIL
  if (slug.length === 0) return FAIL

  const row = await db
    .prepare('SELECT entity_id FROM customer_configs WHERE customer_slug = ?')
    .bind(slug)
    .first<{ entity_id: string }>()
  if (!row) return FAIL
  return { ok: true, entityId: row.entity_id, slug }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
