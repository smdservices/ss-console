/**
 * AI Employee in-app notifications — typed contract + read resolver.
 *
 * Per #876, customers need to be alerted when something they care about
 * happens inside the AI Employee surface: a draft is ready for review,
 * an error needs attention, a calibration prompt is waiting, or the
 * weekly digest has landed. Today there is no notification surface;
 * this module is the source of truth for the shape of one when the
 * Hermes bridge (#821) wires real events through.
 *
 * Data source: per-customer Hermes Machine D1 (ADR 0007 + 0009),
 * filtered down to notification-eligible events from the existing
 * `audit_log` writer plus any future first-class notifications table.
 * The portal Worker cannot bind directly to a per-customer D1; reads
 * go through an internal Hermes bridge (PR #907 architecture). Until
 * that bridge ships, this resolver returns an empty typed list so the
 * page machinery (filter bar, mark-as-read flow, pagination) is
 * stable end-to-end without fabricating rows. No mock data. No
 * placeholder copy. See docs/style/empty-state-pattern.md.
 *
 * When the bridge lands, only `fetchNotificationsFromHermes` and
 * `markNotificationReadInHermes` change. Filter parsing, validation,
 * formatters, and the page UI stay put.
 *
 * Mirrors the shape of `src/lib/portal/ai-employee/drafts.ts` and
 * `audit.ts` deliberately (sibling list views, same pagination
 * contract). Differences:
 *
 *   - Notifications carry an `unread` flag — the mark-as-read flow
 *     mutates it, the bell badge counts it, the filter bar exposes a
 *     "unread only" toggle. Drafts and audit entries are immutable
 *     history; notifications are read-state per user.
 *   - Notification type is a small closed enum (`draft_ready`,
 *     `error`, `calibration_prompt`, `weekly_digest`) per AC, not the
 *     long audit-action vocabulary. The four categories map to the
 *     four customer concerns the issue cites.
 *   - The "actor" field is optional — system-generated notifications
 *     (weekly digest, error) have no human actor; draft_ready and
 *     calibration_prompt may carry one.
 */

import type { SubscriptionRow } from '../product-access'
import { type Page, paginate } from './pagination'
import { formatRelativeAgeIso } from './relative-age'

/**
 * Closed vocabulary of notification kinds. Each maps to one of the
 * four customer concerns the issue cites. Additions require updating
 * the format helpers below in lockstep and adding an option to the
 * filter bar; defensive parsing drops unknown values from the URL
 * filter so a stale bookmark cannot silently filter the whole list to
 * empty.
 *
 *   draft_ready        — A new draft has arrived in the queue and is
 *                        waiting for a reviewer.
 *   error              — Something went wrong: connector auth expired,
 *                        invariant violation, fabrication filter fired.
 *                        Reviewer attention required.
 *   calibration_prompt — The AI Employee is asking the principal to
 *                        confirm or adjust a behavior (trust ceiling
 *                        change, memory rule, voice gate result).
 *   weekly_digest      — Rollup of the week's activity. Informational.
 */
export type NotificationType = 'draft_ready' | 'error' | 'calibration_prompt' | 'weekly_digest'

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  'draft_ready',
  'error',
  'calibration_prompt',
  'weekly_digest',
] as const

const NOTIFICATION_TYPE_SET: ReadonlySet<string> = new Set(NOTIFICATION_TYPES)

/**
 * Sort options exposed via `?sort=`. Default is `ts_desc` (newest
 * first) — notifications are a "what just landed" surface for the
 * customer's daily glance. `ts_asc` is the chronological reading order
 * for incident reconstruction (rare, but cheap to support).
 */
export type NotificationSort = 'ts_desc' | 'ts_asc'

export const NOTIFICATION_SORTS: readonly NotificationSort[] = ['ts_desc', 'ts_asc'] as const

