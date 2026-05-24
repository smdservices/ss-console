/**
 * Per-user audit-log saved queries — typed contracts + persistence.
 *
 * Per issue #896: compliance reviewers re-use the same filter sets across
 * sessions ("Untagged refusals", "Smith matter activity"). Naming and
 * persisting these saves keystrokes and re-clicks each time the
 * reviewer comes back.
 *
 * Persistence lives in portal D1 `audit_saved_queries` (migration 0044).
 * The audit log itself lives on the per-customer Hermes Machine D1; saved
 * queries are reviewer state, not customer state, so they live on the
 * portal side and key off `(user_id, entity_id)`.
 *
 * The stored query is the `AuditListParams` shape serialized to JSON,
 * minus the `page` field. Pagination state is not part of a "saved
 * query" — re-running a saved query lands the reviewer on page 1 every
 * time. Including it would also let stale page numbers point past the
 * end of the result set when the underlying data changes.
 */

import type { AuditListParams } from './audit'
import {
  AUDIT_ACTION_TYPES,
  AUDIT_DECISIONS,
  AUDIT_SORTS,
  DEFAULT_AUDIT_PAGE_SIZE,
  MAX_AUDIT_PAGE_SIZE,
  type AuditDecision,
  type AuditSort,
} from './audit'

/**
 * One saved-query row as the page renders it. `params` is the parsed
 * AuditListParams subset (no `page`); `id` is the D1 row id used by the
 * delete endpoint.
 */
export interface SavedQuery {
  id: string
  name: string
  params: Omit<AuditListParams, 'page'>
  createdAt: string
  updatedAt: string
}

const AUDIT_ACTION_TYPE_SET: ReadonlySet<string> = new Set(AUDIT_ACTION_TYPES)
const AUDIT_DECISION_SET: ReadonlySet<string> = new Set(AUDIT_DECISIONS)
const AUDIT_SORT_SET: ReadonlySet<string> = new Set(AUDIT_SORTS)

/** Hard cap on the human-readable name. Long enough for meaningful
 * descriptions, short enough that the list reads cleanly. */
export const MAX_SAVED_QUERY_NAME_LENGTH = 80

/** Hard cap on saved queries per `(user, entity)` so a runaway client
 * cannot fill the table. The reviewer can prune from the page. */
export const MAX_SAVED_QUERIES_PER_USER_PER_ENTITY = 50

/**
 * Convert a parsed `AuditListParams` (with page) into the saved-query
 * shape (without page). Used by the save endpoint before serializing.
 */
export function paramsForSave(params: AuditListParams): Omit<AuditListParams, 'page'> {
  const { page: _page, ...rest } = params
  return rest
}

/**
 * Reconstitute saved-query params into a URL query string that the
 * audit page understands. Round-trips through the same params shape
 * `parseAuditListParams` accepts; reviewers see exactly the filter set
 * they named.
 */
export function savedQueryToSearchParams(query: SavedQuery): URLSearchParams {
  const sp = new URLSearchParams()
  for (const value of query.params.skills) sp.append('skill', value)
  for (const value of query.params.actions) sp.append('action', value)
  for (const value of query.params.actors) sp.append('actor', value)
  for (const value of query.params.decisions) sp.append('decision', value)
  if (query.params.from !== null) sp.set('from', query.params.from)
  if (query.params.to !== null) sp.set('to', query.params.to)
  if (query.params.matter !== null) sp.set('matter', query.params.matter)
  if (query.params.q !== null) sp.set('q', query.params.q)
  if (query.params.sort !== 'ts_desc') sp.set('sort', query.params.sort)
  if (query.params.pageSize !== DEFAULT_AUDIT_PAGE_SIZE) {
    sp.set('pageSize', String(query.params.pageSize))
  }
  return sp
}

/**
 * Defensive parser. Returns null when the row's `query_json` is
 * malformed, missing required fields, or includes values outside the
 * closed vocabularies. The caller decides what to do with null —
 * `listSavedQueries` drops malformed rows rather than failing the
 * whole list so one bad row does not blank the saved-queries panel.
 */
function parseQueryJson(raw: string): Omit<AuditListParams, 'page'> | null {
  const obj = safeParseObject(raw)
  if (obj === null) return null
  const arrays = parseArrayFields(obj)
  if (arrays === null) return null
  const strings = parseNullableStringFields(obj)
  if (strings === null) return null
  return {
    ...arrays,
    ...strings,
    sort: parseSort(obj),
    pageSize: parsePageSize(obj),
  }
}

function safeParseObject(raw: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}

function parseArrayFields(obj: Record<string, unknown>): {
  skills: string[]
  actions: string[]
  actors: string[]
  decisions: AuditDecision[]
} | null {
  const skills = toStringArray(obj.skills)
  if (skills === null) return null
  const actions = toFilteredStringArray(obj.actions, AUDIT_ACTION_TYPE_SET)
  if (actions === null) return null
  const actors = toStringArray(obj.actors)
  if (actors === null) return null
  const decisions = toFilteredStringArray(obj.decisions, AUDIT_DECISION_SET)
  if (decisions === null) return null
  return { skills, actions, actors, decisions: decisions as AuditDecision[] }
}

