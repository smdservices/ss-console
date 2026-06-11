import type { APIContext, APIRoute } from 'astro'
import { setOperatorPrice } from '../../../../../lib/db/services'
import { env } from 'cloudflare:workers'

/**
 * POST /api/admin/clients/[id]/operator-price
 *
 * Authors the operator's monthly recurring price on the commercial spine
 * (ADR 0046). The form field `monthly_price` is the dollar amount; an empty
 * value clears it (back to unpriced). Writes ONLY the `services` commercial
 * record — never `subscriptions` (that is provisioning's, and gates portal
 * access). Admin-gated. Redirects back to the client hub.
 */

/** Parse the submitted price: '' → null (clear); otherwise a finite, non-negative number. */
function parsePrice(
  raw: FormDataEntryValue | null
): { ok: true; value: number | null } | { ok: false } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: true, value: null }
  const n = Number(raw.trim().replace(/[$,]/g, ''))
  if (!Number.isFinite(n) || n < 0) return { ok: false }
  return { ok: true, value: n }
}

async function handlePost({ request, locals, params, redirect }: APIContext): Promise<Response> {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const entityId = params.id
  if (!entityId) return redirect('/admin/clients?error=missing', 302)

  try {
    const formData = await request.formData()
    const parsed = parsePrice(formData.get('monthly_price'))
    if (!parsed.ok) {
      return redirect(`/admin/clients/${entityId}?error=bad_price`, 302)
    }
    await setOperatorPrice(env.DB, session.orgId, entityId, parsed.value)
    return redirect(`/admin/clients/${entityId}?priced=1`, 302)
  } catch (err) {
    console.error('[api/admin/clients/operator-price] error:', err)
    return redirect(`/admin/clients/${entityId}?error=server`, 302)
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)
