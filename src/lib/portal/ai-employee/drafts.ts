/**
 * AI Employee drafts list — typed contract + read resolver.
 *
 * Per PRD §12, the draft queue is the primary user-facing surface for the
 * AI Employee. Every outbound message the AI Employee proposes lands in
 * this queue and waits for a human reviewer before it sends
 * (reviewer-as-sender, ADR 0005).
 *
 * Data source: per-customer Hermes Machine D1 (ADR 0007 + 0009). The
 * portal Worker can NOT bind to a per-customer D1 directly; reads go
 * through an internal Hermes bridge (PR #907 architecture, runtime
 * wiring tracked in #821). Until that bridge ships, this resolver
 * returns an empty list with the correct typed shape so the page
 * machinery (filter bar, table, pagination) works end-to-end without
 * fabricating rows. No mock data. No placeholder copy. See
 * docs/style/empty-state-pattern.md.
 *
 * This module owns:
 *   - The Draft row shape consumed by the list UI
 *   - Filter / sort / pagination parameter parsing from URLSearchParams
 *   - The (currently empty) data fetch
 *
 * When the bridge lands, only `fetchDraftsFromHermes` changes. Filter
 * parsing, validation, and the page UI stay put.
 */

import type { SubscriptionRow } from '../product-access'

/**
 * Trust-ceiling decisions emitted by the AI Employee per ADR 0005. The
 * vocabulary is closed; new values require an ADR amendment and a
 * matching label update below.
 *
 *   draft_for_review — Default. The AI Employee proposes; a reviewer
 *                      must approve and send.
 *   auto_send        — Reserved for future principal-configured
 *                      auto-approval paths (not in v1). Listed so the
 *                      type matches the schema once the bridge wires
 *                      it through; the UI renders the chip but never
 *                      fabricates a row that uses it.
 */
export type TrustCeiling = 'draft_for_review' | 'auto_send'

/**
 * Sort options exposed via `?sort=`. Default is `age_desc` (newest
 * first) — the queue's primary scan-time question is "what's new since
 * I last looked." `priority_desc` surfaces high-urgency drafts. `skill`
 * groups visually for reviewers who want to triage by category.
 */
export type DraftSort = 'age_desc' | 'age_asc' | 'priority_desc' | 'skill'

export const DRAFT_SORTS: readonly DraftSort[] = [
  'age_desc',
  'age_asc',
  'priority_desc',
  'skill',
] as const

/**
 * Priority is a small closed vocabulary because the queue is a triage
 * surface — three buckets give the reviewer a Pareto cut without the
 * cognitive load of a numeric scale. Source values land from Hermes;
 * the resolver below validates them.
 */
export type DraftPriority = 'low' | 'normal' | 'high'

export const DRAFT_PRIORITIES: readonly DraftPriority[] = ['low', 'normal', 'high'] as const

/**
 * One row in the draft queue. Shape mirrors what the Hermes bridge will
 * return when #821 lands. Field semantics:
 *
 *   id           — Stable draft identifier. Forms the detail-page URL.
 *   sender       — The identity the AI Employee drafted ON BEHALF OF
 *                  (e.g., "Pat Owner <pat@firm.com>"). Required: every
 *                  draft has an originating identity.
 *   recipient    — Outbound address the draft is addressed to.
 *   skill        — Slug of the capability that produced the draft
 *                  (e.g., "client-intake", "deadline-followup"). The
 *                  filter bar surfaces these to triage by category.
 *   trustCeiling — The reviewer-gate decision attached to this draft.
 *   ageSeconds   — Seconds since the draft was created. Server-resolved
 *                  so we don't depend on client clock skew. Renderer
 *                  formats to relative text ("2h ago").
 *   priority     — Triage bucket. See DraftPriority.
 *   subject      — Optional message subject for context. May be null
 *                  for skills that don't produce subject lines.
 */
export interface Draft {
  id: string
  sender: string
  recipient: string
  skill: string
  trustCeiling: TrustCeiling
  ageSeconds: number
  priority: DraftPriority
  subject: string | null
}

/**
 * Parameters parsed from the page's URLSearchParams. All optional —
 * the page renders an unfiltered list when nothing is passed.
 *
 * skills        — Multi-select. Empty array means "all skills".
 * recipient     — Free-text substring match (case-insensitive). null
 *                 means no filter. The trim+lowercase happens in
 *                 parseDraftListParams so consumers don't have to.
 * maxAgeHours   — Upper bound on draft age. null means no filter.
 *                 Useful for "show me drafts younger than 24h."
 * sort          — One of DRAFT_SORTS. Defaults to 'age_desc'.
 * page          — 1-indexed page number. Defaults to 1. Out-of-range
 *                 values are clamped to 1 by the resolver.
 * pageSize      — Defaults to 50 per AC. Capped at 200 so a hostile
 *                 query string can't drag a Worker over its CPU limit.
 */
