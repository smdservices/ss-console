/**
 * GET /api/internal/operator/:slug/runtime-config
 *
 * The console-side seam the operator **drift audit** (Phase B Cut D-act) reads.
 * The scheduled GitHub Action cannot hold the master read secret, so it calls
 * THIS route with a narrow, single-purpose token; the route derives the
 * per-customer key server-side (where the master already lives) and returns the
 * Machine's `operator.runtime.config/v1` snapshot. The master
 * (`OPERATOR_RUNTIME_READ_SECRET`) never leaves ss-web — location count stays at
 * exactly one.
 *
 * It lives under `/api/internal/*` (not `/api/admin/*`) on purpose: the admin
 * middleware session-gates every `/api/admin/*` path, which a headless CI caller
 * cannot satisfy. Internal routes do their own token auth.
 *
 * Security posture (this is a credentialed endpoint, treated as one):
 *  - **Scoped token, fail-closed.** `OPERATOR_DRIFT_AUDIT_TOKEN` is a dedicated
 *    read-config-only secret. Unset → 503 (never open). Missing/typo'd bearer →
 *    opaque 401, constant-time compared.
 *  - **Slug allow-list, no enumeration.** Any `:slug` that is not a provisioned
 *    customer (per the Fly app registry) → 404, before any work.
 *  - **Read-only, presence-only.** The snapshot is presence-only by construction
 *    (see the overlay's config_snapshot); this route adds no new data, only the
 *    auth hop. Every call is recorded to `operator_runtime_read_audit`.
 *  - **no-store**, so a snapshot never lands in a shared cache.
 */

import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { constantTimeEqual } from '../../../../../lib/auth/machine-key'
import { resolveCustomerFlyApp } from '../../../../../lib/operator/fly-app-registry'
import {
  createMachineRuntimeTransport,
  createRuntimeReadAudit,
  isRuntimeReadConfigured,
} from '../../../../../lib/operator/runtime-read-transport'
import { RuntimeReadUnauthorizedError } from '../../../../../lib/operator/runtime-read'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function recordRead(
  slug: string,
  outcome: 'ok' | 'unauthorized' | 'unreachable'
): Promise<void> {
  // Best-effort: a failed audit write must never change the read outcome.
  try {
    const audit = createRuntimeReadAudit(env.DB, { actorUserId: 'drift-audit' })
    await audit.record({
      customerSlug: slug,
      actor: 'drift-audit',
      actorRole: 'system',
      kind: 'config',
      outcome,
    })
  } catch {
    /* swallow */
  }
}

export const GET: APIRoute = async ({ request, params }) => {
  // 1. Scoped-token auth (fail-closed). The audit holds ONLY this token.
  const token = env.OPERATOR_DRIFT_AUDIT_TOKEN
  if (!token) return json({ error: 'not_configured' }, 503)
  const authHeader = request.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)
  if (!constantTimeEqual(authHeader.slice('Bearer '.length), token)) {
    return json({ error: 'unauthorized' }, 401)
  }

  // 2. Slug allow-list — refuse any non-provisioned slug before any work.
  const slug = params.slug ?? ''
  if (!slug || !resolveCustomerFlyApp(slug)) return json({ error: 'unknown_customer' }, 404)

  // 3. The read-config path itself must be configured (master + host template).
  if (!isRuntimeReadConfigured(env)) return json({ error: 'read_not_configured' }, 503)

  // 4. Derive the per-customer key server-side + fetch the snapshot.
  try {
    const { data } = await createMachineRuntimeTransport(env).read(slug, { kind: 'config' })
    await recordRead(slug, 'ok')
    return json(data, 200)
  } catch (err) {
    const outcome = err instanceof RuntimeReadUnauthorizedError ? 'unauthorized' : 'unreachable'
    await recordRead(slug, outcome)
    return json({ error: 'read_failed' }, 502)
  }
}
