import type { APIRoute } from 'astro'
import {
  getAssessment,
  updateAssessment,
  updateAssessmentStatus,
} from '../../../../lib/db/assessments'
import type { AssessmentStatus } from '../../../../lib/db/assessments'
import { uploadTranscript, getTranscript } from '../../../../lib/storage/r2'
import { PROBLEM_IDS } from '../../../../portal/assessments/extraction-schema'
import type { ProblemId } from '../../../../portal/assessments/extraction-schema'
import { extractAssessment } from '../../../../lib/claude/extract'

/**
 * POST /api/admin/assessments/:id
 *
 * Updates an existing assessment from form data.
 * Handles transcript upload, extraction JSON, problem mapping, champion info,
 * disqualification flags, and status transitions.
 *
 * Protected by auth middleware (requires admin role).
 */
export const POST: APIRoute = async ({ request, locals, redirect, params }) => {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const assessmentId = params.id
  if (!assessmentId) {
    return new Response(JSON.stringify({ error: 'Assessment ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const env = locals.runtime.env

  try {
    const existing = await getAssessment(env.DB, session.orgId, assessmentId)
    if (!existing) {
      return redirect('/admin/clients?error=not_found', 302)
    }

    const formData = await request.formData()
    const action = formData.get('action')

    // Handle status transition as a separate action
    if (action === 'transition_status') {
      const newStatus = formData.get('new_status')
      if (!newStatus || typeof newStatus !== 'string') {
        return redirect(
          `/admin/clients/${existing.client_id}/assessments/${assessmentId}?error=invalid_status`,
          302
        )
      }

      // Check financial prerequisite gate (OQ-004)
      const financialConfirmed = formData.get('financial_confirmed')
      if (
        newStatus === 'converted' &&
        existing.problems &&
        existing.problems.includes('financial_blindness') &&
        financialConfirmed !== 'yes'
      ) {
        return redirect(
          `/admin/clients/${existing.client_id}/assessments/${assessmentId}?warning=financial_prerequisite`,
          302
        )
      }

      try {
        await updateAssessmentStatus(
          env.DB,
          session.orgId,
          assessmentId,
          newStatus as AssessmentStatus
        )
      } catch (err) {
        console.error('[api/admin/assessments/[id]] Status transition error:', err)
        return redirect(
          `/admin/clients/${existing.client_id}/assessments/${assessmentId}?error=invalid_transition`,
          302
        )
      }

      return redirect(
        `/admin/clients/${existing.client_id}/assessments/${assessmentId}?saved=1`,
        302
      )
    }

    // Handle Claude API extraction
    if (action === 'extract') {
      // Verify transcript exists
      if (!existing.transcript_path) {
        return redirect(
          `/admin/clients/${existing.client_id}/assessments/${assessmentId}?error=no_transcript`,
          302
        )
      }

      // Verify API key is configured
      const apiKey = env.ANTHROPIC_API_KEY
      if (!apiKey) {
        return redirect(
          `/admin/clients/${existing.client_id}/assessments/${assessmentId}?error=no_api_key`,
          302
        )
      }

      // Fetch transcript text from R2
      const transcriptObject = await getTranscript(env.STORAGE, existing.transcript_path)
      if (!transcriptObject) {
        return redirect(
          `/admin/clients/${existing.client_id}/assessments/${assessmentId}?error=transcript_missing`,
          302
        )
      }
      const transcriptText = await transcriptObject.text()

      // Call Claude API for extraction
      try {
        const result = await extractAssessment(apiKey, transcriptText)

        // Update assessment record with extraction results
        await updateAssessment(env.DB, session.orgId, assessmentId, {
          extraction: JSON.stringify(result),
          problems: JSON.stringify(result.identified_problems.map((p) => p.problem_id)),
          champion_name: result.champion_candidate?.name ?? null,
          champion_role: result.champion_candidate?.role ?? null,
          disqualifiers: JSON.stringify(result.disqualification_flags),
        })

        return redirect(
          `/admin/clients/${existing.client_id}/assessments/${assessmentId}?extracted=1`,
          302
        )
      } catch (err) {
        console.error('[api/admin/assessments/[id]] Extraction error:', err)
        return redirect(
          `/admin/clients/${existing.client_id}/assessments/${assessmentId}?error=extraction_failed`,
          302
        )
      }
    }

    // Handle general update
    const scheduledAt = formData.get('scheduled_at')
    const durationMinutes = formData.get('duration_minutes')
    const extraction = formData.get('extraction')
    const championName = formData.get('champion_name')
    const championRole = formData.get('champion_role')
    const notes = formData.get('notes')

    // Build problems JSON from checkboxes
    const selectedProblems: ProblemId[] = []
    for (const problemId of PROBLEM_IDS) {
      if (formData.get(`problem_${problemId}`) === 'on') {
        selectedProblems.push(problemId)
      }
    }

    // Build disqualifiers JSON from checkboxes
    const disqualifiers = {
      hard: {
        not_decision_maker: formData.get('dq_not_decision_maker') === 'on',
        scope_exceeds_sprint: formData.get('dq_scope_exceeds_sprint') === 'on',
        no_tech_baseline: formData.get('dq_no_tech_baseline') === 'on',
      },
      soft: {
        no_champion: formData.get('dq_no_champion') === 'on',
        books_behind: formData.get('dq_books_behind') === 'on',
        no_willingness_to_change: formData.get('dq_no_willingness_to_change') === 'on',
      },
      notes:
        formData.get('dq_notes') && typeof formData.get('dq_notes') === 'string'
          ? (formData.get('dq_notes') as string).trim()
          : '',
    }

    // Handle transcript upload
    let transcriptPath: string | undefined = undefined
    const transcriptFile = formData.get('transcript')
    if (transcriptFile && transcriptFile instanceof File && transcriptFile.size > 0) {
      transcriptPath = await uploadTranscript(
        env.STORAGE,
        session.orgId,
        assessmentId,
        transcriptFile
      )
    }

    const updateData: Record<string, string | number | null | undefined> = {
      scheduled_at:
        scheduledAt && typeof scheduledAt === 'string' && scheduledAt.trim()
          ? new Date(scheduledAt.trim()).toISOString()
          : null,
      duration_minutes:
        durationMinutes && typeof durationMinutes === 'string' && durationMinutes.trim()
          ? parseInt(durationMinutes, 10) || null
          : null,
      extraction:
        extraction && typeof extraction === 'string' && extraction.trim()
          ? extraction.trim()
          : existing.extraction,
      problems: JSON.stringify(selectedProblems),
      disqualifiers: JSON.stringify(disqualifiers),
      champion_name:
        championName && typeof championName === 'string' && championName.trim()
          ? championName.trim()
          : null,
      champion_role:
        championRole && typeof championRole === 'string' && championRole.trim()
          ? championRole.trim()
          : null,
      notes: notes && typeof notes === 'string' ? notes.trim() || null : undefined,
    }

    if (transcriptPath !== undefined) {
      updateData.transcript_path = transcriptPath
    }

    await updateAssessment(env.DB, session.orgId, assessmentId, updateData)

    return redirect(`/admin/clients/${existing.client_id}/assessments/${assessmentId}?saved=1`, 302)
  } catch (err) {
    console.error('[api/admin/assessments/[id]] Update error:', err)
    return redirect(`/admin/clients?error=server`, 302)
  }
}