export interface DraftListParams {
  skills: readonly string[]
  recipient: string | null
  maxAgeHours: number | null
  sort: DraftSort
  page: number
  pageSize: number
}

export const DEFAULT_DRAFT_PAGE_SIZE = 50
export const MAX_DRAFT_PAGE_SIZE = 200

/**
 * Parse params from URLSearchParams. Defensive — every field is
 * validated against the closed vocabularies above; unknown values fall
 * back to safe defaults instead of throwing. This keeps the surface
 * stable under user-typed URLs and bookmark drift.
 *
 * `skill` supports comma-separated values for multi-select
 * (`?skill=intake,deadline`) which is the common URL convention. A
 * repeated `?skill=intake&skill=deadline` is also accepted.
 */
export function parseDraftListParams(searchParams: URLSearchParams): DraftListParams {
  // Multi-select skill: union of repeated params and comma-separated values.
  const rawSkillParams = searchParams.getAll('skill')
  const skills = Array.from(
    new Set(
      rawSkillParams
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  )

  // Recipient: trimmed, lowercased substring. Empty after trim means
  // "no filter" — not an exact match on the empty string.
  const rawRecipient = searchParams.get('recipient')?.trim() ?? ''
  const recipient = rawRecipient.length > 0 ? rawRecipient.toLowerCase() : null

  // maxAgeHours: positive number or null. Reject NaN, negatives, zero
  // (zero would always return nothing — almost certainly an authoring
  // mistake, not a query the reviewer meant).
  const rawMaxAge = searchParams.get('maxAgeHours')
  let maxAgeHours: number | null = null
  if (rawMaxAge !== null) {
    const parsed = Number(rawMaxAge)
    if (Number.isFinite(parsed) && parsed > 0) {
      maxAgeHours = parsed
    }
  }

  // Sort: must be in the closed vocabulary. Anything else → default.
  const rawSort = searchParams.get('sort')
  const sort: DraftSort = DRAFT_SORTS.includes(rawSort as DraftSort)
    ? (rawSort as DraftSort)
    : 'age_desc'

  // Page: 1-indexed, default 1, floor at 1.
  const rawPage = Number(searchParams.get('page'))
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1

  // PageSize: default 50, cap MAX_DRAFT_PAGE_SIZE.
  const rawPageSize = Number(searchParams.get('pageSize'))
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1
      ? Math.min(Math.floor(rawPageSize), MAX_DRAFT_PAGE_SIZE)
      : DEFAULT_DRAFT_PAGE_SIZE

  return { skills, recipient, maxAgeHours, sort, page, pageSize }
}

/**
 * Apply filters to a Draft list in-memory. Exposed for the resolver
 * below and for unit tests. The Hermes bridge will eventually push
 * filtering server-side and this function will only run for in-page
 * post-filtering (or be replaced entirely). For now it's the source of
 * truth so the empty-list contract has tested filter semantics.
 */
export function applyDraftFilters(rows: readonly Draft[], params: DraftListParams): Draft[] {
  let result = rows.slice()

  if (params.skills.length > 0) {
    const wanted = new Set(params.skills)
    result = result.filter((row) => wanted.has(row.skill))
  }

  if (params.recipient !== null) {
    const needle = params.recipient
    result = result.filter((row) => row.recipient.toLowerCase().includes(needle))
  }

  if (params.maxAgeHours !== null) {
    const maxSeconds = params.maxAgeHours * 3600
    result = result.filter((row) => row.ageSeconds <= maxSeconds)
  }

  return result
}

/**
 * Sort a (pre-filtered) Draft list according to params.sort. Priority
 * sort uses the closed vocabulary's natural order (high > normal >
 * low); ties break by age (newest first) so the ordering is stable
 * within a bucket.
 */
const PRIORITY_RANK: Record<DraftPriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
}

export function applyDraftSort(rows: readonly Draft[], sort: DraftSort): Draft[] {
  const sorted = rows.slice()
  switch (sort) {
    case 'age_desc':
      sorted.sort((a, b) => a.ageSeconds - b.ageSeconds)
      return sorted
    case 'age_asc':
      sorted.sort((a, b) => b.ageSeconds - a.ageSeconds)
      return sorted
    case 'priority_desc':
      sorted.sort((a, b) => {
        const rankDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
        if (rankDiff !== 0) return rankDiff
        return a.ageSeconds - b.ageSeconds
      })
      return sorted
    case 'skill':
      sorted.sort((a, b) => {
        const skillDiff = a.skill.localeCompare(b.skill)
        if (skillDiff !== 0) return skillDiff
        return a.ageSeconds - b.ageSeconds
      })
      return sorted
  }
}

