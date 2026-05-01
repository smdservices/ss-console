/**
 * GET/POST /api/scan/verify — magic-link click handler (#598, #614, #618).
 *
 * The actual verify+dispatch logic lives in `src/lib/scan/verify-handler.ts`
 * so the same code path is shared with the server-rendered confirmation
 * page at `src/pages/scan/verify/[token].astro`. Before that extraction the
 * page was orphaned on the legacy in-process pipeline, which the Worker
 * isolate budget killed mid-scan. See `verify-handler.ts` for the full
 * dispatch story.
 */

import type { APIRoute } from 'astro'
import { handleVerify, type VerifyResponse } from '../../../lib/scan/verify-handler'

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