function parseNullableStringFields(obj: Record<string, unknown>): {
  from: string | null
  to: string | null
  matter: string | null
  q: string | null
} | null {
  const from = toNullableString(obj.from)
  const to = toNullableString(obj.to)
  const matter = toNullableString(obj.matter)
  const q = toNullableString(obj.q)
  if (from === undefined || to === undefined || matter === undefined || q === undefined) {
    return null
  }
  return { from, to, matter, q }
}

function parseSort(obj: Record<string, unknown>): AuditSort {
  const sortRaw = typeof obj.sort === 'string' ? obj.sort : 'ts_desc'
  return AUDIT_SORT_SET.has(sortRaw) ? (sortRaw as AuditSort) : 'ts_desc'
}

function parsePageSize(obj: Record<string, unknown>): number {
  if (typeof obj.pageSize === 'number' && Number.isFinite(obj.pageSize) && obj.pageSize >= 1) {
    return Math.min(Math.floor(obj.pageSize), MAX_AUDIT_PAGE_SIZE)
  }
  return DEFAULT_AUDIT_PAGE_SIZE
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string') return null
    if (v.length > 0) out.push(v)
  }
  return out
}

function toFilteredStringArray(value: unknown, allowed: ReadonlySet<string>): string[] | null {
  const raw = toStringArray(value)
  if (raw === null) return null
  return raw.filter((v) => allowed.has(v))
}

function toNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value === 'string') return value.length > 0 ? value : null
  return undefined
}

/**
 * Validate a candidate name. Returns the trimmed name on success or a
 * structured error code on failure. The endpoint maps codes to HTTP
 * status codes / redirect query params.
 */
export type SavedQueryNameError = 'empty' | 'too_long'

export function validateSavedQueryName(
  raw: string | null | undefined
): { ok: true; name: string } | { ok: false; error: SavedQueryNameError } {
  if (typeof raw !== 'string') return { ok: false, error: 'empty' }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, error: 'empty' }
  if (trimmed.length > MAX_SAVED_QUERY_NAME_LENGTH) return { ok: false, error: 'too_long' }
  return { ok: true, name: trimmed }
}

interface SavedQueryDbRow {
  id: string
  org_id: string
  user_id: string
  entity_id: string
  name: string
  query_json: string
  created_at: string
  updated_at: string
}

function rowToSavedQuery(row: SavedQueryDbRow): SavedQuery | null {
  const params = parseQueryJson(row.query_json)
  if (params === null) return null
  return {
    id: row.id,
    name: row.name,
    params,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * List the caller's saved queries for an entity, newest-first. Malformed
 * rows drop silently rather than blanking the panel; the row count is
 * accurate against well-formed rows only.
 */
export async function listSavedQueries(
  db: D1Database,
  userId: string,
  entityId: string
): Promise<SavedQuery[]> {
  const result = await db
    .prepare(
      `SELECT * FROM audit_saved_queries
        WHERE user_id = ? AND entity_id = ?
        ORDER BY updated_at DESC, created_at DESC`
    )
    .bind(userId, entityId)
    .all<SavedQueryDbRow>()
  const rows = result.results ?? []
  const out: SavedQuery[] = []
  for (const row of rows) {
    const parsed = rowToSavedQuery(row)
    if (parsed !== null) out.push(parsed)
  }
  return out
}

/**
 * Count saved queries for `(user, entity)`. Used by the save endpoint
 * to enforce the per-user cap before insert.
 */
export async function countSavedQueries(
  db: D1Database,
  userId: string,
  entityId: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM audit_saved_queries
        WHERE user_id = ? AND entity_id = ?`
    )
    .bind(userId, entityId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/**
 * Upsert a saved query by `(user_id, entity_id, name)`. Returns the
 * stored row's id (the existing row's id when overwriting, a freshly
 * generated UUID when inserting).
 */
export async function upsertSavedQuery(
  db: D1Database,
  args: {
    orgId: string
    userId: string
    entityId: string
    name: string
    params: Omit<AuditListParams, 'page'>
  }
): Promise<string> {
  const existing = await db
    .prepare(
      `SELECT id FROM audit_saved_queries
        WHERE user_id = ? AND entity_id = ? AND name = ?`
    )
    .bind(args.userId, args.entityId, args.name)
    .first<{ id: string }>()

  const queryJson = JSON.stringify(args.params)
  const now = new Date().toISOString()

  if (existing) {
    await db
      .prepare(
        `UPDATE audit_saved_queries
            SET query_json = ?, updated_at = ?
          WHERE id = ?`
      )
      .bind(queryJson, now, existing.id)
      .run()
    return existing.id
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO audit_saved_queries
        (id, org_id, user_id, entity_id, name, query_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, args.orgId, args.userId, args.entityId, args.name, queryJson, now, now)
    .run()
  return id
}

/**
 * Delete a saved query by id. Scoped to `(user_id, entity_id)` so a
 * cross-tenant id collision (impossible by construction; defensive)
 * cannot drop another tenant's row. Returns the number of rows
 * deleted (0 when the id is unknown or belongs to a different user).
 */
export async function deleteSavedQuery(
  db: D1Database,
  args: { userId: string; entityId: string; id: string }
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM audit_saved_queries
        WHERE id = ? AND user_id = ? AND entity_id = ?`
    )
    .bind(args.id, args.userId, args.entityId)
    .run()
  const meta = result.meta as { changes?: number } | undefined
  return meta?.changes ?? 0
}
