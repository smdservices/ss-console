import type { APIRoute } from 'astro'
import { getAssessment } from '../../../../../lib/db/assessments'
import { getTranscript } from '../../../../../lib/storage/r2'
import { env } from 'cloudflare:workers'
import { requireAdminSession } from '../../../../../lib/auth/admin-session'

/**
 * GET /api/admin/assessments/:id/transcript
 *
 * Streams the transcript file from R2.
 *
 * Protected by auth middleware (requires admin role).
 */
export const GET: APIRoute = async ({ locals, params }) => {
  const auth = requireAdminSession(locals)
  if (!auth.ok) return auth.response
  const { session } = auth

  const assessmentId = params.id
  if (!assessmentId) {
    return new Response(JSON.stringify({ error: 'Assessment ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const assessment = await getAssessment(env.DB, session.orgId, assessmentId)
  if (!assessment || !assessment.transcript_path) {
    return new Response(JSON.stringify({ error: 'Transcript not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const object = await getTranscript(env.STORAGE, assessment.transcript_path)
  if (!object) {
    return new Response(JSON.stringify({ error: 'Transcript file not found in storage' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const originalName = object.customMetadata?.originalName ?? 'transcript.txt'

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${originalName}"`,
    },
  })
}