/**
 * Pagination return value. `totalCount` is the count after filtering
 * but before pagination — what the UI shows as "X drafts" / "Page N
 * of M". `pageCount` is computed from totalCount and pageSize, floored
 * at 1 even when there are zero rows so "Page 1 of 1" reads sensibly
 * in the empty state.
 */
export interface DraftListPage {
  rows: Draft[]
  totalCount: number
  page: number
  pageSize: number
  pageCount: number
}

/**
 * Apply offset-based pagination to a sorted+filtered list. Page is
 * 1-indexed, clamped to [1, pageCount]. Out-of-range pages return the
 * last page rather than an empty result — keeps deep links to a
 * just-cleared page from rendering as "no drafts" when the reviewer
 * meant the new top of the list.
 */
export function paginateDrafts(
  rows: readonly Draft[],
  page: number,
  pageSize: number
): DraftListPage {
  const totalCount = rows.length
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
  const clampedPage = Math.min(Math.max(1, Math.floor(page)), pageCount)
  const start = (clampedPage - 1) * pageSize
  return {
    rows: rows.slice(start, start + pageSize),
    totalCount,
    page: clampedPage,
    pageSize,
    pageCount,
  }
}

/**
 * Compose filter → sort → paginate over an in-memory Draft list.
 * Useful for unit tests; the page calls listDraftsForCustomer below.
 */
export function buildDraftListPage(rows: readonly Draft[], params: DraftListParams): DraftListPage {
  const filtered = applyDraftFilters(rows, params)
  const sorted = applyDraftSort(filtered, params.sort)
  return paginateDrafts(sorted, params.page, params.pageSize)
}

/**
 * Format an age in seconds as a compact relative-time string for the
 * drafts table ("2h ago", "12m ago", "3d ago"). Returns "just now"
 * for ages under 60 seconds — anything smaller is noise in a triage
 * surface. Negative ages (clock skew, malformed bridge response)
 * collapse to "just now" rather than rendering "-2h ago".
 *
 * Pure function: takes the age in seconds, not a Date, so the page
 * doesn't depend on now-time at format time and the rendered HTML
 * is deterministic for snapshot/golden tests.
 */
