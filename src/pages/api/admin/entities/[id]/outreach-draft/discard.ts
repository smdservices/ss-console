import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'

interface OutreachDraftRow {
  id: string
  metadata: string | null
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function handlePost({ params, locals, redirect }: APIContext): Promise<Response> {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const entityId = params.id
  if (!entityId) return redirect('/admin/entities?error=missing', 302)

  try {
    const latestDraft = await env.DB.prepare(
      `SELECT id, metadata
       FROM context
       WHERE org_id = ?
         AND entity_id = ?
         AND type = 'outreach_draft'
       ORDER BY created_at DESC
       LIMIT 1`
    )
      .bind(session.orgId, entityId)
      .first<OutreachDraftRow>()

    if (!latestDraft) {
      return redirect(`/admin/entities/${entityId}?draft_discarded=1#entity-diagnostics`, 302)
    }

    const metadata = parseMetadata(latestDraft.metadata)
    metadata.superseded = true

    await env.DB.prepare(`UPDATE context SET metadata = ? WHERE id = ? AND org_id = ?`)
      .bind(JSON.stringify(metadata), latestDraft.id, session.orgId)
      .run()

    return redirect(`/admin/entities/${entityId}?draft_discarded=1#entity-diagnostics`, 302)
  } catch (error) {
    console.error('[api/admin/entities/outreach-draft/discard] Error:', error)
    const message = error instanceof Error ? error.message : 'server'
    return redirect(`/admin/entities/${entityId}?error=${encodeURIComponent(message)}`, 302)
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)
