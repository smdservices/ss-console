/**
 * Operator — calibration session workflow.
 *
 * Backs the portal surface at
 * `/portal/products/operator/calibration/*` and the runbook at
 * `docs/runbooks/operator-calibration.md`.
 *
 * Source: platform PRD §9.6 (voice quality gates) + law-firm PRD §11.9
 * (calibration session split). The business-analyst critique
 * collapsed the 4-6 hour Captain-led session into four 90-minute
 * sessions spaced over two weeks because the 4-6 hour single block
 * fails at firms that actually sign — partner calendars do not
 * support it.
 *
 * What this module does today vs later:
 *
 *   - Today: declares the four-session schema, the planning window,
 *     the closed vocabulary of session kinds + states, and projects
 *     a cycle from a customer config row. No D1 writes. The portal
 *     renders the cycle so a principal can see the structure and
 *     start a new cycle when they are ready.
 *
 *   - Later (issue #821, Hermes runtime scoping): the data-capture
 *     mechanics. Voice corrections flow into voice ingestion, rule
 *     additions flow into memory rules, approvals flow into
 *     trust-ceiling logging. The seams are named here so the
 *     downstream work has a stable contract; the actual D1 tables
 *     and writer wiring land under #821.
 *
 * No fabricated content. Per `docs/style/empty-state-pattern.md`,
 * the resolver returns null when no cycle has been authored — the
 * page renders the empty state with the explicit "Start new
 * calibration cycle" action rather than a placeholder cycle.
 */

import type { PersonaConfig } from '../customer-config'

// ---------------------------------------------------------------------------
// Session kinds — closed vocabulary
// ---------------------------------------------------------------------------

/**
 * The four 90-minute sessions that make up one calibration cycle, in
 * scheduling order. The vocabulary is closed because adding or
 * renaming a session changes the runbook contract on
 * `docs/runbooks/operator-calibration.md`. New session kinds
 * require a runbook revision.
 *
 *   voice_calibration       — session 1; surface the writing voice
 *                             across recipient cohorts. Partner edits
 *                             10-15 representative drafts. Corrections
 *                             feed the voice ingestion seam.
 *
 *   skill_calibration       — session 2; walk through each enabled
 *                             skill against real-shaped (synthetic at
 *                             demo, customer-data at production)
 *                             scenarios. Outcomes feed memory rules.
 *
 *   trust_ceiling           — session 3; refine the per-skill ceiling
 *                             based on how the first two sessions
 *                             went. Approvals feed trust-ceiling
 *                             logging.
 *
 *   integration_handoff     — session 4; live workflow at the
 *                             partner's keyboard. Final sign-off
 *                             before the blind-test gate fires.
 */
export type CalibrationSessionKind =
  | 'voice_calibration'
  | 'skill_calibration'
  | 'trust_ceiling'
  | 'integration_handoff'

export const CALIBRATION_SESSION_KINDS: readonly CalibrationSessionKind[] = [
  'voice_calibration',
  'skill_calibration',
  'trust_ceiling',
  'integration_handoff',
] as const

export function isCalibrationSessionKind(value: unknown): value is CalibrationSessionKind {
  return (
    typeof value === 'string' && (CALIBRATION_SESSION_KINDS as readonly string[]).includes(value)
  )
}

/**
 * Human label for a CalibrationSessionKind. Closed vocabulary; the
 * switch is exhaustive so a typo upstream surfaces at compile time.
 */
export function formatCalibrationSessionKind(kind: CalibrationSessionKind): string {
  switch (kind) {
    case 'voice_calibration':
      return 'Voice calibration'
    case 'skill_calibration':
      return 'Skill calibration'
    case 'trust_ceiling':
      return 'Trust-ceiling refinement'
    case 'integration_handoff':
      return 'Integration and handoff'
  }
}

/**
 * One-sentence description of what the session is for. Used on the
 * portal card and in the runbook section anchors. Closed vocabulary;
 * the descriptions are authored copy, not template strings.
 */
export function describeCalibrationSessionKind(kind: CalibrationSessionKind): string {
  switch (kind) {
    case 'voice_calibration':
      return 'Surface the writing voice across recipient cohorts. The partner edits 10-15 representative drafts.'
    case 'skill_calibration':
      return 'Walk through every enabled skill against representative scenarios. The partner approves, edits, or refuses each outcome.'
    case 'trust_ceiling':
      return 'Refine the per-skill ceiling based on the first two sessions. The principal sets the autonomy boundary.'
    case 'integration_handoff':
      return 'Live workflow at the partner keyboard. Final sign-off before the blind-test gate.'
  }
}

// ---------------------------------------------------------------------------
// Session state — closed vocabulary
// ---------------------------------------------------------------------------

/**
 * The lifecycle state of a single 90-minute session inside a cycle.
 * Forward-only by default; the portal does not support moving a
 * session backwards. A cancelled session may be re-scheduled by
 * starting a new cycle.
 *
 *   pending     — session is on the schedule; not yet conducted
 *   in_progress — Captain is conducting the session right now
 *   completed   — session has been conducted and its findings logged
 *   skipped     — session was intentionally not conducted (rare;
 *                 documented in the runbook recovery path)
 */
export type CalibrationSessionState = 'pending' | 'in_progress' | 'completed' | 'skipped'

export const CALIBRATION_SESSION_STATES: readonly CalibrationSessionState[] = [
  'pending',
  'in_progress',
  'completed',
  'skipped',
] as const

export function isCalibrationSessionState(value: unknown): value is CalibrationSessionState {
  return (
    typeof value === 'string' && (CALIBRATION_SESSION_STATES as readonly string[]).includes(value)
  )
}

