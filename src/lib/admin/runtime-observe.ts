/**
 * Runtime-observe view-model for the admin Operator console
 * (`/admin/operator/[customer]/runtime`) — design §5.5, ADR 0043 path A.
 *
 * SMD observes what one operator is actually doing — activity/drafts and the
 * audit log — read across the isolation boundary via the live per-customer
 * read path (readMachineRuntime). That path is fail-closed: until the Machine
 * read endpoint is wired (OPERATOR_RUNTIME_READ_URL), it returns empty, so this
 * surface renders honest empty / not-enabled states now — the documented design,
 * not a gap (foundations §6/§7).
 *
 * This module owns the view IA (the sub-views → RuntimeReadKind) and a
 * thin loader that maps a read result to a display status. The transport, audit
 * sink, and readMachineRuntime are the frozen seam; the page injects them.
 *
 * No audit noise for a dark feature: when the read path is not configured the
 * loader returns `not_enabled` WITHOUT attempting a read, so we don't write a
 * runtime-read-audit row on every page load for a path that cannot answer.
 */

import {
  readMachineRuntime,
  type MachineRuntimeTransport,
  type RuntimeReadAudit,
  type RuntimeReadActor,
  type RuntimeReadKind,
} from '../operator/runtime-read'

export type RuntimeViewId = 'activity' | 'audit'

export interface RuntimeViewDef {
  id: RuntimeViewId
  label: string
  kind: RuntimeReadKind
  /** What this view shows, for the empty-state copy. */
  noun: string
}

export const RUNTIME_VIEWS: readonly RuntimeViewDef[] = [
  { id: 'activity', label: 'Activity & drafts', kind: 'activity', noun: 'activity' },
  { id: 'audit', label: 'Audit log', kind: 'audit_log', noun: 'audit entries' },
]

/** Resolve a `?view=` param to a view def; defaults to activity. Total. */
export function parseRuntimeView(raw: string | null | undefined): RuntimeViewDef {
  const found = RUNTIME_VIEWS.find((v) => v.id === raw)
  return found ?? RUNTIME_VIEWS[0]
}

export type RuntimeViewResult =
  | { status: 'not_enabled' }
  | { status: 'unreachable'; reason: string }
  | { status: 'empty' }
  | { status: 'items'; count: number; data: unknown }

interface RuntimeReadDeps {
  transport: MachineRuntimeTransport
  audit: RuntimeReadAudit
}

/**
 * Load one runtime view for one customer. When the read path is not configured,
 * returns `not_enabled` without a read attempt (no audit noise). Otherwise reads
 * via the frozen fail-closed path and classifies the outcome:
 *   - read failed (unreachable/unauthorized/not_configured) → `unreachable`
 *   - read ok, no rows                                       → `empty`
 *   - read ok, rows                                          → `items` (+ count)
 *
 * `data` is opaque (the Machine endpoint defines the row shape, a follow-on);
 * we surface a count honestly and leave the detailed renderer for when the
 * endpoint lands rather than fabricating a shape.
 */
export async function loadRuntimeView(
  deps: RuntimeReadDeps,
  customerSlug: string,
  view: RuntimeViewDef,
  actor: RuntimeReadActor,
  configured: boolean
): Promise<RuntimeViewResult> {
  if (!configured) return { status: 'not_enabled' }
  const result = await readMachineRuntime(deps, customerSlug, { kind: view.kind }, actor)
  if (!result.ok) return { status: 'unreachable', reason: result.reason }
  const count = countRows(result.data)
  return count === 0 ? { status: 'empty' } : { status: 'items', count, data: result.data }
}

/** Best-effort row count from an opaque read payload (array, or {items:[]}). */
function countRows(data: unknown): number {
  if (Array.isArray(data)) return data.length
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: unknown[] }).items.length
  }
  return 0
}
