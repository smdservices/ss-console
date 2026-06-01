/**
 * Matter list and detail resolvers for the Operator portal surfaces.
 *
 * URL surfaces consuming this module:
 *   - /portal/products/operator/matters         (list)
 *   - /portal/products/operator/matters/[id]    (detail)
 *
 * Architecture (ADR 0007 + 0009): matters live on the per-customer Hermes
 * Machine D1, not the portal Worker's primary D1. The portal Worker
 * cannot bind a per-customer database directly — the bridge through
 * Hermes runtime wiring is the subject of #821. Until that lands, both
 * resolvers return their empty shape and the page renders the empty
 * state per docs/style/empty-state-pattern.md.
 *
 * No fabrication. No placeholder rows. No "coming soon" copy. The Pattern
 * A/B audit in the project CLAUDE.md treats invented client-facing
 * content as a P0 violation: the only acceptable substitute for authored
 * data is the empty-state pattern.
 *
 * The types are exported so the page surfaces, the row component, and
 * future Hermes bridge code share one contract. When the bridge lands,
 * the resolver implementations swap; the types stay.
 */

/**
 * Phase vocabulary. Mirrors the Operator PI corpus PRD §12 (PR #832)
 * vocabulary for personal-injury matters. The list is closed and ordered
 * by lifecycle position so the UI can render the right stamp without
 * inventing fallback labels. Non-PI verticals will extend this enum, not
 * replace it, when their persona ships.
 *
 *   pre_suit    — pre-litigation negotiation, demand letters out, settlement under discussion
 *   discovery   — suit filed, discovery exchange underway
 *   pre_trial   — discovery closed, motions and pre-trial conference pending
 */
export type MatterPhase = 'pre_suit' | 'discovery' | 'pre_trial'

export const MATTER_PHASE_LABEL: Record<MatterPhase, string> = {
  pre_suit: 'Pre-Suit',
  discovery: 'Discovery',
  pre_trial: 'Pre-Trial',
}

/**
 * Last action the Operator took on this matter. `skill` is the
 * capability slug (e.g. `pi-demand-letter`, `pi-discovery-response`),
 * `at` is the ISO timestamp. Optional because a matter may exist before
 * the Operator has touched it.
 */
export interface MatterLastAction {
  skill: string
  at: string
}

/**
 * Row shape consumed by the matters list view. One row per matter.
 *
 * Field meanings:
 *   id                — opaque matter identifier (foreign to the portal,
 *                       owned by the Hermes Machine D1)
 *   clientName        — the client of the law firm (the matter is "for"
 *                       this person), not the customer firm itself
 *   matterType        — short label like "Auto Accident", "Slip and Fall"
 *   phase             — one of the closed-vocabulary phases above
 *   openedAt          — ISO timestamp when the matter was opened; used
 *                       to compute the age caption client-side
 *   lastAction        — most recent AI action on this matter, or null
 *                       if the matter has not yet been touched by the
 *                       Operator
 *   assigneeUserIds   — set of local users.id values currently assigned
 *                       to this matter (per matter_assignments). Empty
 *                       when no one is explicitly assigned — the firm's
 *                       principals are the implicit fallback per #882.
 *                       Stitched in by the page from the portal D1, not
 *                       by the Hermes resolver; the resolver returns []
 *                       and the page populates.
 */
export interface Matter {
  id: string
  clientName: string
  matterType: string
  phase: MatterPhase
  openedAt: string
  lastAction: MatterLastAction | null
  assigneeUserIds: string[]
}

/**
 * Timeline entry on a matter detail page. Each entry corresponds to a
 * material event — communication received, document filed, deadline
 * reached, AI action approved by the operator. The detail page renders
 * them in reverse chronological order.
 */
export interface MatterTimelineEntry {
  id: string
  at: string
  kind: 'communication' | 'document' | 'deadline' | 'ai_action' | 'note'
  summary: string
}

/**
 * Reference to a draft in flight for this matter. The detail page links
 * to the drafts surface filtered by this matter id; individual rows
 * carry enough metadata to identify the draft without resolving it
 * fully.
 */
export interface MatterDraftRef {
  id: string
  subject: string
  recipient: string
  skill: string
  createdAt: string
}

/**
 * Reference to an audit log entry tied to this matter. The detail page
 * surfaces a summary and links out to the dedicated audit viewer
 * (`/portal/products/operator/audit?matter=<id>`).
 */
export interface MatterAuditRef {
  id: string
  at: string
  actor: string
  action: string
  summary: string
}

/**
 * Detail-page payload. `facts` is the short statement-of-facts text the
 * Operator maintains on the matter; the other arrays are the
 * adjacent sections.
 *
 * `assigneeUserIds` mirrors the Matter list shape — the page stitches
 * this from the portal D1 matter_assignments table, not the Hermes
 * resolver. See `listMatterAssignments` in
 * `src/lib/portal/operator/matter-assignment.ts` for the richer
 * assignment row shape the detail page renders.
 */
