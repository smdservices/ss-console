/**
 * Per-matter audit record — the client-facing read (ss#2122).
 *
 * THE SENTENCE THIS EXISTS FOR. A Named Administrator at a client firm pulls
 * the audit record for one matter from the portal and sees, for every Operator
 * action on it, what authorized that action. Service agreement §4.5 commits to
 * the audit record being viewable by the Firm in the portal at any time; until
 * this path existed the only export was a Captain CLI, so §4.5 was contractual
 * debt, not a shipped surface.
 *
 * WHY NOT THE ACTIVITY FEED. `activity-read.ts` renders a curated narrative:
 * it filters to actions carrying authored client copy, and the row classes that
 * actually carry a matter id (`TOOL_CALL_COMPLETED`, `LLM_TURN_COMPLETED`) are
 * deliberately SUPPRESSED there as telemetry. That is the right call for a feed
 * and the wrong one for an evidence record. This module reads the `audit_export`
 * kind instead, which serves the full row including `matter_ref`,
 * `trust_ceiling`, the digests, the `metadata` blob, and the hash-chain columns.
 *
 * WHAT "AUTHORIZED" MEANS, MECHANICALLY. Three facts on the row, and no
 * inference beyond them:
 *
 *   - `trust_ceiling` is the ceiling the trust gate actually applied at the
 *     moment of the action (overlay `plugins/hermes-smd-audit/emit.py`, the
 *     `trust.effective_ceiling` write). It is the permission the action ran
 *     under.
 *   - `metadata.routine` names the scheduled routine whose tick opened the
 *     session, resolved at emission time while the cron id → name mapping is
 *     still live.
 *   - `actor` + `actor_role` name the human, when one is named.
 *
 * A row that carries none of them is reported as `unattributed`. That is a
 * real state of the ledger, not a rendering failure: `matter_ref`,
 * `trust_ceiling`, and a non-`agent` actor were all added to the writer after
 * seats had begun writing rows, so rows written before those fixes carry NULL
 * forever. Naming the state is the whole point. Guessing at it would put a
 * fabricated authorization into a legal record.
 *
 * EMPTY IS NEVER SILENT. A matter-scoped read that matches zero rows while
 * unattributed rows exist in the same period is reported with that count
 * attached, so an administrator can never read "no rows" as "the Operator did
 * nothing on this matter". This mirrors the CLI's exit-3 halt
 * (`operator/bin/generate-evidence-packet.sh`) at the portal seam.
 *
 * Parse, never cast: a malformed wire row is dropped rather than rendered as a
 * misleading line.
 */

import type { D1Database } from '@cloudflare/workers-types'
import {
  readMachineRuntime,
  type RuntimeReadActor,
  type RuntimeReadAudit,
} from '../../operator/runtime-read'
import {
  createMachineRuntimeTransport,
  createRuntimeReadAudit,
  isRuntimeReadConfigured,
  type RuntimeReadEnv,
} from '../../operator/runtime-read-transport'

/** Overlay `shared/runtime_read.py` clamps `limit` to this (MAX_LIMIT). */
const MACHINE_PAGE_LIMIT = 200

/**
 * Pages walked per request. The export kind paginates ASCENDING by ULID, so a
 * walk always starts at the oldest row and the budget bounds a runaway seat
 * rather than the window. Exhausting it is surfaced, never swallowed.
 */
const MACHINE_PAGE_BUDGET = 25

/** One full audit_log row as served by the Machine's `audit_export` kind. */
export interface ObjectAuditRow {
  id: string
  ts: string
  actionType: string
  actor: string
  actorRole: string | null
  skillName: string | null
  matterRef: string | null
  trustCeiling: string | null
  inputDigest: string | null
  outputDigest: string | null
  diffDigest: string | null
  prevHash: string | null
  rowHash: string | null
  /** `metadata.routine` — the scheduled routine that opened the session. */
  routine: string | null
}

/**
 * What permitted one action, derived only from fields the writer populated.
 *
 *   `routine`      a scheduled routine opened the session; `routine` names it.
 *   `person`       a named human is on the row (`actor` is not the agent and a
 *                  role is recorded).
 *   `unattributed` neither is present. The row records what happened and does
 *                  not record who or what permitted it.
 *
 * `ceiling` is the trust ceiling in force, on every variant, or null when the
 * writer did not record one.
 */
export type AuthorizationBasis =
  | { basis: 'routine'; routine: string; ceiling: string | null }
  | { basis: 'person'; person: string; role: string; ceiling: string | null }
  | { basis: 'unattributed'; ceiling: string | null }

/**
 * The literal actor value the audit writer uses when no human is resolved.
 * Mirrors `operator/adapter/audit_log.py` (`actor` is a default argument whose
 * default is the agent itself).
 */
const AGENT_ACTOR = 'agent'

