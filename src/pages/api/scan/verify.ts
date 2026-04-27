/**
 * GET /api/scan/verify?token=... — magic-link click handler (#598, #614).
 *
 * Verifies the inbound token against the SHA-256 hash on file, marks
 * the scan_request as `verified`, and dispatches the durable diagnostic
 * pipeline as a Cloudflare Workflow.
 *
 * Why a Workflow instead of ctx.waitUntil
 * ---------------------------------------
 * Per memory `feedback_ctx_waituntil_for_heavy_work`, heavy work in
 * Workers request handlers must be fire-and-forgotten so the request
 * returns instantly. The original implementation used `ctx.waitUntil` —
 * which works for short async work but blew the isolate budget on
 * happy-path scans (4 Claude calls total ≈ 30s+ wall clock; the isolate
 * was killed mid-call, see #614). Workflows is the durable primitive:
 * the request returns instantly, the pipeline runs out-of-band with
 * per-step checkpointing.
 *
 * The verify endpoint is also used directly by the Astro page
 * `/scan/verify/[token].astro` via a `redirect=1` query string, so the
 * UX is: click magic-link → land on a friendly page → that page POSTs
 * here for the actual verification + side-effects.
 *
 * The endpoint exposes both GET (link click, redirects to confirmation
 * page) and POST (Astro page programmatic call). They share the same
 * verify logic.
 */

import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { hashScanToken, isScanTokenFresh } from '../../../lib/scan/tokens'
import {
  getScanRequestByTokenHash,
  markScanVerified,
  updateScanRequestRun,
} from '../../../lib/db/scan-requests'
import { runDiagnosticScan } from '../../../lib/diagnostic'

interface VerifyResponse {
  ok: boolean
  status:
    | 'verified'
    | 'already_completed'
    | 'expired'
    | 'invalid_token'
    | 'thin_footprint'
    | 'failed'
  /** Domain echoed back so the confirmation page can name the scan. Never
   *  echoed when the token is invalid (no info leak). */
  domain?: string
}

async function handleVerify(token: string, locals: App.Locals): Promise<VerifyResponse> {
  if (!token || typeof token !== 'string') return { ok: false, status: 'invalid_token' }

  const hash = await hashScanToken(token)
  const row = await getScanRequestByTokenHash(env.DB, hash)
  if (!row) return { ok: false, status: 'invalid_token' }

  if (row.scan_status === 'completed') {
    return { ok: true, status: 'already_completed', domain: row.domain }
  }
  if (row.scan_status === 'thin_footprint') {
    return { ok: true, status: 'thin_footprint', domain: row.domain }
  }
  if (row.scan_status === 'failed') {
    return { ok: false, status: 'failed', domain: row.domain }
  }

  // Token must still be within its 24-hour TTL.
  if (!isScanTokenFresh(row.created_at)) {
    return { ok: false, status: 'expired', domain: row.domain }
  }

  // Mark verified, then dispatch the diagnostic pipeline.
  await markScanVerified(env.DB, row.id)

  // Production path: dispatch as a Cloudflare Workflow. Workflows give us
  // durable per-step checkpointing + retries + total-runtime budgets up
  // to hours, replacing the previous ctx.waitUntil flow that blew the
  // isolate budget on happy-path scans (#614).
  if (env.SCAN_WORKFLOW && typeof env.SCAN_WORKFLOW.create === 'function') {
    try {
      const instance = await env.SCAN_WORKFLOW.create({
        params: { scanRequestId: row.id },
      })
      // Persist the Workflow instance id so operators can look up the
      // running scan in the Cloudflare dashboard. Best-effort — failure
      // here doesn't block the response (the workflow is already
      // running).
      await updateScanRequestRun(env.DB, row.id, {
        workflow_run_id: instance.id,
      }).catch((err) => {
        console.error('[api/scan/verify] failed to persist workflow_run_id:', err)
      })
    } catch (err) {
      // If the Workflows runtime itself rejects the dispatch (e.g. quota
      // exceeded, malformed binding), fall through to the dev fallback
      // below so the scan still runs — but log loudly: this is the new
      // hot path and a silent failure here is the bug class #614 was
      // chartered to prevent.
      console.error('[api/scan/verify] SCAN_WORKFLOW.create failed:', err)
      runFallback(row.id, locals)
    }
    return { ok: true, status: 'verified', domain: row.domain }
  }

  // Dev / test fallback: no Workflows binding configured. Run the legacy
  // ctx.waitUntil pipeline so `astro dev`, vitest, and any environment
  // without the Workflows runtime continue to work. This branch must
  // never run in production — verified by the wrangler.toml binding +
  // the smoke test in #614.
  runFallback(row.id, locals)
  return { ok: true, status: 'verified', domain: row.domain }
}

/**
 * Dev/test fallback that runs the diagnostic pipeline inline via
 * ctx.waitUntil (or a fire-and-forget promise). NOT production-ready —
 * subject to the isolate-budget kills documented in #614.
 */
function runFallback(scanRequestId: string, locals: App.Locals): void {
  const ctx = locals.cfContext
  const scanPromise = runDiagnosticScan(
    {
      DB: env.DB,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      GOOGLE_PLACES_API_KEY: env.GOOGLE_PLACES_API_KEY,
      OUTSCRAPER_API_KEY: env.OUTSCRAPER_API_KEY,
      RESEND_API_KEY: env.RESEND_API_KEY,
      APP_BASE_URL: env.APP_BASE_URL,
    },
    scanRequestId
  )

  if (ctx?.waitUntil) {
    ctx.waitUntil(scanPromise)
  } else {
    scanPromise.catch((err) => console.error('[api/scan/verify] dev fallback scan threw:', err))
  }
}

export const GET: APIRoute = async ({ url, locals }) => {
  const token = url.searchParams.get('token') ?? ''
  const result = await handleVerify(token, locals)
  return jsonResponse(result.ok ? 200 : 400, result)
}

export const POST: APIRoute = async ({ request, locals }) => {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonResponse(400, { ok: false, status: 'invalid_token' })
  }
  const token = typeof body.token === 'string' ? body.token : ''
  const result = await handleVerify(token, locals)
  return jsonResponse(result.ok ? 200 : 400, result)
}

function jsonResponse(status: number, data: VerifyResponse): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
