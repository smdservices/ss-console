/**
 * Shared verify+dispatch logic for the magic-link click handler (#647 follow-up).
 *
 * Two callers share this logic:
 *   - `src/pages/api/scan/verify.ts` — JSON API
 *   - `src/pages/scan/verify/[token].astro` — server-rendered confirmation page
 *
 * Before this extraction, the API was migrated to dispatch via the
 * `SCAN_WORKFLOW_SERVICE` binding (#615 then #618), but the page was
 * orphaned on the legacy in-process `runDiagnosticScan` path. The page's
 * `ctx.waitUntil(runDiagnosticScan(...))` was killed by the Worker isolate
 * budget mid-pipeline (4 Claude calls, ~30s+ wall clock), so prospects
 * verified their email, the page rendered "your scan is running," and
 * then... no report ever arrived.
 *
 * Both surfaces now go through `handleVerify` here. The dispatch path is
 * single-source: production uses the service binding to `ss-scan-workflow`,
 * dev/test falls back to the legacy inline pipeline.
 */
import { env } from 'cloudflare:workers'
import { hashScanToken, isScanTokenFresh } from './tokens'
import {
  getScanRequestByTokenHash,
  markScanVerified,
  updateScanRequestRun,
} from '../db/scan-requests'
import { runDiagnosticScan } from '../diagnostic'

export interface VerifyResponse {
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

/**
 * Shape returned by the `ss-scan-workflow` Worker's `/dispatch` endpoint.
 * Mirrors `DispatchResponseBody` in `workers/scan-workflow/src/index.ts`.
 */
interface DispatchSuccessResponse {
  ok: boolean
  workflow_run_id?: string
  error?: string
}

export async function handleVerify(token: string, locals: App.Locals): Promise<VerifyResponse> {
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

  // Production path: dispatch via the service binding to ss-scan-workflow.
  // The service binding is internal — Cloudflare routes the call into
  // the target Worker without ever leaving the data plane, so the URL
  // origin is irrelevant (we use https://internal/ purely as a marker).
  if (env.SCAN_WORKFLOW_SERVICE && typeof env.SCAN_WORKFLOW_SERVICE.fetch === 'function') {
    try {
      const dispatchRes = await env.SCAN_WORKFLOW_SERVICE.fetch('https://internal/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanRequestId: row.id }),
      })

      if (!dispatchRes.ok) {
        const text = await dispatchRes.text().catch(() => '')
        throw new Error(`dispatch returned ${dispatchRes.status}: ${text.slice(0, 200)}`)
      }

      const dispatchBody = (await dispatchRes.json()) as DispatchSuccessResponse
      if (!dispatchBody.ok || !dispatchBody.workflow_run_id) {
        throw new Error(
          `dispatch payload missing workflow_run_id: ${dispatchBody.error ?? 'no_error'}`
        )
      }

      // Persist the Workflow instance id so operators can look up the
      // running scan in the Cloudflare dashboard. Best-effort — failure
      // here doesn't block the response (the workflow is already
      // running). Throw-then-catch the dev fallback path is intentionally
      // NOT taken on a persistence failure: the workflow is live, the
      // user-visible verify is done, and a missing workflow_run_id is a
      // telemetry gap rather than a correctness bug.
      await updateScanRequestRun(env.DB, row.id, {
        workflow_run_id: dispatchBody.workflow_run_id,
      }).catch((err) => {
        console.error('[scan/verify-handler] failed to persist workflow_run_id:', err)
      })
    } catch (err) {
      // If the service binding itself or its handler rejects, fall
      // through to the dev fallback below so the scan still runs — but
      // log loudly: this is the new hot path and a silent failure here
      // is the bug class #618 was chartered to prevent.
      console.error('[scan/verify-handler] SCAN_WORKFLOW_SERVICE dispatch failed:', err)
      runFallback(row.id, locals)
    }
    return { ok: true, status: 'verified', domain: row.domain }
  }

  // Dev / test fallback: no service binding configured. Run the legacy
  // ctx.waitUntil pipeline so `astro dev`, vitest, and any environment
  // without the bound `ss-scan-workflow` Worker continue to work. This
  // branch must never run in production — verified by the [[services]]
  // binding in wrangler.toml + the smoke test in #618.
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
    scanPromise.catch((err) => console.error('[scan/verify-handler] dev fallback scan threw:', err))
  }
}
