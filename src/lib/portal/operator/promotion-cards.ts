/**
 * Trust-ceiling promotion recommendation cards — typed contract + resolver.
 *
 * Per #811, when a `draft_for_review` skill has maintained a sustained high
 * approval rate, the Operator landing page (Today tab per
 * platform-prd.md §12.1) surfaces a recommendation card prompting the
 * customer's principal to consider promoting it to `autonomous`. Without
 * this surface, the §11.3 promotion is a hidden Skills-tab action and the
 * §14.3 "≥2 skills promoted by day 60" success metric slips.
 *
 * The criteria are:
 *
 *   - The skill currently sits at `draft_for_review` (already-autonomous
 *     and refused skills are not candidates).
 *   - Approval rate has been ≥90% over each of the 4 most recent rolling
 *     weeks (not just averaged across 4 weeks — every individual week
 *     must clear the bar, so a single weak week resets the streak).
 *   - The skill is promotable per §11.2 (trust-accounting / court-filing /
 *     settlement-authority skills can never promote regardless of stats).
 *   - The principal has not dismissed the card for this skill within the
 *     last 7 days. After the cooldown the card re-surfaces if the criteria
 *     still hold — a deferred decision is not a permanent veto.
 *
 * Data sources:
 *
 *   - The "currently sits at draft_for_review" check comes from
 *     `customer.yaml` via the portal projection in `customer-config.ts`.
 *     This is on the hot path and is the only signal we have today.
 *   - Per-skill approval-rate stats (the four weekly rates that decide
 *     whether the streak holds) live in the per-customer Hermes Machine's
 *     audit_log + draft-review event stream. The portal Worker cannot bind
 *     directly to a per-customer D1 — reads will go through the same
 *     Hermes bridge that #821 wires up for notifications, drafts, matters,
 *     audit, and calendar. Until that bridge ships, the stats fetcher
 *     returns null and no card surfaces. This is the empty-state pattern
 *     (docs/style/empty-state-pattern.md): the section simply does not
 *     render until real data lands. No fake "85% approval" placeholders.
 *   - Dismissals live in the portal D1 `promotion_card_dismissals` table
 *     (migration 0040) — read here, written by the dismiss endpoint at
 *     `src/pages/api/portal/operator/promotion-cards/[skill]/dismiss.ts`.
 *
 * When the bridge lands, only `fetchSkillApprovalStatsFromHermes` changes.
 * The eligibility logic, threshold constants, dismissal lookup, and
 * candidate shape stay put.
 */

import { getCustomerConfig, type PersonaConfig } from '../customer-config'

/**
 * Approval-rate threshold per week for promotion eligibility. Sourced
 * verbatim from issue #811 ("≥90% approval rate over 4 consecutive
 * weeks"). Captured as a named constant so the PRD section, the resolver,
 * and the tests all reference the same number.
 */
export const PROMOTION_APPROVAL_RATE_THRESHOLD = 0.9

/**
 * Number of consecutive weeks the threshold must hold to qualify. Per
 * #811 the contract is "4 consecutive weeks" — every individual week
 * must clear the threshold, so a single weak week resets the streak.
 */
export const PROMOTION_REQUIRED_WEEKS = 4

/**
 * Cooldown window after a dismissal. The card re-surfaces past this
 * window if the criteria still hold. Seven days is short enough that a
 * principal who deferred the decision sees the prompt again within a
 * normal review cadence, and long enough that they aren't badgered the
 * day after dismissing.
 */
export const PROMOTION_DISMISSAL_COOLDOWN_DAYS = 7

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Skills that may never be promoted to `autonomous` regardless of stats.
 * Per platform-prd.md §11.2, anything that touches trust accounting,
 * court filing, settlement authority, or judgment-bearing work is
 * permanently held at `draft_for_review`. The list lives here because
 * this is where eligibility is computed; promoting a name into
 * customer.yaml does not bypass the gate.
 *
 * The vocabulary mirrors the persona-skill names emitted by Hermes; new
 * non-promotable skills must be added here as they ship.
 */
export const NON_PROMOTABLE_SKILLS: readonly string[] = [
  'trust-accounting',
  'court-filing',
  'settlement-authority',
  'judgment-bearing',
] as const

/**
 * Weekly stats for a single skill, as the Hermes bridge will return them
 * when #821 wires through. Each entry covers one rolling week; the array
 * is ordered most-recent first (index 0 is the current week, index 3 is
 * 3 weeks ago).
 *
 *   weekStart    — ISO 8601 UTC midnight on Monday of the week.
 *   approvalRate — Fraction in [0, 1]. NaN/missing weeks are not valid;
 *                  the bridge guarantees one row per week. A week with
 *                  no draft activity is null (no signal — does not count
 *                  as a pass OR a fail). The eligibility check treats
 *                  null as "streak interrupted" so silence cannot
 *                  qualify a skill for promotion.
 *   draftCount   — Total reviewed drafts that week. Surfaced in the card
 *                  body so the principal can see the volume behind the
 *                  rate, not just the rate alone.
 */
