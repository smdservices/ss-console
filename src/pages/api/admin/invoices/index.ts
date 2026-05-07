import type { APIContext, APIRoute } from 'astro'
import { createInvoice } from '../../../../lib/db/invoices'
import type { InvoiceType } from '../../../../lib/db/invoices'
import { env } from 'cloudflare:workers'

const VALID_TYPES: InvoiceType[] = ['deposit', 'completion', 'milestone', 'assessment', 'retainer']

/**
 * POST /api/admin/invoices
 *
 * Creates a new invoice from form data.
 *
 * Protected by auth middleware (requires admin role).
 */

function parseInvoiceForm(
  formData: FormData
): { clientId: string; type: string; amountStr: string; redirectUrl: string | null } | null {
  const clientId = formData.get('client_id')
  const type = formData.get('type')
  const amountStr = formData.get('amount')
  const redirectUrl = formData.get('redirect_url')
  if (
    !clientId ||
    typeof clientId !== 'string' ||
    !type ||
    typeof type !== 'string' ||
    !amountStr ||
    typeof amountStr !== 'string'
  ) {
    return null
  }
  return {
    clientId,
    type,
    amountStr,
    redirectUrl: typeof redirectUrl === 'string' ? redirectUrl : null,
  }
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
    const parsed = parseInvoiceForm(formData)
    const redirectUrl = formData.get('redirect_url')
    const defaultTarget = '/admin/entities'
    const target = typeof redirectUrl === 'string' ? redirectUrl : defaultTarget

    if (!parsed) {
      return redirect(`${target}?error=missing`, 302)
    }

    const { clientId, type, amountStr } = parsed

    if (!VALID_TYPES.includes(type as InvoiceType)) {
      return redirect(`${target}?error=invalid_type`, 302)
    }

    const amount = parseFloat(amountStr)
    if (isNaN(amount) || amount <= 0) {
      return redirect(`${target}?error=invalid_amount`, 302)
    }

    const engagementId = formData.get('engagement_id')
    const description = formData.get('description')
    const dueDate = formData.get('due_date')

    await createInvoice(env.DB, session.orgId, {
      entity_id: clientId,
      engagement_id: typeof engagementId === 'string' && engagementId.trim() ? engagementId : null,
      type: type as InvoiceType,
      amount,
      description:
        typeof description === 'string' && description.trim() ? description.trim() : null,
      due_date: typeof dueDate === 'string' && dueDate.trim() ? dueDate.trim() : null,
    })

    return redirect(`${target}?created=1`, 302)
  } catch (err) {
    console.error('[api/admin/invoices] Create error:', err)
    return redirect('/admin/entities?error=server', 302)
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)
