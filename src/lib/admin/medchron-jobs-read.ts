/**
 * Chronology-package jobs, read live from a seat (routine 11, ss#2614).
 *
 * The seat's broker owns a small ledger of every chronology job the Operator
 * (or root on the box) submitted: its state, the documents it read, the pages,
 * the cents, the folder it delivered into. This module is the read + shape
 * guard + monthly roll-up behind the admin page.
 *
 * Two lanes, kept apart on purpose (the same discipline as the cost page):
 * the cents here are the RUNNER'S OWN ledger, priced from the pricing table
 * on the seat; the nightly cost plane books the same tokens to the customer's
 * workspace from the vendor's usage report. They agree within the pricing
 * table's tolerance and are never presented as one number.
 *
 * Fail-closed parsing: a row without an id and a state is dropped, and every
 * count is zeroed rather than coerced. An unreachable seat is `unreachable`,
 * never a stale table.
 */

import {
  readMachineRuntime,
  type MachineRuntimeTransport,
  type RuntimeReadAudit,
  type RuntimeReadActor,
} from '../operator/runtime-read'

export type MedchronJobState = 'submitted' | 'running' | 'held' | 'delivered' | 'failed'

export interface MedchronJobRow {
  id: string
  createdAt: string
  updatedAt: string
  state: MedchronJobState
  matterNumber: string
  documents: number
  pages: number
  cents: number
  reason: string | null
  folderId: string | null
}

export interface MedchronMonthTotals {
  month: string
  jobs: number
  delivered: number
  held: number
  documents: number
  pages: number
  cents: number
}

export type MedchronJobsReadResult =
  | { status: 'not_enabled' }
  | { status: 'unreachable'; reason: string }
  | { status: 'empty' }
  | { status: 'items'; jobs: MedchronJobRow[]; month: MedchronMonthTotals }

const STATES: ReadonlySet<string> = new Set(['submitted', 'running', 'held', 'delivered', 'failed'])

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** One ledger row, or null when its identity (id + state) is missing. */
export function parseJobRow(raw: unknown): MedchronJobRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const id = asText(r['id'])
  const state = asText(r['state'])
  if (!id || !state || !STATES.has(state)) return null
  return {
    id,
    createdAt: asText(r['created_at']) ?? '',
    updatedAt: asText(r['updated_at']) ?? '',
    state: state as MedchronJobState,
    matterNumber: asText(r['matter_number']) ?? '',
    documents: asCount(r['documents']),
    pages: asCount(r['pages']),
    cents: asCount(r['cents']),
    reason: asText(r['reason']),
    folderId: asText(r['folder_id']),
  }
}

/** The calendar month's roll-up. Documents and cents count DELIVERED jobs only
 * (the allowance metric and the cost that actually reached the firm); held
 * and failed jobs show in the table, not the totals. */
export function monthTotals(
  jobs: MedchronJobRow[],
  month: string = new Date().toISOString().slice(0, 7)
): MedchronMonthTotals {
  const inMonth = jobs.filter((j) => j.createdAt.slice(0, 7) === month)
  const delivered = inMonth.filter((j) => j.state === 'delivered')
  return {
    month,
    jobs: inMonth.length,
    delivered: delivered.length,
    held: inMonth.filter((j) => j.state === 'held').length,
    documents: delivered.reduce((s, j) => s + j.documents, 0),
    pages: delivered.reduce((s, j) => s + j.pages, 0),
    cents: delivered.reduce((s, j) => s + j.cents, 0),
  }
}

interface MedchronReadDeps {
  transport: MachineRuntimeTransport
  audit: RuntimeReadAudit
}

/**
 * Read one seat's chronology-job ledger. `configured` mirrors the
 * runtime-observe loader: a dark read path returns `not_enabled` without a
 * read and without an audit row.
 */
export async function loadMedchronJobsView(
  deps: MedchronReadDeps,
  customerSlug: string,
  actor: RuntimeReadActor,
  configured: boolean,
  month?: string
): Promise<MedchronJobsReadResult> {
  if (!configured) return { status: 'not_enabled' }
  const result = await readMachineRuntime(deps, customerSlug, { kind: 'medchron_jobs' }, actor)
  if (!result.ok) return { status: 'unreachable', reason: result.reason }
  const payload = result.data as { entries?: unknown } | null
  const entries = Array.isArray(payload?.entries) ? payload.entries : []
  const jobs: MedchronJobRow[] = []
  for (const raw of entries) {
    const parsed = parseJobRow(raw)
    if (parsed) jobs.push(parsed)
  }
  if (jobs.length === 0) return { status: 'empty' }
  jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return { status: 'items', jobs, month: monthTotals(jobs, month) }
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