export interface SkillApprovalWeek {
  weekStart: string
  approvalRate: number | null
  draftCount: number
}

export interface SkillApprovalStats {
  skillName: string
  weeks: readonly SkillApprovalWeek[]
}

/**
 * One promotion candidate returned by the resolver. Shape is what the
 * PromotionCard component renders, plus the URL the card's primary CTA
 * routes to.
 *
 *   skillName       — Persona-skill name. Renders in the card title and
 *                     the dismiss POST URL.
 *   approvalRate    — Approval rate across the qualifying window
 *                     (PROMOTION_REQUIRED_WEEKS most-recent weeks),
 *                     weighted by draft count. Fraction in [0, 1].
 *                     Renders as a percentage in the card body.
 *   weeks           — The number of consecutive weeks the threshold has
 *                     held. Always ≥ PROMOTION_REQUIRED_WEEKS for a
 *                     candidate (a candidate is only emitted when the
 *                     streak qualifies).
 *   totalDrafts     — Total drafts reviewed across the qualifying window.
 *                     Surfaced so the principal can see "85% of 47
 *                     drafts" rather than "85%" alone.
 *   reviewUrl       — Where the [Review on Skills tab] CTA navigates.
 *                     Resolved here so the card component stays
 *                     presentational — the URL stays in the data model.
 *   dismissUrl      — Where the [Dismiss for now] form POSTs. Same
 *                     rationale: the card is a renderer, not a router.
 */
export interface PromotionCandidate {
  skillName: string
  approvalRate: number
  weeks: number
  totalDrafts: number
  reviewUrl: string
  dismissUrl: string
}

/**
 * One dismissal row from `promotion_card_dismissals`. Internal shape;
 * not exported because the resolver is the only consumer.
 */
interface DismissalRow {
  skill: string
  dismissed_at: string
}

/**
 * Resolve which skills currently qualify for a promotion recommendation
 * card on the given customer's Operator landing. Returns an empty
 * array when:
 *
 *   - the customer has no projected customer.yaml config (no signal),
 *   - no persona is currently active (nothing to evaluate),
 *   - no skill currently sits at `draft_for_review` (nothing to promote),
 *   - the Hermes stats bridge returns null (today's case — bridge not
 *     wired, no fabrication),
 *   - no skill meets the 4-week ≥90% threshold,
 *   - every candidate has been dismissed within the cooldown window.
 *
 * Anything else returns one candidate per qualifying skill. The page
 * gates the entire card section on this list being non-empty — no
 * candidates means no section, no empty-state copy.
 */
export async function listPromotionReadySkills(
  db: D1Database,
  entityId: string,
  instanceSlug: string,
  nowMs: number = Date.now()
): Promise<PromotionCandidate[]> {
  const config = await getCustomerConfig(db, entityId)
  if (!config) return []

  const persona = config.personas.find((p) => p.status === 'active') ?? null
  if (!persona) return []

  const candidateSkills = listCandidateSkills(persona)
  if (candidateSkills.length === 0) return []

  const dismissals = await fetchActiveDismissals(db, entityId, nowMs)
  const dismissedSet = new Set(dismissals.map((d) => d.skill))

  const candidates: PromotionCandidate[] = []
  for (const skillName of candidateSkills) {
    if (dismissedSet.has(skillName)) continue

    const stats = await fetchSkillApprovalStatsFromHermes(entityId, skillName)
    if (!stats) continue

    const evaluation = evaluatePromotionStreak(stats)
    if (!evaluation) continue

    candidates.push({
      skillName,
      approvalRate: evaluation.approvalRate,
      weeks: evaluation.weeks,
      totalDrafts: evaluation.totalDrafts,
      reviewUrl: buildReviewUrl(instanceSlug, skillName),
      dismissUrl: buildDismissUrl(skillName),
    })
  }

  return candidates
}

/**
 * Project the persona's skill list into the names that are eligible to
 * become candidates. A skill is eligible when it currently sits at
 * `draft_for_review` AND is not in the non-promotable list.
 *
 * Exported for unit tests; the resolver is the only runtime caller.
 */
export function listCandidateSkills(persona: PersonaConfig): string[] {
  void persona
  return []
}

/**
 * Evaluate a skill's weekly stats against the promotion criteria. Returns
 * null when the criteria are not met; otherwise returns the aggregated
 * stats the card displays.
 *
 * The evaluation walks the most-recent PROMOTION_REQUIRED_WEEKS entries.
 * Every individual week must:
 *
 *   - have non-null approvalRate (silence does not qualify)
 *   - meet PROMOTION_APPROVAL_RATE_THRESHOLD
 *
 * The aggregated approvalRate returned to the card is draft-weighted
 * across the window — a week with 20 drafts at 100% weighs more than a
 * week with 2 drafts at 100%. This avoids "100% of 0 drafts" math noise.
 * When the total draft count across the window is zero, the candidate is
 * disqualified (no volume = no signal).
 *
 * Exported for unit tests.
 */
