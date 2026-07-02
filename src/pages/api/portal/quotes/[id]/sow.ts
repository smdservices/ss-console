import type { APIRoute } from 'astro'
import { getPortalClient } from '../../../../../lib/portal/session'
import { getQuoteForEntity } from '../../../../../lib/db/quotes'
import { getPdf } from '../../../../../lib/storage/r2'
import { getSOWStateForQuote } from '../../../../../lib/sow/service'
import { env } from 'cloudflare:workers'
import { errorResponse } from '../../../../../lib/api/helpers'

/**
 * GET /api/portal/quotes/:id/sow
 *
 * Streams the SOW PDF from R2 for the authenticated portal client.
 *
 * Protected by auth middleware (requires client role).
 * Scoped to client_id (not org_id) — portal access pattern.
 */
export const GET: APIRoute = async ({ locals, params }) => {
  const quoteId = params.id
  if (!quoteId) {
    return errorResponse(400, 'Quote ID required')
  }

  // Resolve client via Clerk identity bridge
  const portalData = await getPortalClient(env.DB, locals)
  if (!portalData) {
    return errorResponse(401, 'Unauthorized')
  }
  if (!portalData.client) {
    return errorResponse(403, 'Client not found')
  }

  // Get quote scoped to this client
  const quote = await getQuoteForEntity(
    env.DB,
    portalData.user.org_id,
    portalData.client.id,
    quoteId
  )
  if (!quote) {
    return errorResponse(404, 'Quote not found')
  }

  const sowState = await getSOWStateForQuote(env.DB, portalData.user.org_id, quote.id)
  const revision = sowState.downloadableRevision

  if (!revision) {
    return errorResponse(404, 'SOW not available')
  }

  // Stream PDF from R2
  const key = revision.signed_storage_key ?? revision.unsigned_storage_key
  const object = await getPdf(env.STORAGE, key)
  if (!object) {
    return errorResponse(404, 'SOW file not found in storage')
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="SMD-Services-SOW.pdf"`,
    },
  })
}
