/**
 * Matters read path (client-portal §5.4). Bridges the frozen ADR 0043 runtime
 * read (readMachineRuntime) into the matter list + detail shapes (matters.ts).
 *
 * Same discipline as activity-read.ts: converge the deep per-customer read on
 * the single audited, fail-closed, one-customer-per-call path (foundations §6).
 * Gated on isRuntimeReadConfigured so an unwired deploy returns the honest empty
 * shape WITHOUT writing a read-audit row on every page view. Once wired, every
 * read is attempted and audited.
 *
 * `kind: 'matter'` serves both list and detail: a query with no `id` returns the
 * list, a query with an `id` returns one matter's detail. The Machine read
 * endpoint (overlay-side) defines the wire format; until it exists these return
 * empty/null, so the parsers are dormant but written defensively (parse, never
 * cast).
 *
 * `assigneeUserIds` is always [] from this resolver — the page stitches
 * assignments from the portal D1 (see matters.ts Matter doc + matter-assignment.ts).
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
  MATTER_PHASE_LABEL,
  type Matter,
  type MatterDetail,
  type MatterPhase,
  type MatterLastAction,
  type MatterTimelineEntry,
  type MatterDraftRef,
  type MatterAuditRef,
} from './matters'

export interface MattersReadDeps {
  db: D1Database
  env: RuntimeReadEnv
  actorUserId: string
}

/** List the matters the client's operator is tracking. Fails closed to []. */
export async function loadMatters(
  deps: MattersReadDeps,
  customerSlug: string,
  actor: RuntimeReadActor
): Promise<Matter[]> {
  if (!isRuntimeReadConfigured(deps.env)) return []
  const result = await readMachineRuntime(buildDeps(deps), customerSlug, { kind: 'matter' }, actor)
  return result.ok ? parseMatters(result.data) : []
}

/** Load one matter's detail. Fails closed to null. */
export async function loadMatterDetail(
  deps: MattersReadDeps,
  customerSlug: string,
  actor: RuntimeReadActor,
  matterId: string
): Promise<MatterDetail | null> {
  if (!isRuntimeReadConfigured(deps.env)) return null
  const result = await readMachineRuntime(
    buildDeps(deps),
    customerSlug,
    { kind: 'matter', id: matterId },
    actor
  )
  return result.ok ? parseMatterDetail(result.data) : null
}

function buildDeps(deps: MattersReadDeps) {
  return {
    transport: createMachineRuntimeTransport(deps.env),
    audit: createRuntimeReadAudit(deps.db, { actorUserId: deps.actorUserId }),
  }
}

// ---------------------------------------------------------------------------
// Defensive parsing.
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
function asPhase(v: unknown): MatterPhase | null {
  return typeof v === 'string' && v in MATTER_PHASE_LABEL ? (v as MatterPhase) : null
}
function asLastAction(v: unknown): MatterLastAction | null {
  if (!isRecord(v)) return null
  const skill = reqString(v['skill'])
  const at = reqString(v['at'])
  return skill !== null && at !== null ? { skill, at } : null
}

/** Parse the matter list payload (bare array or `{ matters: [...] }`). Rows
 * missing any required scalar (id/clientName/matterType/phase/openedAt) are
 * dropped — a malformed row never becomes a misleading matter card. */
export function parseMatters(data: unknown): Matter[] {
  const raw: unknown = isRecord(data) && Array.isArray(data['matters']) ? data['matters'] : data
  if (!Array.isArray(raw)) return []
  const out: Matter[] = []
  for (const item of raw) {
    const m = parseMatterCore(item)
    if (m !== null) out.push({ ...m, lastAction: asLastAction(itemField(item, 'lastAction')) })
  }
  return out
}

function itemField(item: unknown, key: string): unknown {
  return isRecord(item) ? item[key] : undefined
}

/** Shared scalar core of Matter (also the head of MatterDetail). */
function parseMatterCore(
  item: unknown
): Pick<
  Matter,
  'id' | 'clientName' | 'matterType' | 'phase' | 'openedAt' | 'assigneeUserIds'
> | null {
  if (!isRecord(item)) return null
  const id = reqString(item['id'])
  const clientName = reqString(item['clientName'])
  const matterType = reqString(item['matterType'])
  const phase = asPhase(item['phase'])
  const openedAt = reqString(item['openedAt'])
  if (
    id === null ||
    clientName === null ||
    matterType === null ||
    phase === null ||
    openedAt === null
  ) {
    return null
  }
  // The resolver never supplies assignees; the page stitches them from portal D1.
  return { id, clientName, matterType, phase, openedAt, assigneeUserIds: [] }
}

const TIMELINE_KINDS: ReadonlySet<string> = new Set([
  'communication',
  'document',
  'deadline',
  'ai_action',
  'note',
])

function parseTimeline(v: unknown): MatterTimelineEntry[] {
  if (!Array.isArray(v)) return []
  const out: MatterTimelineEntry[] = []
  for (const e of v) {
    if (!isRecord(e)) continue
    const id = reqString(e['id'])
    const at = reqString(e['at'])
    const summary = reqString(e['summary'])
    const kind = e['kind']
    if (id === null || at === null || summary === null) continue
    if (typeof kind !== 'string' || !TIMELINE_KINDS.has(kind)) continue
    out.push({ id, at, kind: kind as MatterTimelineEntry['kind'], summary })
  }
  return out
}

function parseDrafts(v: unknown): MatterDraftRef[] {
  if (!Array.isArray(v)) return []
  const out: MatterDraftRef[] = []
  for (const d of v) {
    if (!isRecord(d)) continue
    const id = reqString(d['id'])
    const subject = reqString(d['subject'])
    const recipient = reqString(d['recipient'])
    const skill = reqString(d['skill'])
    const createdAt = reqString(d['createdAt'])
    if (
      id === null ||
      subject === null ||
      recipient === null ||
      skill === null ||
      createdAt === null
    ) {
      continue
    }
    out.push({ id, subject, recipient, skill, createdAt })
  }
  return out
}

function parseAuditRefs(v: unknown): MatterAuditRef[] {
  if (!Array.isArray(v)) return []
  const out: MatterAuditRef[] = []
  for (const a of v) {
    if (!isRecord(a)) continue
    const id = reqString(a['id'])
    const at = reqString(a['at'])
    const actor = reqString(a['actor'])
    const action = reqString(a['action'])
    const summary = reqString(a['summary'])
    if (id === null || at === null || actor === null || action === null || summary === null)
      continue
    out.push({ id, at, actor, action, summary })
  }
  return out
}

/** Parse one matter's detail payload, or null when the core scalars are absent. */
export function parseMatterDetail(data: unknown): MatterDetail | null {
  const item: unknown = isRecord(data) && isRecord(data['matter']) ? data['matter'] : data
  const core = parseMatterCore(item)
  if (core === null || !isRecord(item)) return null
  return {
    ...core,
    facts: optString(item['facts']),
    timeline: parseTimeline(item['timeline']),
    draftsInFlight: parseDrafts(item['draftsInFlight']),
    recentAudit: parseAuditRefs(item['recentAudit']),
    lastAction: asLastAction(item['lastAction']),
  }
}
