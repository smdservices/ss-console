/**
 * POST /api/portal/operator/drafts/:id/teach
 *
 * Inline rule-add endpoint for the Operator draft detail page (#810).
 *
 * Per platform-prd.md §10.3 + UX Lead Gap 2, this is the inline route a
 * partner uses to add a memory rule while reviewing a draft. The rule
 * lands in the customer's memory_rules dataset via the bridge follow-on
 * (#821); for v1 the endpoint records the partner's intent as a
 * structured audit log line that the Hermes-side tail-log drain
 * consumes.
 *
 * Authorization:
 *   - Clerk session present                (middleware)
 *   - Local entity bound to Clerk org      (resolveOperatorAccess)
 *   - Active Operator subscription      (resolveOperatorAccess)
 *   - Caller holds `principal` OR `operator` role. `compliance` is
 *     read-only per ADR 0005 — this endpoint rejects compliance with
 *     403. The role gate matches the send endpoint exactly.
 *
 * Request shape:
 *   POST with JSON body `{ kind, text, recipientCohort? }`. Validation
 *   lives in `validateTeachMarcusInput` so the form-handler tests can
 *   pin every branch without mocking persistence.
 *
 * Response shape:
 *   200 OK with JSON `{ ok: true, auditTimestamp }` on success.
 *   400 with JSON `{ ok: false, reason, field }` on validation failure.
 *   403 with JSON `{ ok: false, reason: '...', field: null }` on
 *       access failure.
 *   404 with JSON `{ ok: false, reason: '...', field: null }` when the
 *       draft does not exist.
 *
 * Audit:
 *   Every successful call emits a `MEMORY_RULE_ADDED` audit event via
 *   `recordMemoryRuleAddedAudit`. The event records the approver, the
 *   customer id, the source draft id, the rule kind, the rule text
 *   length (not the body — short rules contain authored prose), the
 *   optional recipient cohort, and the timestamp.
 *
 * Persistence seam (#821 + memory-rule bridge follow-on):
 *   The portal D1 has no `memory_rules` or `pending_memory_rules`
 *   table today. The bridge follow-on owns persistence and runtime
 *   propagation. This endpoint records the partner's action in the
 *   audit channel so it is recoverable when the bridge ships.
 */

import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveOperatorAccess } from '../../../../../../lib/portal/operator-access'
import { getDraft } from '../../../../../../lib/portal/operator/drafts'
import {
  buildMemoryRuleAddedAuditEvent,
  recordMemoryRuleAddedAudit,
  validateTeachMarcusInput,
} from '../../../../../../lib/portal/operator/teach-marcus'

const ROLES_THAT_CAN_TEACH = ['principal', 'staff'] as const

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface ParsedBody {
  kind: string | null
  text: string | null
  recipientCohort: string | null
}

async function parseBody(request: Request): Promise<ParsedBody> {
  try {
    const raw: unknown = await request.json()
    if (raw === null || typeof raw !== 'object') {
      return { kind: null, text: null, recipientCohort: null }
    }
    const obj = raw as Record<string, unknown>
    const kind = typeof obj.kind === 'string' ? obj.kind : null
    const text = typeof obj.text === 'string' ? obj.text : null
    const recipientCohort = typeof obj.recipientCohort === 'string' ? obj.recipientCohort : null
    return { kind, text, recipientCohort }
  } catch {
    return { kind: null, text: null, recipientCohort: null }
  }
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  const draftId = params.id
  if (typeof draftId !== 'string' || draftId === '') {
    return jsonResponse(400, {
      ok: false,
      reason: 'Missing draft id.',
      field: null,
    })
  }

  const access = await resolveOperatorAccess(env.DB, locals, {
    allowedRoles: ROLES_THAT_CAN_TEACH,
  })
  if (access.kind === 'redirect') {
    return jsonResponse(403, {
      ok: false,
      reason: 'You do not have access to add memory rules.',
      field: null,
    })
  }

  const { user, client, subscription, roles } = access

  const teachingRole = roles.find((r): r is 'principal' | 'staff' =>
    (ROLES_THAT_CAN_TEACH as readonly string[]).includes(r)
  )
  if (!teachingRole) {
    return jsonResponse(403, {
      ok: false,
      reason: 'Your role does not include adding memory rules.',
      field: null,
    })
  }

  const draft = await getDraft(subscription, draftId)
  if (!draft) {
    return jsonResponse(404, {
      ok: false,
      reason: 'Draft not found.',
      field: null,
    })
  }

  const body = await parseBody(request)
  const validation = validateTeachMarcusInput({
    kind: body.kind,
    text: body.text,
    sourceDraftId: draftId,
    recipientCohort: body.recipientCohort,
  })

  if (!validation.ok) {
    return jsonResponse(400, {
      ok: false,
      reason: validation.reason,
      field: validation.field,
    })
  }

  const auditEvent = buildMemoryRuleAddedAuditEvent({
    approverId: user.id,
    customerId: client.id,
    rule: validation.rule,
  })
  await recordMemoryRuleAddedAudit(auditEvent)

  return jsonResponse(200, {
    ok: true,
    auditTimestamp: auditEvent.timestamp,
  })
}
