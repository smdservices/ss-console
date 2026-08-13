import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveOperatorAccess } from '../../../../../../../lib/portal/operator-access'
import { recordPortalActionEvent } from '../../../../../../../lib/portal/operator/action-events'
import {
  loadObjectAuditRecord,
  objectAuditCsvFilename,
  toObjectAuditCsv,
} from '../../../../../../../lib/portal/operator/object-audit-record'

/**
 * GET /api/portal/products/operator/[instance]/compliance/audit-record
 *   ?ref=<opaque-object-ref>&from=<ISO>&to=<ISO>
 *
 * The download half of the per-reference audit record (ss#2122). The portal page
 * beside it renders the same rows on screen; this route hands the firm the file
 * it can forward to counsel, a carrier, or an opposing party.
 *
 * Enforcement chain, in order:
 *   1. resolveOperatorAccess — Clerk session, entity binding, live Operator
 *      subscription, and role membership. Allowed roles are `principal` (the
 *      role the signed agreements call a Named Administrator) and `compliance`
 *      (the firm's reviewer, where separation of duties is in use). `staff`
 *      cannot reach this route.
 *   2. `ref` is required. There is no whole-ledger form here on purpose: an
 *      unscoped pull is the evidence-packet path, which carries the
 *      redaction validator and the signature, and neither belongs in an
 *      unattended CSV endpoint. The value is an opaque handle from the
 *      client's own system (ADR 0052 §6), compared for equality and never
 *      interpreted.
 *   3. The read itself is the ADR 0043 seam, which writes its own read-audit
 *      row naming who looked at what.
 *
 * Accountability: the export is recorded in `portal_action_events` and unions
 * into the firm's own activity feed. A compliance export that leaves no trace
 * would be the one console action invisible to the record it exports.
 *
 * Fail-closed: an unreachable or unconfigured seam returns 503 with a reason
 * rather than a 200 carrying an empty CSV. An empty file is indistinguishable
 * from "the Operator did nothing against this reference", which is the exact
 * misreading this whole path exists to prevent.
 */

const ALLOWED_ROLES = ['principal', 'compliance'] as const

/** ISO date (`2026-08-13`) or full ISO timestamp. Anything else is rejected
 * rather than coerced: a silently-dropped bound would narrow or widen a
 * compliance window without saying so. */
const ISO_BOUND = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z?)?$/

function bad(message: string, status = 400): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

type ParsedQuery =
  { ok: true; ref: string; from: string | null; to: string | null } | { ok: false; message: string }

/** Validate the query. Rejects rather than coerces, so a malformed bound can
 * never silently narrow or widen the window a firm believes it asked for. */
function parseQuery(searchParams: URLSearchParams): ParsedQuery {
  const ref = (searchParams.get('ref') ?? '').trim()
  if (ref === '') return { ok: false, message: 'A reference is required.' }
  if (ref.length > 200) return { ok: false, message: 'Reference is too long.' }

  const from = (searchParams.get('from') ?? '').trim() || null
  const to = (searchParams.get('to') ?? '').trim() || null
  if (from !== null && !ISO_BOUND.test(from)) return { ok: false, message: 'Invalid "from" date.' }
  if (to !== null && !ISO_BOUND.test(to)) return { ok: false, message: 'Invalid "to" date.' }

  return { ok: true, ref, from, to }
}

export const GET: APIRoute = async ({ params, url, locals }) => {
  const instance = typeof params.instance === 'string' ? params.instance : ''
  if (instance === '') return bad('Not found', 404)

  const access = await resolveOperatorAccess(env.DB, locals, {
    allowedRoles: [...ALLOWED_ROLES],
    customerSlug: instance,
  })
  if (access.kind === 'redirect') return bad('Forbidden', 403)

  const permitted = access.roles.some((r) => (ALLOWED_ROLES as readonly string[]).includes(r))
  if (!permitted) return bad('Forbidden', 403)

  const parsed = parseQuery(url.searchParams)
  if (!parsed.ok) return bad(parsed.message)
  const { ref, from, to } = parsed

  const actorRole = access.roles.includes('principal') ? 'principal' : 'compliance'
  const record = await loadObjectAuditRecord(
    {
      db: env.DB,
      env: {
        OPERATOR_RUNTIME_READ_URL: env.OPERATOR_RUNTIME_READ_URL,
        OPERATOR_RUNTIME_READ_SECRET: env.OPERATOR_RUNTIME_READ_SECRET,
      },
      actorUserId: access.user.id,
    },
    instance,
    { actor: access.user.id, actorRole },
    { ref, from, to }
  )

  if (record.unavailable !== null) {
    return bad(
      'The audit record could not be read from this Operator right now ' +
        `(${record.unavailable}). No file was produced. Try again, and contact ` +
        'SMD if it persists.',
      503
    )
  }

  // Record the export before handing over the bytes. Ordering is deliberate:
  // if the ledger write fails we still deliver the record (the firm's own
  // evidence is not held hostage to our bookkeeping), but we never deliver it
  // having decided not to try.
  try {
    await recordPortalActionEvent(env.DB, {
      entity_id: access.client.id,
      customer_slug: instance,
      action_type: 'compliance_record_exported',
      actor_user_id: access.user.id,
      actor_email: access.user.email,
      actor_role: actorRole,
      source: 'portal',
      target: ref,
      status: 'applied',
      metadata: {
        ref,
        from,
        to,
        row_count: record.rows.length,
        unattributed_in_period: record.unattributedInPeriod,
        truncated: record.truncated,
      },
    })
  } catch {
    // Never fail the export on its own bookkeeping.
  }

  const csv = toObjectAuditCsv(record)
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${objectAuditCsvFilename(instance, ref)}"`,
      'Cache-Control': 'no-store',
      'X-Audit-Rows': String(record.rows.length),
      'X-Audit-Unattributed-In-Period': String(record.unattributedInPeriod),
      'X-Audit-Truncated': String(record.truncated),
    },
  })
}
