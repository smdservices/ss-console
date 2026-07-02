import type { APIRoute } from 'astro'
import { getEngagement } from '../../../../../lib/db/engagements'
import { listDocuments } from '../../../../../lib/storage/r2'
import { env } from 'cloudflare:workers'
import { requireAdminSession } from '../../../../../lib/auth/admin-session'
import { errorResponse, jsonResponse } from '../../../../../lib/api/helpers'

export const POST: APIRoute = async ({ request, locals, params }) => {
  const auth = requireAdminSession(locals)
  if (!auth.ok) return auth.response
  const { session } = auth
  const engagementId = params.id
  if (!engagementId) {
    return errorResponse(400, 'Engagement ID required')
  }
  try {
    const engagement = await getEngagement(env.DB, session.orgId, engagementId)
    if (!engagement) {
      return errorResponse(404, 'Engagement not found')
    }
    const formData = await request.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return errorResponse(400, 'File required')
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const key = `${session.orgId}/engagements/${engagementId}/docs/${safeName}`
    const arrayBuffer = await file.arrayBuffer()
    await env.STORAGE.put(key, arrayBuffer, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { originalName: file.name, uploadedAt: new Date().toISOString() },
    })
    return jsonResponse(201, { key, name: safeName })
  } catch (err) {
    console.error('[api/admin/engagements/[id]/deliverables] Upload error:', err)
    return errorResponse(500, 'Internal server error')
  }
}

export const GET: APIRoute = async ({ locals, params }) => {
  const auth = requireAdminSession(locals)
  if (!auth.ok) return auth.response
  const { session } = auth
  const engagementId = params.id
  if (!engagementId) {
    return errorResponse(400, 'Engagement ID required')
  }
  try {
    const engagement = await getEngagement(env.DB, session.orgId, engagementId)
    if (!engagement) {
      return errorResponse(404, 'Engagement not found')
    }
    const prefix = `${session.orgId}/engagements/${engagementId}/docs/`
    const objects = await listDocuments(env.STORAGE, prefix)
    const files = objects.map((obj) => ({
      key: obj.key,
      name: obj.key.split('/').pop() ?? obj.key,
      size: obj.size,
      uploaded: obj.uploaded.toISOString(),
    }))
    return jsonResponse(200, { files })
  } catch (err) {
    console.error('[api/admin/engagements/[id]/deliverables] List error:', err)
    return errorResponse(500, 'Internal server error')
  }
}