export function formatCalibrationSessionState(state: CalibrationSessionState): string {
  switch (state) {
    case 'pending':
      return 'Scheduled'
    case 'in_progress':
      return 'In progress'
    case 'completed':
      return 'Completed'
    case 'skipped':
      return 'Skipped'
  }
}

// ---------------------------------------------------------------------------
// Cycle state — closed vocabulary
// ---------------------------------------------------------------------------

/**
 * The overall lifecycle state of a calibration cycle (a set of four
 * sessions). One cycle is active at a time. Starting a new cycle
 * archives the prior one.
 *
 *   not_started — no cycle has been started for this customer
 *   active      — a cycle is in progress; at least one session is
 *                 pending or in_progress
 *   completed   — all four sessions completed
 *   archived    — a newer cycle was started; this one is read-only
 */
export type CalibrationCycleState = 'not_started' | 'active' | 'completed' | 'archived'

export function formatCalibrationCycleState(state: CalibrationCycleState): string {
  switch (state) {
    case 'not_started':
      return 'Not started'
    case 'active':
      return 'In progress'
    case 'completed':
      return 'Completed'
    case 'archived':
      return 'Archived'
  }
}

// ---------------------------------------------------------------------------
// Cycle + session row shapes
// ---------------------------------------------------------------------------

/**
 * One row in the four-session schedule for a calibration cycle. The
 * ordering matches CALIBRATION_SESSION_KINDS so callers can render
 * the list without sorting.
 */
export interface CalibrationSessionRow {
  /** Position in the cycle, 1-indexed (1, 2, 3, 4). */
  position: 1 | 2 | 3 | 4
  /** Session kind; see CalibrationSessionKind for the vocabulary. */
  kind: CalibrationSessionKind
  /** Lifecycle state of this individual session. */
  state: CalibrationSessionState
  /** Display label. */
  label: string
  /** One-sentence description of the session's purpose. */
  description: string
}

/**
 * A complete calibration cycle as projected for the portal. Cycle
 * rows are derived, not authored — given the four session kinds and
 * a planning window, the cycle structure is deterministic. The state
 * of each session is what changes over time (and lives in D1 once
 * the data-capture mechanics land per #821).
 */
export interface CalibrationCycle {
  /** Cycle identifier; unique per (customer, cycle attempt). */
  id: string
  /** Active persona this cycle is calibrating. */
  personaSlug: string
  /** Overall lifecycle state. */
  state: CalibrationCycleState
  /** Four-session schedule, in CALIBRATION_SESSION_KINDS order. */
  sessions: CalibrationSessionRow[]
  /** Total length of the planning window, in days. */
  windowDays: number
}

// ---------------------------------------------------------------------------
// Framing constant — assistant, not replacement
// ---------------------------------------------------------------------------

/**
 * The required framing sentence per the issue acceptance criteria.
 * Composed at render time using the active persona name resolved
 * from `customer-config.getActivePersona()`. The sentence is
 * authored copy; the variable is the persona name, sourced from
 * customer.yaml. No fallback persona name is permitted — when no
 * active persona exists, the portal renders the empty state per
 * `docs/style/empty-state-pattern.md` and the framing line is
 * suppressed entirely.
 *
 * The shape is deliberately small. A longer template here invites
 * Pattern A drift (committed sentences that describe uncontracted
 * business behavior). The promise is bounded: assist, not replace.
 */
export function buildAssistantFraming(personaName: string): string {
  return `${personaName} assists the partner; ${personaName} never replaces them.`
}

// ---------------------------------------------------------------------------
// Window planning
// ---------------------------------------------------------------------------

/** Total length of a calibration cycle, per business-analyst recommendation. */
export const CALIBRATION_WINDOW_DAYS = 14

/** Length of each session in minutes, per business-analyst recommendation. */
export const CALIBRATION_SESSION_MINUTES = 90

/** Number of sessions per cycle. Closed vocabulary; do not loosen. */
export const CALIBRATION_SESSIONS_PER_CYCLE = 4

// ---------------------------------------------------------------------------
// Cycle resolver
// ---------------------------------------------------------------------------

/**
 * Build the default four-session structure for a cycle. Used both
 * when starting a new cycle and when projecting a session-stateless
 * cycle for the empty state.
 *
 * Every session starts as `pending`. The runbook governs which
 * Captain action moves a session through `in_progress -> completed`.
 */
export function buildDefaultSessionRows(): CalibrationSessionRow[] {
  return CALIBRATION_SESSION_KINDS.map((kind, idx) => {
    const position = (idx + 1) as 1 | 2 | 3 | 4
    const row: CalibrationSessionRow = {
      position,
      kind,
      state: 'pending',
      label: formatCalibrationSessionKind(kind),
      description: describeCalibrationSessionKind(kind),
    }
    return row
  })
}

/**
 * Resolve the calibration cycle for a customer. Returns null when
 * no cycle has been started — the page renders the empty state.
 *
 * Today this always returns null because the calibration_cycles
 * D1 table lands under issue #821 (Hermes runtime scoping). Once
 * the data-capture mechanics ship, this resolver reads the active
 * row from D1 and projects it into the CalibrationCycle shape.
 * The portal does not change when the resolver starts returning
 * non-null values; the empty-state branch falls away naturally.
 */
export function getActiveCalibrationCycle(
  _db: D1Database,
  _entityId: string,
  persona: PersonaConfig | null
): Promise<CalibrationCycle | null> {
  // No D1 reads today. When #821 lands the persona is the key into
  // the per-(customer, persona) row in `calibration_cycles`; this
  // function will gain an `await` then. The Promise return shape is
  // stable across the wiring change so callers do not move.
  void persona
  return Promise.resolve(null)
}