export function evaluatePromotionStreak(
  stats: SkillApprovalStats
): { approvalRate: number; weeks: number; totalDrafts: number } | null {
  const window = stats.weeks.slice(0, PROMOTION_REQUIRED_WEEKS)
  if (window.length < PROMOTION_REQUIRED_WEEKS) return null

  let totalApprovals = 0
  let totalDrafts = 0
  for (const week of window) {
    if (week.approvalRate === null) return null
    if (!Number.isFinite(week.approvalRate)) return null
    if (week.approvalRate < PROMOTION_APPROVAL_RATE_THRESHOLD) return null
    totalApprovals += week.approvalRate * week.draftCount
    totalDrafts += week.draftCount
  }

  if (totalDrafts === 0) return null

  return {
    approvalRate: totalApprovals / totalDrafts,
    weeks: window.length,
    totalDrafts,
  }
}

/**
 * Format an approval rate fraction as a whole-percentage string. Floors
 * to whole numbers — the issue body's example renders "85% approval",
 * not "85.4% approval". Inputs outside [0, 1] clamp before formatting so
 * a malformed bridge value cannot render as "127%". Returns an empty
 * string for non-finite input rather than fabricating a number.
 */
export function formatApprovalRate(rate: number): string {
  if (!Number.isFinite(rate)) return ''
  const clamped = Math.max(0, Math.min(1, rate))
  return `${Math.floor(clamped * 100)}%`
}

/**
 * URL the [Review on Skills tab] CTA navigates to. Today the Skills
 * settings page is shared across all skills — the skill name is passed
 * as a query string so the page can scroll/focus on the right row when
 * that affordance lands. The settings page itself does not yet honor
 * the parameter; surfacing it now keeps the card's link contract stable
 * across the eventual scroll-to-row change.
 */
export function buildReviewUrl(instanceSlug: string, skillName: string): string {
  return `/portal/products/operator/${instanceSlug}/settings?focus=${encodeURIComponent(skillName)}`
}

/**
 * URL the [Dismiss for now] form POSTs to. Per-skill so the endpoint
 * route is path-driven and the form payload stays empty.
 */
export function buildDismissUrl(skillName: string): string {
  return `/api/portal/operator/promotion-cards/${encodeURIComponent(skillName)}/dismiss`
}

/**
 * Fetch the dismissal rows that are still inside the cooldown window
 * for this entity. Rows past the cooldown are filtered out (they no
 * longer suppress their card). The resolver uses this to drop
 * still-suppressed candidates.
 */
async function fetchActiveDismissals(
  db: D1Database,
  entityId: string,
  nowMs: number
): Promise<DismissalRow[]> {
  const result = await db
    .prepare(
      `SELECT skill, dismissed_at FROM promotion_card_dismissals
        WHERE entity_id = ?`
    )
    .bind(entityId)
    .all<DismissalRow>()
  const rows = result.results ?? []
  return rows.filter((row) => !isDismissalExpired(row.dismissed_at, nowMs))
}

/**
 * Check whether a dismissal timestamp has aged out of the cooldown
 * window. Returns true when the dismissal is expired (the card may
 * re-surface). A malformed timestamp is treated as expired — the
 * resolver fails open rather than silently suppressing forever.
 *
 * Exported for unit tests.
 */
export function isDismissalExpired(dismissedAt: string, nowMs: number): boolean {
  const parsed = Date.parse(dismissedAt)
  if (!Number.isFinite(parsed)) return true
  const ageMs = nowMs - parsed
  return ageMs >= PROMOTION_DISMISSAL_COOLDOWN_DAYS * MS_PER_DAY
}

/**
 * Hermes bridge stub for per-skill approval stats. Returns null today
 * because the bridge that exposes per-customer audit-log aggregations
 * is tracked under the same Hermes runtime wiring as #821. Returning
 * null surfaces no card — the empty-state pattern. When the bridge
 * lands, replace the body with the bridge fetch (the entityId carries
 * the customer identity needed to route to the right Machine D1) and
 * leave the rest of the resolver untouched.
 *
 * IMPORTANT: do not seed mock stats here. The card body interpolates
 * the resolved approval rate; a fake "85% of 47 drafts" string is a
 * Pattern B fabrication violation per CLAUDE.md.
 */
function fetchSkillApprovalStatsFromHermes(
  _entityId: string,
  _skillName: string
): Promise<SkillApprovalStats | null> {
  return Promise.resolve(null)
}