/**
 * One row in the notifications list. Shape mirrors what the Hermes
 * bridge will return when #821 lands. Field semantics:
 *
 *   id        — Stable notification identifier. Forms the
 *               mark-as-read POST target and React-style row key.
 *   type      — Closed vocabulary (see NotificationType). Drives the
 *               icon, tone, and default action label.
 *   ts        — ISO 8601 UTC with millisecond precision. The writer
 *               always emits this; the renderer formats it for display.
 *   summary   — Short human-readable line, one sentence, no trailing
 *               period preferred. Renders as the row's primary text.
 *               Authored by the writer per notification class — never
 *               fabricated client-side.
 *   actor     — Optional caller identity. System-generated events
 *               (weekly digest, error) leave this null. Draft-ready
 *               and calibration-prompt may carry the skill or agent
 *               name. Renders verbatim; the resolver never fabricates
 *               a friendly name.
 *   actionUrl — Optional URL the row links to ("View draft", "Review
 *               calibration"). null means the row is read-only
 *               informational (weekly digest landing copy). When
 *               populated, the bridge guarantees same-origin paths
 *               only — the renderer does not validate.
 *   unread    — Per-user read state. Mutated by the mark-as-read POST.
 *               The bell badge counts rows with `unread === true`.
 */
export interface Notification {
  id: string
  type: NotificationType
  ts: string
  summary: string
  actor: string | null
  actionUrl: string | null
  unread: boolean
}

/**
 * Parameters parsed from the page's URLSearchParams. All optional —
 * the page renders an unfiltered list when nothing is passed.
 *
 *   types      — Multi-select notification-type filter. Empty array =
 *                all types. Values outside NOTIFICATION_TYPES are
 *                dropped (defensive against bookmark drift).
 *   unreadOnly — When true, only rows with `unread === true` are
 *                returned. Defaults to false.
 *   sort       — One of NOTIFICATION_SORTS. Defaults to 'ts_desc'.
 *   page       — 1-indexed page number. Defaults to 1. Out-of-range
 *                values clamp to 1.
 *   pageSize   — Defaults to 50 per AC. Capped at MAX_NOTIFICATION_PAGE_SIZE.
 */
export interface NotificationListParams {
  types: readonly NotificationType[]
  unreadOnly: boolean
  sort: NotificationSort
  page: number
  pageSize: number
}

export const DEFAULT_NOTIFICATION_PAGE_SIZE = 50
export const MAX_NOTIFICATION_PAGE_SIZE = 200

/**
 * Parse params from URLSearchParams. Defensive — every field is
 * validated against the closed vocabularies above; unknown values
 * fall back to safe defaults instead of throwing. This keeps the
 * surface stable under user-typed URLs and bookmark drift.
 *
 * `type` supports both comma-separated values (`?type=draft_ready,error`)
 * and repeated params (`?type=draft_ready&type=error`).
 */
export function parseNotificationListParams(searchParams: URLSearchParams): NotificationListParams {
  const rawTypeParams = searchParams.getAll('type')
  const types = Array.from(
    new Set(
      rawTypeParams
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter((value): value is NotificationType => NOTIFICATION_TYPE_SET.has(value))
    )
  )

  // `unread=1` / `unread=true` toggle the filter on. Anything else is
  // treated as "off" — a missing param and an explicit "0" both mean
  // "show all".
  const rawUnread = searchParams.get('unread')
  const unreadOnly = rawUnread === '1' || rawUnread === 'true'

  const rawSort = searchParams.get('sort')
  const sort: NotificationSort = NOTIFICATION_SORTS.includes(rawSort as NotificationSort)
    ? (rawSort as NotificationSort)
    : 'ts_desc'

  const rawPage = Number(searchParams.get('page'))
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1

  const rawPageSize = Number(searchParams.get('pageSize'))
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1
      ? Math.min(Math.floor(rawPageSize), MAX_NOTIFICATION_PAGE_SIZE)
      : DEFAULT_NOTIFICATION_PAGE_SIZE

  return { types, unreadOnly, sort, page, pageSize }
}

