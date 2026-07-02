import type { APIRoute } from 'astro'
import { resolveOperatorAccess } from '../../../../../../lib/portal/operator-access'
import { env } from 'cloudflare:workers'
import { errorResponse } from '../../../../../../lib/api/helpers'

/**
 * POST /api/portal/operator/promotion-cards/[skill]/dismiss
 *
 * Dismiss the "Skill ready for promotion?" recommendation card for the
 * given skill on the caller's Operator landing page. Driven by HTML
 * <form method="POST"> submissions from `PromotionCard.astro`; no JSON
 * / fetch client.
 *
 * Form fields:
 *   returnTo: TEXT (optional) — server-validated path to redirect back
 *                                to on success. Defaults to the AI
 *                                Employee landing when missing or
 *                                pointing at an unsafe target.
 *
 * Authorization:
 *   - Clerk session required (middleware enforces)
 *   - Active Operator subscription on the entity
 *   - Caller holds the `principal` role. The trust-ceiling promotion is
 *     a firm-level decision per platform-prd.md §11.3; only the
 *     principal can defer it. Operator and compliance get a redirect
 *     to the landing (which never rendered the card for them anyway,
 *     but defense in depth at the write path keeps the gate honest).
 *
 * Persistence: upserts into `promotion_card_dismissals` keyed by
 * (entity_id, skill). A second dismissal for the same skill refreshes
 * the timestamp (extending the cooldown), which matches the user
 * intent: clicking dismiss again means "keep this hidden a while
 * longer". The resolver's cooldown comparison is against the most
 * recent dismissal.
 *
 * Contract semantics: this endpoint is intent-idempotent. POSTing for a
 * skill that is not currently a candidate still records the dismissal
 * and 303s back — the page resolver decides whether to render anything,
 * and the dismissal harmlessly ages out if no candidate ever appears.
 * This keeps the URL contract uniform under racing renders.
 */

const OPERATOR_LANDING = '/portal/products/operator'

/**
 * Server-side allowlist of return-target paths. POST handlers must not
 * redirect to caller-supplied absolute URLs — that's an open redirect.
 * We accept same-origin paths under /portal/products/operator only,
 * which is the surface set that has a legitimate reason to invoke the
 * dismissal flow.
 */
function resolveReturnTarget(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string') return OPERATOR_LANDING
  const trimmed = raw.trim()
  if (trimmed.length === 0) return OPERATOR_LANDING
  if (!trimmed.startsWith('/portal/products/operator')) {
    return OPERATOR_LANDING
  }
  // Defense in depth: reject protocol-relative (`//evil.example`) and
  // scheme-relative (`javascript:`) inputs.
  if (trimmed.startsWith('//')) return OPERATOR_LANDING
  if (trimmed.includes(':')) return OPERATOR_LANDING
  return trimmed
}

function jsonError(status: number, message: string): Response {
  return errorResponse(status, message)
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  const skill = params.skill
  if (typeof skill !== 'string' || skill.length === 0) {
    return jsonError(400, 'Missing skill')
  }
  // Cap on skill identifier length so a hostile client can't fill the
  // table with arbitrarily long rows. The persona-skill names emitted
  // by Hermes are short slugs; 200 is generous and matches what would
  // round-trip safely in URLs and logs.
  if (skill.length > 200) {
    return jsonError(400, 'Skill identifier too long')
  }

  const access = await resolveOperatorAccess(env.DB, locals, {
    allowedRoles: ['principal'],
  })
  if (access.kind === 'redirect') {
    return new Response(null, {
      status: 303,
      headers: { Location: access.to },
    })
  }

  const formData = await request.formData()
  const returnTarget = resolveReturnTarget(formData.get('returnTo'))

  // Upsert by primary key (entity_id, skill). ON CONFLICT refreshes the
  // dismissed_at timestamp and the actor, extending the cooldown and
  // recording the most recent dismisser.
  await env.DB.prepare(
    `INSERT INTO promotion_card_dismissals (entity_id, skill, dismissed_by, dismissed_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(entity_id, skill) DO UPDATE SET
       dismissed_by = excluded.dismissed_by,
       dismissed_at = excluded.dismissed_at`
  )
    .bind(access.client.id, skill, access.user.id)
    .run()

  return new Response(null, {
    status: 303,
    headers: { Location: returnTarget },
  })
}
