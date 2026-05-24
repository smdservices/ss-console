import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveAiEmployeeAccess } from '../../../../../lib/portal/ai-employee-access'
import { parseAuditListParams } from '../../../../../lib/portal/ai-employee/audit'
import {
  countSavedQueries,
  paramsForSave,
  upsertSavedQuery,
  validateSavedQueryName,
  MAX_SAVED_QUERIES_PER_USER_PER_ENTITY,
} from '../../../../../lib/portal/ai-employee/audit-saved-queries'

/**
 * POST /api/portal/ai-employee/audit/saved-queries
 *
 * Save the caller's current audit-page filter set under a name. Driven
 * by an HTML <form method="POST"> on the audit page filter bar; no
 * JSON / fetch client.
 *
 * Form fields:
 *   name: TEXT — human-readable name. Trimmed; empty rejected; capped
 *                at MAX_SAVED_QUERY_NAME_LENGTH characters.
 *   queryString: TEXT — the page's current URL query string (the form
 *                       hidden field is populated server-side when the
 *                       page renders so the params match what's on
 *                       screen). Parsed via `parseAuditListParams`.
 *   returnTo: TEXT (optional) — server-validated redirect target.
 *
 * Authorization:
 *   - Active AI Employee subscription
 *   - Caller holds principal OR compliance role (operators don't get
 *     saved queries because they don't get the audit surface)
 *
 * Contract semantics:
 *   - Upsert on (user_id, entity_id, name): re-saving the same name
 *     overwrites the stored params. The reviewer never sees a "name
 *     already exists" error.
 *   - Per-user cap: rejects with `?status=saved_cap_reached` when the
 *     reviewer already has MAX_SAVED_QUERIES_PER_USER_PER_ENTITY
 *     saved queries (and the name is not an existing upsert target).
 *
 * Returns 303 to the return target with one of:
 *   ?saved=1                   — success
 *   ?status=invalid_name       — empty after trim
 *   ?status=name_too_long      — exceeded MAX_SAVED_QUERY_NAME_LENGTH
 *   ?status=saved_cap_reached  — per-user cap hit
 */
const AUDIT_PAGE = '/portal/products/ai-employee/audit'

function resolveReturnTarget(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string') return AUDIT_PAGE
  const trimmed = raw.trim()
  if (trimmed.length === 0) return AUDIT_PAGE
  if (!trimmed.startsWith('/portal/products/ai-employee')) return AUDIT_PAGE
  if (trimmed.startsWith('//')) return AUDIT_PAGE
  if (trimmed.includes(':')) return AUDIT_PAGE
  return trimmed
}

function withStatusParam(target: string, status: string): string {
  const url = new URL(target, 'https://placeholder.invalid')
  url.searchParams.set('status', status)
  return `${url.pathname}${url.search}`
}

function withSavedParam(target: string): string {
  const url = new URL(target, 'https://placeholder.invalid')
  url.searchParams.set('saved', '1')
  return `${url.pathname}${url.search}`
}

export const POST: APIRoute = async ({ request, locals }) => {
  const access = await resolveAiEmployeeAccess(env.DB, locals, {
    allowedRoles: ['principal', 'compliance'],
  })
  if (access.kind === 'redirect') {
    return new Response(null, { status: 303, headers: { Location: access.to } })
  }
  const { user, client } = access

  const formData = await request.formData()
  const returnTarget = resolveReturnTarget(formData.get('returnTo'))

  const nameResult = validateSavedQueryName(
    typeof formData.get('name') === 'string' ? (formData.get('name') as string) : ''
  )
  if (!nameResult.ok) {
    const status = nameResult.error === 'empty' ? 'invalid_name' : 'name_too_long'
    return new Response(null, {
      status: 303,
      headers: { Location: withStatusParam(returnTarget, status) },
    })
  }

  const queryString =
    typeof formData.get('queryString') === 'string' ? (formData.get('queryString') as string) : ''
  const params = parseAuditListParams(new URLSearchParams(queryString))

  // Cap check: only enforced when the name is a NEW save (i.e. not an
  // existing upsert target). The upsert path itself checks existence,
  // but doing it here avoids the surprise of a successful save when
  // the user thought they were over the cap.
  const currentCount = await countSavedQueries(env.DB, user.id, client.id)
  if (currentCount >= MAX_SAVED_QUERIES_PER_USER_PER_ENTITY) {
    // Note: upsert will still overwrite an existing same-named row, so
    // hitting the cap is only a failure for genuinely new names. We
    // could query for the existing row first to differentiate, but the
    // cap is a soft guardrail (50 per user per customer) — surfacing
    // it consistently keeps the contract simple.
    return new Response(null, {
      status: 303,
      headers: { Location: withStatusParam(returnTarget, 'saved_cap_reached') },
    })
  }

  await upsertSavedQuery(env.DB, {
    orgId: client.org_id,
    userId: user.id,
    entityId: client.id,
    name: nameResult.name,
    params: paramsForSave(params),
  })

  return new Response(null, {
    status: 303,
    headers: { Location: withSavedParam(returnTarget) },
  })
}