/**
 * Apply filters to a Notification list in-memory. Exposed for the
 * resolver below and for unit tests. The Hermes bridge will eventually
 * push filtering server-side and this function will only run for
 * in-page post-filtering (or be replaced entirely). For now it is the
 * source of truth so the empty-list contract has tested filter
 * semantics.
 */
export function applyNotificationFilters(
  rows: readonly Notification[],
  params: NotificationListParams
): Notification[] {
  let result = rows.slice()

  if (params.types.length > 0) {
    const wanted = new Set<NotificationType>(params.types)
    result = result.filter((row) => wanted.has(row.type))
  }

  if (params.unreadOnly) {
    result = result.filter((row) => row.unread)
  }

  return result
}

/**
 * Sort a (pre-filtered) Notification list by timestamp. ISO 8601
 * strings sort lexicographically the same way as their underlying
 * instants for any well-formed value, but the writer is the only
 * authority on timestamp formatting and a malformed value would shift
 * the sort. `Date.parse` keeps the comparison numeric and stable.
 */
export function applyNotificationSort(
  rows: readonly Notification[],
  sort: NotificationSort
): Notification[] {
  const sorted = rows.slice()
  switch (sort) {
    case 'ts_desc':
      sorted.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      return sorted
    case 'ts_asc':
      sorted.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
      return sorted
  }
}

/** Pagination return value. See {@link Page} (pagination.ts). */
export type NotificationListPage = Page<Notification>

/**
 * Apply offset-based pagination to a sorted+filtered list. Thin wrapper over
 * the shared {@link paginate}; kept named for call-site + test stability.
 */
export function paginateNotifications(
  rows: readonly Notification[],
  page: number,
  pageSize: number
): NotificationListPage {
  return paginate(rows, page, pageSize)
}

/**
 * Compose filter → sort → paginate over an in-memory Notification
 * list. Useful for unit tests; the page calls listNotifications below.
 */
export function buildNotificationListPage(
  rows: readonly Notification[],
  params: NotificationListParams
): NotificationListPage {
  const filtered = applyNotificationFilters(rows, params)
  const sorted = applyNotificationSort(filtered, params.sort)
  return paginateNotifications(sorted, params.page, params.pageSize)
}

/**
 * Count the unread notifications in a list. Exposed for the bell-icon
 * badge — the badge always reflects total unread, not the
 * filter-narrowed count. Returns 0 for an empty list.
 */
export function countUnread(rows: readonly Notification[]): number {
  let n = 0
  for (const row of rows) {
    if (row.unread) n += 1
  }
  return n
}

/**
 * Human label for a NotificationType value. The vocabulary is closed
 * (see NotificationType) so the lookup is total — unknown values fall
 * through to the raw value rather than fabricating a friendly label.
 */
export function formatNotificationType(type: NotificationType): string {
  switch (type) {
    case 'draft_ready':
      return 'Draft ready'
    case 'error':
      return 'Error'
    case 'calibration_prompt':
      return 'Calibration prompt'
    case 'weekly_digest':
      return 'Weekly digest'
  }
}

/**
 * Tone for the type chip in the row. `error` is danger (something
 * needs attention), `calibration_prompt` is warning (action requested
 * but not urgent), `draft_ready` is info (new work to review),
 * `weekly_digest` is neutral (informational rollup).
 *
 * The return values are the `Tone` vocabulary from
 * `src/lib/portal/status.ts` — kept as a string literal union here to
 * avoid a hard import dependency at the resolver layer.
 */
export function notificationTone(
  type: NotificationType
): 'danger' | 'warning' | 'info' | 'neutral' {
  switch (type) {
    case 'error':
      return 'danger'
    case 'calibration_prompt':
      return 'warning'
    case 'draft_ready':
      return 'info'
    case 'weekly_digest':
      return 'neutral'
  }
}

