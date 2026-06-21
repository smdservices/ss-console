/**
 * Activity & Audit read path (client-portal §5.5). Bridges the frozen ADR 0043
 * live runtime read (readMachineRuntime) into the existing audit display
 * machinery (filters / sort / pagination / formatters in audit.ts).
 *
 * Why route through readMachineRuntime rather than the legacy
 * `listAuditEntries` stub: the foundation converges every deep per-customer
 * read on the single audited, fail-closed, one-customer-per-call path
 * (foundations §6, ADR 0043). Activity is one of those drill-ins.
 *
 * Until OPERATOR_RUNTIME_READ_URL is wired, the read path is not configured.
 * We short-circuit to an empty page BEFORE calling readMachineRuntime, so an
 * unwired deployment does not write an `unreachable` read-audit row on every
 * page view. Once wired, every read is attempted and audited per ADR 0043.
 *
 * The Machine read endpoint (overlay-side) defines the wire format; until it
 * exists this path returns empty, so `parseAuditEntries` is dormant but written
 * defensively (parse, never cast) for the documented row shape.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { readMachineRuntime, type RuntimeReadActor } from '../../operator/runtime-read'
import {
  createMachineRuntimeTransport,
  createRuntimeReadAudit,
  isRuntimeReadConfigured,
  type RuntimeReadEnv,
} from '../../operator/runtime-read-transport'
import {
  buildAuditListPage,
  AUDIT_ACTOR_ROLES,
  AUDIT_DECISIONS,
  type AuditEntry,
  type AuditActorRole,
  type AuditDecision,
  type AuditListParams,
  type AuditListPage,
} from './audit'

export interface ActivityReadDeps {
  db: D1Database
  env: RuntimeReadEnv
  /** Console-side actor id for the read-audit row (distinct from the operator's log). */
  actorUserId: string
}

/**
 * Load one filtered/paginated page of activity for the signed-in client's own
 * operator. Fails closed to an empty page on any transport failure or when the
 * read path is not configured — never throws into the page render.
 */
export async function loadActivityPage(
  deps: ActivityReadDeps,
  customerSlug: string,
  actor: RuntimeReadActor,
  params: AuditListParams
): Promise<AuditListPage> {
  if (!isRuntimeReadConfigured(deps.env)) {
    return buildAuditListPage([], params)
  }
  const result = await readMachineRuntime(
    {
      transport: createMachineRuntimeTransport(deps.env),
      audit: createRuntimeReadAudit(deps.db, { actorUserId: deps.actorUserId }),
    },
    customerSlug,
    { kind: 'audit_log' },
    actor
  )
  const rows = result.ok ? parseAuditEntries(result.data) : []
  return buildAuditListPage(rows, params)
}

// ---------------------------------------------------------------------------
// Defensive parsing of the runtime read payload into AuditEntry[].
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A required non-empty string field; returns null when absent/empty so the
 * caller can drop a malformed row rather than render a blank cell. */
function reqString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** An optional string field: a present string or null (anything else → null). */
function optString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function asActorRole(v: unknown): AuditActorRole | null {
  return typeof v === 'string' && (AUDIT_ACTOR_ROLES as readonly string[]).includes(v)
    ? (v as AuditActorRole)
    : null
}

function asDecision(v: unknown): AuditDecision | null {
  return typeof v === 'string' && (AUDIT_DECISIONS as readonly string[]).includes(v)
    ? (v as AuditDecision)
    : null
}

/**
 * Parse an unknown runtime payload into AuditEntry[]. Accepts either a bare
 * array of rows or an `{ entries: [...] }` envelope. Rows missing a required
 * `id`/`ts`/`actor`/`action` are dropped, not coerced — a malformed row never
 * becomes a misleading audit line. Exported for unit testing.
 */
export function parseAuditEntries(data: unknown): AuditEntry[] {
  const raw: unknown = isRecord(data) && Array.isArray(data['entries']) ? data['entries'] : data
  if (!Array.isArray(raw)) return []
  const out: AuditEntry[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = reqString(item['id'])
    const ts = reqString(item['ts'])
    const actor = reqString(item['actor'])
    const action = reqString(item['action'])
    if (id === null || ts === null || actor === null || action === null) continue
    out.push({
      id,
      ts,
      actor,
      action,
      actorRole: asActorRole(item['actorRole']),
      target: optString(item['target']),
      decision: asDecision(item['decision']),
      reason: optString(item['reason']),
      skill: optString(item['skill']),
    })
  }
  return out
}