/** Derive the authorizing basis for one row. Never guesses. */
export function authorizationOf(row: ObjectAuditRow): AuthorizationBasis {
  const ceiling = row.trustCeiling
  if (row.routine !== null && row.routine !== '') {
    return { basis: 'routine', routine: row.routine, ceiling }
  }
  const namedHuman = row.actor !== '' && row.actor !== AGENT_ACTOR
  if (namedHuman && row.actorRole !== null && row.actorRole !== '' && row.actorRole !== 'agent') {
    return { basis: 'person', person: row.actor, role: row.actorRole, ceiling }
  }
  return { basis: 'unattributed', ceiling }
}

/**
 * One line of plain language for the authorization column. Written for a
 * reader who is not technical, per the evidence-packet design constraint.
 * Contains no em dashes (house style).
 */
export function describeAuthorization(basis: AuthorizationBasis): string {
  const ceiling =
    basis.ceiling === null || basis.ceiling === ''
      ? 'no permission level recorded'
      : `permission level: ${basis.ceiling}`
  if (basis.basis === 'routine') {
    return `Scheduled routine "${basis.routine}" (${ceiling})`
  }
  if (basis.basis === 'person') {
    return `${basis.person}, acting as ${basis.role} (${ceiling})`
  }
  return `Not recorded (${ceiling})`
}

// ---------------------------------------------------------------------------
// Wire parsing
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function reqString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function optString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Pull `metadata.routine` out of the row's metadata column. The column is
 * serialized JSON on the wire; a malformed or absent blob yields null rather
 * than throwing, because an unparseable metadata blob must not cost us the row
 * itself (the row's own facts are still evidence).
 */
function routineFromMetadata(raw: unknown): string | null {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    if (raw.length === 0) return null
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!isRecord(parsed)) return null
  return optString(parsed['routine'])
}