export interface MatterDetail {
  id: string
  clientName: string
  matterType: string
  phase: MatterPhase
  openedAt: string
  facts: string | null
  timeline: MatterTimelineEntry[]
  draftsInFlight: MatterDraftRef[]
  recentAudit: MatterAuditRef[]
  lastAction: MatterLastAction | null
  assigneeUserIds: string[]
}

/**
 * List resolver. Returns the matters the active customer's Operator
 * is tracking. Today this returns an empty array because the Hermes
 * bridge has not landed (#821); the page renders the empty state.
 *
 * The signature accepts the portal D1 and entity id so the call site
 * matches the surrounding resolver style; both are unused for now and
 * become live when the bridge wires through. The function is declared
 * `async` (and returns a Promise) so the page-side `await` shape does
 * not need to change when the Hermes bridge lands and the body picks
 * up real async DB calls.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function listMatters(_db: D1Database, _entityId: string): Promise<Matter[]> {
  return []
}

/**
 * Filter a matter list to those assigned to the given user.  Pure on
 * its arguments so the multi-paralegal "my matters" view (#882) can
 * scope the page's matter array without a separate DB read — the page
 * already pre-loaded `assignedMatterIds` once for the toggle counter.
 *
 * A matter with no assignees is treated as "unassigned to anyone" and
 * filtered out from the "mine" view.  Unassigned matters surface only
 * on the "all" view, which is the principal's default.  Per #882 a
 * matter without an explicit assignee falls back to the firm's
 * principals at routing time — the UI mirrors that by hiding it from
 * non-principal "mine" views.
 */
export function filterMattersByAssignee(
  matters: readonly Matter[],
  assignedMatterIds: ReadonlySet<string>
): Matter[] {
  return matters.filter((m) => assignedMatterIds.has(m.id))
}

/**
 * Detail resolver. Returns the matter matching the supplied id, or null
 * if no matter is found on the active customer's Hermes D1. Today this
 * returns null unconditionally because the bridge has not landed; the
 * page renders a "not found" empty state and the breadcrumb back to
 * the list. The async shape is preserved for the same reason as
 * `listMatters`: the page-side `await` site stays stable when the
 * bridge wires up.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function getMatter(
  _db: D1Database,
  _entityId: string,
  _matterId: string
): Promise<MatterDetail | null> {
  return null
}

/**
 * Age caption formatter for matter rows. Reads `openedAt` and returns a
 * short relative-age string ("Opened 12d ago", "Opened today",
 * "Opened 4mo ago"). Returns an empty string for invalid input so the
 * caller can chain without guarding. Pure, no DB access, no locale
 * dependency beyond the day/month constants.
 */
export function formatMatterAge(
  openedAtIso: string | null | undefined,
  now: Date = new Date()
): string {
  if (!openedAtIso) return ''
  const opened = new Date(openedAtIso)
  if (Number.isNaN(opened.getTime())) return ''
  const diffMs = now.getTime() - opened.getTime()
  if (diffMs < 0) return 'Opened today'
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Opened today'
  if (diffDays === 1) return 'Opened 1d ago'
  if (diffDays < 30) return `Opened ${diffDays}d ago`
  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths === 1) return 'Opened 1mo ago'
  if (diffMonths < 12) return `Opened ${diffMonths}mo ago`
  const diffYears = Math.floor(diffMonths / 12)
  if (diffYears === 1) return 'Opened 1yr ago'
  return `Opened ${diffYears}yr ago`
}

/**
 * Phase stamp resolver. Returns the closed-vocabulary StampLabel for a
 * matter phase. Matters use a different stamp vocabulary than quotes
 * and invoices because the lifecycle does not map 1:1; we add the
 * three phase labels directly to keep the visual rhythm calm.
 *
 * The returned string is meant for the StatusPill's `label` prop. Tone
 * is resolved separately by `resolveMatterPhaseTone` below.
 */
export function resolveMatterPhaseStamp(phase: MatterPhase): string {
  switch (phase) {
    case 'pre_suit':
      return 'PRE-SUIT'
    case 'discovery':
      return 'DISCOVERY'
    case 'pre_trial':
      return 'PRE-TRIAL'
  }
}

/**
 * Tone for the matter phase stamp. Three phases, three tones, ordered
 * so the visual weight escalates with lifecycle position: info (early)
 * → warning (mid) → danger-adjacent (late). We use `outline` for the
 * pre-trial phase rather than `danger` because pre-trial is not a
 * failure state, it is a procedural milestone.
 */
import type { Tone } from '../status'

const MATTER_PHASE_TONE: Record<MatterPhase, Tone> = {
  pre_suit: 'info',
  discovery: 'warning',
  pre_trial: 'outline',
}

export function resolveMatterPhaseTone(phase: MatterPhase): Tone {
  return MATTER_PHASE_TONE[phase]
}
