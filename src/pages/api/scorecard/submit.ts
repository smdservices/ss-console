import type { APIContext, APIRoute } from 'astro'
import { findOrCreateEntity } from '../../../lib/db/entities'
import { appendContext } from '../../../lib/db/context'
import { createContact } from '../../../lib/db/contacts'
import { ORG_ID } from '../../../lib/constants'
import { QUESTIONS } from '../../../lib/scorecard/questions'
import {
  computeScores,
  computePainScore,
  computeAutoStage,
  parseEmployeeCount,
} from '../../../lib/scorecard/scoring'
import { SCORE_DESCRIPTIONS } from '../../../lib/scorecard/descriptions'
import { renderScorecardReport } from '../../../lib/pdf/render'
import { sendEmail } from '../../../lib/email/resend'
import { scorecardReportEmailHtml } from '../../../lib/email/templates'

import { env } from 'cloudflare:workers'

/**
 * POST /api/scorecard/submit
 *
 * Public endpoint for scorecard form submission. Creates an entity,
 * contact, and scorecard context entry. Generates and emails PDF report.
 *
 * Security:
 * - Honeypot field rejects bot submissions silently
 * - Minimum completion time check (< 15s = bot)
 * - No auth required (public-facing)
 */
interface ScorecardSubmission {
  firstName: string
  email: string
  businessName: string
  phone: string | null
  vertical: string
  employeeRange: string
  role: string
  answers: Record<string, number>
}

function validateScorecardBody(body: Record<string, unknown>): ScorecardSubmission | Response {
  const firstName = trimString(body.first_name)
  const email = trimString(body.email)
  const businessName = trimString(body.business_name)

  if (!firstName || !email || !businessName) {
    return jsonResponse(400, { error: 'first_name, email, and business_name are required' })
  }

  const answers = body.answers as Record<string, number> | undefined
  if (!answers || typeof answers !== 'object') {
    return jsonResponse(400, { error: 'answers object is required' })
  }
  for (const qid of QUESTIONS.map((q) => q.id)) {
    const val = answers[qid]
    if (typeof val !== 'number' || val < -1 || val > 3) {
      return jsonResponse(400, { error: `Invalid or missing answer for ${qid}` })
    }
  }

  return {
    firstName,
    email,
    businessName,
    phone: trimString(body.phone),
    vertical: trimString(body.vertical) || 'other',
    employeeRange: trimString(body.employee_range) || '11-25',
    role: trimString(body.role) || 'owner',
    answers,
  }
}

type ComputedScores = ReturnType<typeof computeScores>

async function maybeSendScorecardReport(
  sub: ScorecardSubmission,
  scores: ComputedScores
): Promise<void> {
  try {
    const dimensions = scores.dimensions.map((d) => ({
      label: d.label,
      scaled: d.scaled,
      displayLabel: d.displayLabel,
      color: d.color,
      description: SCORE_DESCRIPTIONS[d.id]?.[d.scoreLabel] ?? '',
    }))
    const opportunities = scores.topProblems.map((id) => {
      const dim = scores.dimensions.find((d) => d.id === id)
      return {
        label: dim?.label ?? id,
        description: SCORE_DESCRIPTIONS[id]?.[dim?.scoreLabel ?? 'needs_attention'] ?? '',
      }
    })
    const pdfBytes = await renderScorecardReport({
      firstName: sub.firstName,
      businessName: sub.businessName,
      vertical: sub.vertical,
      overallScore: scores.overall,
      overallDisplayLabel: scores.overallDisplayLabel,
      overallColor: scores.overallColor,
      dimensions,
      opportunities,
      completedAt: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    })
    await sendEmail(env.RESEND_API_KEY, {
      to: sub.email,
      subject: `Your Operations Health Report — ${scores.overall}/100`,
      html: scorecardReportEmailHtml(sub.firstName, scores.overall, scores.overallDisplayLabel),
      attachments: [
        {
          filename: 'operations-health-report.pdf',
          content: uint8ArrayToBase64(pdfBytes),
          content_type: 'application/pdf',
        },
      ],
    })
  } catch (pdfErr) {
    console.error('[api/scorecard/submit] PDF/email error:', pdfErr)
  }
}

function buildScorecardMeta(
  sub: ScorecardSubmission,
  scores: ReturnType<typeof computeScores>,
  painScore: number,
  employeeCount: number | null
): Record<string, unknown> {
  return {
    vertical: sub.vertical,
    employee_range: sub.employeeRange,
    role: sub.role,
    answers: sub.answers,
    dimension_scores: Object.fromEntries(
      scores.dimensions.map((d) => [d.id, { raw: d.raw, scaled: d.scaled, label: d.scoreLabel }])
    ),
    overall_score: scores.overall,
    overall_label: scores.overallLabel,
    top_problems: scores.topProblems,
    pain_score: painScore,
    employee_count: employeeCount,
    first_name: sub.firstName,
    email: sub.email,
    business_name: sub.businessName,
    phone: sub.phone,
  }
}

async function handlePost({ request }: APIContext): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' })
  }

  if (typeof body.website_url === 'string' && body.website_url.trim() !== '')
    return jsonResponse(200, { ok: true })
  if (typeof body.started_at === 'number' && Date.now() - body.started_at < 15000)
    return jsonResponse(200, { ok: true })

  const sub = validateScorecardBody(body)
  if (sub instanceof Response) return sub

  try {
    const scores = computeScores(sub.answers)
    const painScore = computePainScore(scores.overall)
    const autoStage = computeAutoStage(painScore)
    const employeeCount = parseEmployeeCount(sub.employeeRange)

    const { entity } = await findOrCreateEntity(env.DB, ORG_ID, {
      name: sub.businessName,
      stage: autoStage,
      source_pipeline: 'website_scorecard',
    })

    const existingContact = await env.DB.prepare(
      'SELECT id FROM contacts WHERE org_id = ? AND email = ? LIMIT 1'
    )
      .bind(ORG_ID, sub.email)
      .first<{ id: string }>()
    if (!existingContact) {
      await createContact(env.DB, ORG_ID, entity.id, {
        name: sub.firstName,
        email: sub.email,
        phone: sub.phone,
      })
    }

    const topProblemLabels = scores.topProblems.map(
      (id) => scores.dimensions.find((d) => d.id === id)?.label ?? id
    )
    const contentLines = [
      `Operations Health Score: ${scores.overall}/100 (${scores.overallDisplayLabel})`,
      `Vertical: ${sub.vertical} | Team size: ${sub.employeeRange} | Role: ${sub.role}`,
      `Top opportunities: ${topProblemLabels.join(', ')}`,
      '',
      ...scores.dimensions.map((d) => `  ${d.label}: ${d.scaled}/100 (${d.displayLabel})`),
    ]

    const scorecardMeta = buildScorecardMeta(sub, scores, painScore, employeeCount)
    await appendContext(env.DB, ORG_ID, {
      entity_id: entity.id,
      type: 'scorecard',
      content: contentLines.join('\n'),
      source: 'website_scorecard',
      metadata: scorecardMeta,
    })

    await maybeSendScorecardReport(sub, scores)
    return jsonResponse(201, { ok: true, entity_id: entity.id })
  } catch (err) {
    console.error('[api/scorecard/submit] Error:', err)
    return jsonResponse(500, { error: 'Internal server error' })
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)

function trimString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