/**
 * Format an ISO timestamp as a compact relative-time string for the
 * notifications list ("2h ago", "12m ago", "3d ago"). Returns "just now"
 * for ages under 60 seconds — anything smaller is noise on a glanceable
 * surface. Negative ages (clock skew, malformed bridge response)
 * collapse to "just now" rather than rendering "-2h ago".
 *
 * Pure function: takes the timestamp string AND now-time, so rendered
 * HTML is deterministic for snapshot/golden tests. Returns the input
 * verbatim when the timestamp cannot be parsed — never fabricates a
 * label for a malformed value (the writer is the authority on this
 * field; surfacing the raw value lets reviewers see what the system
 * actually recorded).
 */
export function formatNotificationAge(ts: string, nowMs: number = Date.now()): string {
  return formatRelativeAgeIso(ts, nowMs)
}

/**
 * Server-side resolver invoked by the notifications list page. Today
 * this returns an empty list with the correct shape — the per-customer
 * Hermes bridge that feeds real notifications is tracked in #821.
 * When the bridge lands, swap `fetchNotificationsFromHermes` for the
 * bridge call and leave the rest of the page machinery in place.
 *
 * IMPORTANT: do not seed mock rows here. The empty-state pattern is
 * the design contract (docs/style/empty-state-pattern.md) — the page
 * must render its empty state until real data lands, never fabricated
 * placeholders.
 */
export async function listNotifications(
  _subscription: SubscriptionRow,
  params: NotificationListParams
): Promise<NotificationListPage> {
  const rows = await fetchNotificationsFromHermes(_subscription)
  return buildNotificationListPage(rows, params)
}

/**
 * Mark a single notification read. Returns true when the bridge
 * confirmed a state change, false when the row was already read or
 * did not exist. Today the bridge is a stub: it always returns false
 * because no rows exist, and the endpoint documents the contract for
 * when #821 lands. The caller (POST handler) treats both outcomes as
 * 200 — the URL semantics are idempotent on intent, not on effect.
 */
export async function markNotificationRead(
  _subscription: SubscriptionRow,
  _notificationId: string
): Promise<boolean> {
  return await markNotificationReadInHermes(_subscription, _notificationId)
}

/**
 * Mark every unread notification on this subscription read. Returns
 * the count of rows that flipped from unread to read. Today the
 * bridge stub returns 0 because no rows exist, and the endpoint
 * documents the contract for when #821 lands.
 */
export async function markAllNotificationsRead(_subscription: SubscriptionRow): Promise<number> {
  return await markAllNotificationsReadInHermes(_subscription)
}

/**
 * Hermes bridge stub for reads. Returns an empty list. When #821
 * (Hermes runtime wiring) lands, replace the body with the bridge
 * fetch — the subscription row carries the customer identity needed
 * to route to the right Machine D1. Promise.resolve keeps the call
 * shape async so the future swap is body-only.
 */
function fetchNotificationsFromHermes(_subscription: SubscriptionRow): Promise<Notification[]> {
  return Promise.resolve([])
}

/**
 * Hermes bridge stub for the single-row mark-as-read mutation.
 * Returns false (no row changed) because the read stub returns no
 * rows. When the bridge lands, this becomes the actual write call;
 * the return value reports whether the row existed and was actually
 * flipped from unread to read.
 */
function markNotificationReadInHermes(
  _subscription: SubscriptionRow,
  _notificationId: string
): Promise<boolean> {
  return Promise.resolve(false)
}

/**
 * Hermes bridge stub for the mark-all-read mutation. Returns 0 (no
 * rows changed) because the read stub returns no rows. When the
 * bridge lands, this becomes the bulk write; the return value reports
 * the count of rows that flipped.
 */
function markAllNotificationsReadInHermes(_subscription: SubscriptionRow): Promise<number> {
  return Promise.resolve(0)
}