export function formatDraftAge(ageSeconds: number): string {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 60) return 'just now'
  const minutes = Math.floor(ageSeconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

/**
 * Human label for a TrustCeiling value. The vocabulary is closed
 * (see TrustCeiling) so the lookup is total — unknown values fall
 * through to the raw value rather than fabricating a friendly label.
 */
export function formatTrustCeiling(ceiling: TrustCeiling): string {
  switch (ceiling) {
    case 'draft_for_review':
      return 'Review required'
    case 'auto_send':
      return 'Auto-send'
  }
}

/**
 * Human label for a DraftPriority value. Closed vocabulary; see
 * DraftPriority. Title-cased for table-row readability.
 */
export function formatDraftPriority(priority: DraftPriority): string {
  switch (priority) {
    case 'high':
      return 'High'
    case 'normal':
      return 'Normal'
    case 'low':
      return 'Low'
  }
}

/**
 * Collect the distinct skills present in a draft list, sorted
 * alphabetically. Used by the page to populate the skill multi-select
 * in the filter bar without coupling the page render to UI iteration
 * vocabulary (see the portal list-row registry in
 * tests/forbidden-strings.test.ts).
 */
export function distinctSkills(rows: readonly Draft[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    seen.add(row.skill)
  }
  return Array.from(seen).sort()
}

/**
 * Server-side resolver invoked by the drafts list page. Today this
 * returns an empty list with the correct shape — the per-customer
 * Hermes bridge that feeds real drafts is tracked in #821. When the
 * bridge lands, swap fetchDraftsFromHermes for the bridge call and
 * leave the rest of the page machinery in place.
 *
 * IMPORTANT: do not seed mock rows here. The empty-state pattern is
 * the design contract (docs/style/empty-state-pattern.md) — the page
 * must render its empty state until real data lands, never fabricated
 * placeholders.
 */
export async function listDraftsForCustomer(
  _subscription: SubscriptionRow,
  params: DraftListParams
): Promise<DraftListPage> {
  const rows = await fetchDraftsFromHermes(_subscription)
  return buildDraftListPage(rows, params)
}

/**
 * Hermes bridge stub. Returns an empty list. When #821 (Hermes runtime
 * wiring) lands, replace the body with the bridge fetch — the
 * subscription row carries the customer identity needed to route to
 * the right Machine D1. Promise.resolve keeps the call shape async so
 * the future swap is body-only.
 */
function fetchDraftsFromHermes(_subscription: SubscriptionRow): Promise<Draft[]> {
  return Promise.resolve([])
}

/**
 * Draft detail resolver — fetch one draft by id for the active customer.
 *
 * Powers the draft detail page at
 * `/portal/products/ai-employee/drafts/[id]`, which adds the Approve & Send
 * surface on top of the read shape established by the list resolver above.
 *
 * Today this returns null unconditionally because the Hermes bridge has
 * not landed (#821). The page renders a "not found" empty state per
 * docs/style/empty-state-pattern.md — no fabricated draft body, no
 * placeholder recipients, no synthetic subject lines. When the bridge
 * ships, swap `fetchDraftFromHermes` for the bridge call and the page
 * machinery (detail layout, Approve & Send button, role gate) lights
 * up unchanged.
 *
 * Body / preview is intentionally NOT on the list `Draft` shape because
 * the queue surface scans by sender / recipient / skill — body would
 * compete with those signals at row level. The detail surface needs the
 * full message, so the resolver returns a richer `DraftDetail` shape
 * that extends `Draft` with the additional fields a reviewer needs to
 * approve.
 *
 * IMPORTANT: do not seed mock rows here. The empty-state pattern is the
 * design contract — until real data lands, this resolver returns null.
 */
export async function getDraft(
  _subscription: SubscriptionRow,
  _draftId: string
): Promise<DraftDetail | null> {
  return fetchDraftFromHermes(_subscription, _draftId)
}

/**
 * Extended draft shape used by the detail page. Inherits the list-row
 * fields and adds the message body, the reviewer-visible "drafted by
 * [persona] on [timestamp]" preamble (per ADR 0005 — stripped before
 * send but surfaced in the review UI as part of the audit trail), and
 * the send-pathway lifecycle fields the Approve & Send surface reads.
 *
 *   bodyPlain      — Full message body as plain text. The reviewer reads
 *                    and edits this before approving. Plain text is the
 *                    minimum-viable contract; rich-text rendering lands
 *                    when the connector wiring exposes it.
 *   personaName    — Internal-only persona name ("Marcus", "Sarah", per
 *                    ADR 0005 §Decision). Used in the "drafted by"
 *                    preamble in the review UI. Never crosses the
 *                    external boundary.
 *   personaDraftedAt — ISO timestamp when the AI Employee created the
 *                      draft. Reviewer-facing chronology.
 *   reviewerEmail  — The email account the draft is staged into. This
 *                    is the address the message will ship from
 *                    (reviewer-as-sender, ADR 0005). Required — every
 *                    draft is staged into a real reviewer mailbox.
 *   sendStatus     — Lifecycle of the send pathway. One of:
 *                      pending        — draft is in the queue, awaiting
 *                                       reviewer action
 *                      sending        — within the undo window after
 *                                       Approve & Send was clicked
 *                      sent           — connector confirmed delivery
 *                      send_failed    — connector returned an error;
 *                                       draft returns to queue with the
 *                                       failure surfaced inline
 *   sendError      — Human-readable error from the last send attempt,
 *                    null unless sendStatus === 'send_failed'.
 */
export type DraftSendStatus = 'pending' | 'sending' | 'sent' | 'send_failed'

export interface DraftDetail extends Draft {
  bodyPlain: string
  personaName: string
  personaDraftedAt: string
  reviewerEmail: string
  sendStatus: DraftSendStatus
  sendError: string | null
}

/**
 * Hermes bridge stub for the detail resolver. Mirrors
 * `fetchDraftsFromHermes` — returns null today, swaps to a real fetch
 * when #821 lands. Promise.resolve keeps the call shape async so the
 * page-side await site stays stable.
 */
function fetchDraftFromHermes(
  _subscription: SubscriptionRow,
  _draftId: string
): Promise<DraftDetail | null> {
  return Promise.resolve(null)
}

/**
 * Human label for a DraftSendStatus value. Closed vocabulary; see
 * DraftSendStatus. Used by the detail page's status display and by the
 * inline error banner.
 */
export function formatDraftSendStatus(status: DraftSendStatus): string {
  switch (status) {
    case 'pending':
      return 'Ready for review'
    case 'sending':
      return 'Sending'
    case 'sent':
      return 'Sent'
    case 'send_failed':
      return 'Send failed'
  }
}
