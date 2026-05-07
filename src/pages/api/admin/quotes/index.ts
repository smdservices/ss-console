import type { APIContext, APIRoute } from 'astro'
import { createQuote } from '../../../../lib/db/quotes'
import type { LineItem } from '../../../../lib/db/quotes'
import { env } from 'cloudflare:workers'

/**
 * POST /api/admin/quotes
 *
 * Creates a new quote from form data.
 * Line items are submitted as a JSON hidden field.
 *
 * Protected by auth middleware (requires admin role).
 */

type Redirect = APIContext['redirect']

interface ParsedQuoteForm {
  entityId: string
  assessmentId: string
  lineItems: LineItem[]
  rate: number
  depositPct: number
}

function getStringField(formData: FormData, key: string): string | null {
  const v = formData.get(key)
  return v && typeof v === 'string' ? v : null
}

function parseLineItems(json: string): LineItem[] | null {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed as LineItem[]
  } catch {
    return null
  }
}

function parseDepositPct(formData: FormData): number {
  const raw = getStringField(formData, 'deposit_pct')
  const v = raw ? parseFloat(raw) : 0.5
  return isNaN(v) ? 0.5 : v
}

function parseQuoteForm(redirect: Redirect, formData: FormData): ParsedQuoteForm | Response {
  const entityId = getStringField(formData, 'entity_id')
  const assessmentId = getStringField(formData, 'assessment_id')
  const lineItemsJson = getStringField(formData, 'line_items')
  const rateStr = getStringField(formData, 'rate')

  if (!entityId || !assessmentId || !lineItemsJson || !rateStr) {
    return redirect(`/admin/entities/${entityId ?? ''}?error=missing`, 302)
  }

  const lineItems = parseLineItems(lineItemsJson)
  if (!lineItems) {
    return redirect(`/admin/entities/${entityId}?error=invalid_line_items`, 302)
  }

  const rate = parseFloat(rateStr)
  if (isNaN(rate) || rate <= 0) {
    return redirect(`/admin/entities/${entityId}?error=invalid_rate`, 302)
  }

  return { entityId, assessmentId, lineItems, rate, depositPct: parseDepositPct(formData) }
}

async function handlePost({ request, locals, redirect }: APIContext): Promise<Response> {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const formData = await request.formData()
    const parsed = parseQuoteForm(redirect, formData)
    if (parsed instanceof Response) return parsed

    const { entityId, assessmentId, lineItems, rate, depositPct } = parsed

    const quote = await createQuote(env.DB, session.orgId, {
      entityId,
      assessmentId,
      lineItems,
      rate,
      depositPct,
    })

    return redirect(`/admin/entities/${entityId}/quotes/${quote.id}?saved=1`, 302)
  } catch (err) {
    console.error('[api/admin/quotes] Create error:', err)
    return redirect('/admin/entities?error=server', 302)
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)