/** Parse a Machine `audit_export` payload. Malformed rows are dropped. */
export function parseObjectAuditRows(data: unknown): ObjectAuditRow[] {
  const raw: unknown = isRecord(data) && Array.isArray(data['entries']) ? data['entries'] : data
  if (!Array.isArray(raw)) return []
  const out: ObjectAuditRow[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = reqString(item['id'])
    const ts = reqString(item['ts'])
    const actionType = reqString(item['action_type'])
    const actor = reqString(item['actor'])
    if (id === null || ts === null || actionType === null || actor === null) continue
    out.push({
      id,
      ts,
      actionType,
      actor,
      actorRole: optString(item['actor_role']),
      skillName: optString(item['skill_name']),
      matterRef: optString(item['matter_ref']),
      trustCeiling: optString(item['trust_ceiling']),
      inputDigest: optString(item['input_digest']),
      outputDigest: optString(item['output_digest']),
      diffDigest: optString(item['diff_digest']),
      prevHash: optString(item['prev_hash']),
      rowHash: optString(item['row_hash']),
      routine: routineFromMetadata(item['metadata']),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface ObjectAuditQuery {
  /** The opaque object reference to scope to, compared for equality and never
   * interpreted (ADR 0052 section 6). Required: this is a per-object record. */
  ref: string
  /** Inclusive ISO lower bound on `ts`, or null for no lower bound. */
  from: string | null
  /** Inclusive upper bound on `ts`, or null for no upper bound. A date-only
   * value is extended to the end of that day so `to=2026-08-13` includes it. */
  to: string | null
}

/** True when `ts` falls inside the requested window. ISO strings compare
 * lexicographically, so no Date parsing is needed or wanted. */
function inWindow(ts: string, from: string | null, to: string | null): boolean {
  if (from !== null && ts < from) return false
  if (to !== null) {
    // A date-only bound must cover the whole day, not midnight.
    const upper = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to
    if (ts > upper) return false
  }
  return true
}

/**
 * The result of a per-matter read. `unattributedInPeriod` is the count of rows
 * inside the window whose `matter_ref` is NULL: the number of actions that
 * COULD have been on this matter and cannot be proven either way. It is what
 * keeps an empty `rows` from reading as "nothing happened".
 */
export interface ObjectAuditRecord {
  ref: string
  from: string | null
  to: string | null
  rows: ObjectAuditRow[]
  /** Rows in-window carrying no matter attribution at all. */
  unattributedInPeriod: number
  /** Total rows the walk saw in-window, across all matters. */
  scannedInPeriod: number
  /** True when the page budget ran out before the ledger was exhausted. */
  truncated: boolean
  /** Set when the read seam could not be used. `rows` is empty in that case
   * and the surface must say so rather than render a clean zero. */
  unavailable: 'not_configured' | 'unreachable' | 'unauthorized' | null
}

/** Scope a walked ledger to one matter and window, and count what it cannot answer. */
export function scopeToRef(rows: ObjectAuditRow[], query: ObjectAuditQuery): ObjectAuditRecord {
  const inPeriod = rows.filter((r) => inWindow(r.ts, query.from, query.to))
  return {
    ref: query.ref,
    from: query.from,
    to: query.to,
    rows: inPeriod.filter((r) => r.matterRef === query.ref),
    unattributedInPeriod: inPeriod.filter((r) => r.matterRef === null).length,
    scannedInPeriod: inPeriod.length,
    truncated: false,
    unavailable: null,
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Header row of the exported CSV. Order is stable: a firm may diff two exports. */
export const OBJECT_AUDIT_CSV_COLUMNS = [
  'id',
  'ts',
  'action_type',
  'matter_ref',
  'authorized_by',
  'authorization_basis',
  'trust_ceiling',
  'actor',
  'actor_role',
  'routine',
  'skill_name',
  'input_digest',
  'output_digest',
  'diff_digest',
  'prev_hash',
  'row_hash',
] as const

function csvCell(value: string | null): string {
  if (value === null) return ''
  // Quote when the value could otherwise break the row, and double embedded
  // quotes (RFC 4180). Formula-injection prefixes are neutralized: a
  // compliance CSV is opened in a spreadsheet by definition.
  const needsQuote = /["\n\r,]/.test(value)
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return needsQuote || guarded !== value ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** Render the record as RFC 4180 CSV. Deterministic for a given row set. */
export function toObjectAuditCsv(record: ObjectAuditRecord): string {
  const lines: string[] = [OBJECT_AUDIT_CSV_COLUMNS.join(',')]
  for (const row of record.rows) {
    const basis = authorizationOf(row)
    lines.push(
      [
        csvCell(row.id),
        csvCell(row.ts),
        csvCell(row.actionType),
        csvCell(row.matterRef),
        csvCell(describeAuthorization(basis)),
        csvCell(basis.basis),
        csvCell(row.trustCeiling),
        csvCell(row.actor),
        csvCell(row.actorRole),
        csvCell(row.routine),
        csvCell(row.skillName),
        csvCell(row.inputDigest),
        csvCell(row.outputDigest),
        csvCell(row.diffDigest),
        csvCell(row.prevHash),
        csvCell(row.rowHash),
      ].join(',')
    )
  }
  return lines.join('\n') + '\n'
}

/** Filename a firm receives. Slug-safe: a matter id is a source-system handle. */
export function objectAuditCsvFilename(customerSlug: string, ref: string): string {
  const safe = ref.replace(/[^A-Za-z0-9._-]/g, '_')
  return `audit-record-${customerSlug}-${safe}.csv`
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

export interface ObjectAuditDeps {
  db: D1Database
  env: RuntimeReadEnv
  /** Console-side actor id for the ADR 0043 read-audit row. */
  actorUserId: string
}

function unavailableRecord(
  query: ObjectAuditQuery,
  reason: NonNullable<ObjectAuditRecord['unavailable']>
): ObjectAuditRecord {
  return {
    ref: query.ref,
    from: query.from,
    to: query.to,
    rows: [],
    unattributedInPeriod: 0,
    scannedInPeriod: 0,
    truncated: false,
    unavailable: reason,
  }
}

/**
 * Walk this customer's ledger over the ADR 0043 seam and scope it to one
 * matter. Fail-closed: a transport failure returns an `unavailable` record,
 * never a throw into a page render and never a clean empty that would read as
 * an answer.
 *
 * One logical read, one read-audit row: the first segment is audited per
 * ADR 0043; continuation segments of the same walk reuse a no-op sink.
 */
export async function loadObjectAuditRecord(
  deps: ObjectAuditDeps,
  customerSlug: string,
  actor: RuntimeReadActor,
  query: ObjectAuditQuery
): Promise<ObjectAuditRecord> {
  if (!isRuntimeReadConfigured(deps.env)) return unavailableRecord(query, 'not_configured')

  const transport = createMachineRuntimeTransport(deps.env)
  const audit = createRuntimeReadAudit(deps.db, { actorUserId: deps.actorUserId })
  const noopAudit: RuntimeReadAudit = { record: async () => {} }

  const rows: ObjectAuditRow[] = []
  let cursor: string | null = null
  let truncated = false

  for (let page = 0; page < MACHINE_PAGE_BUDGET; page++) {
    const result = await readMachineRuntime(
      { transport, audit: page === 0 ? audit : noopAudit },
      customerSlug,
      { kind: 'audit_export', cursor, limit: MACHINE_PAGE_LIMIT },
      actor
    )
    if (!result.ok) {
      // A failure on a continuation page still leaves a partial walk. Report it
      // as unavailable rather than as a short answer: a compliance record that
      // silently omits its tail is worse than one that says it could not read.
      return unavailableRecord(query, result.reason)
    }
    const parsed = parseObjectAuditRows(result.data)
    rows.push(...parsed)

    const next = isRecord(result.data) ? optString(result.data['cursor']) : null
    // No next cursor (or an empty page) means the ledger is exhausted: the walk
    // is complete, not truncated.
    if (next === null || parsed.length === 0) break
    cursor = next
    if (page === MACHINE_PAGE_BUDGET - 1) truncated = true
  }

  const record = scopeToRef(rows, query)
  return { ...record, truncated }
}
