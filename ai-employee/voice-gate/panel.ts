/**
 * Voice-gate reviewer-panel session management.
 *
 * The panel layer:
 *
 *   1. Loads drafts (customer-authored + agent-drafted) for a chosen
 *      cohort or all cohorts.
 *   2. Shuffles them deterministically (seeded so re-runs are
 *      reproducible) and strips the authorship label before
 *      presentation.
 *   3. Holds a session that the dashboard form (out of scope this PR;
 *      see voice-gate-fallback.md §Implementation notes) populates with
 *      judge identifications.
 *   4. Hands the completed session to scoring.
 *
 * The shuffle is deterministic to support reproducibility — Captain
 * re-runs the same sample set against a different judge panel and the
 * presentation order is stable per run_id. Use a different run_id to
 * get a fresh shuffle.
 *
 * No I/O. Loading drafts from the per-customer R2/D1 backed voice-sample
 * store is documented as a future integration point in README; for now
 * the caller passes drafts in.
 */

import { missingRequiredCohorts } from './scoring.js'
import type { BlindTestDraft, BlindTestRun, JudgeIdentification, RecipientCohort } from './types.js'

/**
 * Input shape for creating a blind-test session.
 */
export interface CreatePanelSessionInput {
  /** Customer slug — namespaces the session, written to the run row. */
  customer_slug: string
  /** Cohort to scope this session to, or 'all' to mix. */
  cohort: RecipientCohort | 'all'
  /** ULID for the run; the panel uses it as the shuffle seed. */
  run_id: string
  /** Drafts to present. Must include both customer + agent items. */
  drafts: BlindTestDraft[]
  /** Judge IDs invited to this panel. */
  panel: string[]
  /** Cycle count for this run. 0 = first attempt. */
  cycle_count: number
  /** ISO 8601 UTC timestamp; defaults to now. */
  started_at?: string
}

/**
 * Minimum drafts required per voice-gate-fallback.md §Contract: 10
 * reviewer-written + 10 agent-drafted per blind test. The harness
 * accepts smaller sample sets for the synthetic fixture path (where
 * fixtures-per-cohort are smaller by design — three per cohort —
 * because the harness is verifying the scaffolding, not the calibration
 * itself) but warns the caller. Real customer runs invoked from the
 * CLI must meet the production minimum, enforced by the CLI wrapper.
 */
export const PRODUCTION_MIN_DRAFTS_PER_AUTHORSHIP = 10

/**
 * Minimum judges per voice-gate-fallback.md §Contract: 3 people who know
 * the reviewer well. Same caveat as above — synthetic fixture runs can
 * use smaller panels; the CLI enforces production minimum.
 */
export const PRODUCTION_MIN_JUDGES = 3

/**
 * Validate input to `createPanelSession`. Returns an array of human-
 * readable problems; empty array means valid. The CLI wraps this and
 * exits non-zero on any problem.
 */
export function validatePanelInput(
  input: CreatePanelSessionInput,
  options: { enforceProductionMinimums?: boolean } = {}
): string[] {
  return [
    ...validateRequiredFields(input),
    ...validateAuthorshipMix(input),
    ...validateCohortConsistency(input),
    ...validateProductionMinimums(input, options.enforceProductionMinimums ?? false),
    ...validateNoDuplicates(input),
  ]
}

function validateRequiredFields(input: CreatePanelSessionInput): string[] {
  const problems: string[] = []
  if (!input.customer_slug.trim()) problems.push('customer_slug is required')
  if (!input.run_id.trim()) problems.push('run_id is required')
  if (input.cycle_count < 0 || !Number.isInteger(input.cycle_count)) {
    problems.push('cycle_count must be a non-negative integer')
  }
  if (input.drafts.length === 0) problems.push('at least one draft required')
  return problems
}

function validateAuthorshipMix(input: CreatePanelSessionInput): string[] {
  const problems: string[] = []
  const { customerCount, agentCount } = countAuthorships(input.drafts)
  if (customerCount === 0) problems.push('no customer-authored drafts provided')
  if (agentCount === 0) problems.push('no agent-drafted drafts provided')
  return problems
}

function validateCohortConsistency(input: CreatePanelSessionInput): string[] {
  if (input.cohort !== 'all') {
    const offCohort = input.drafts.filter((d) => d.cohort !== input.cohort)
    if (offCohort.length > 0) {
      return [`cohort-scoped session received ${offCohort.length} drafts from other cohorts`]
    }
    return []
  }
  const seenCohorts = new Set(input.drafts.map((d) => d.cohort))
  const missing = missingRequiredCohorts(seenCohorts)
  if (missing.length > 0) {
    return [`'all' cohort run missing drafts for: ${missing.join(', ')}`]
  }
  return []
}

function validateProductionMinimums(input: CreatePanelSessionInput, enforce: boolean): string[] {
  if (!enforce) return []
  const problems: string[] = []
  const { customerCount, agentCount } = countAuthorships(input.drafts)
  if (customerCount < PRODUCTION_MIN_DRAFTS_PER_AUTHORSHIP) {
    problems.push(
      `customer-authored drafts: ${customerCount} (need ${PRODUCTION_MIN_DRAFTS_PER_AUTHORSHIP})`
    )
  }
  if (agentCount < PRODUCTION_MIN_DRAFTS_PER_AUTHORSHIP) {
    problems.push(
      `agent-drafted drafts: ${agentCount} (need ${PRODUCTION_MIN_DRAFTS_PER_AUTHORSHIP})`
    )
  }
  if (input.panel.length < PRODUCTION_MIN_JUDGES) {
    problems.push(`judges: ${input.panel.length} (need ${PRODUCTION_MIN_JUDGES})`)
  }
  return problems
}

function validateNoDuplicates(input: CreatePanelSessionInput): string[] {
  const problems: string[] = []
  const duplicateIds = duplicateDraftIds(input.drafts)
  if (duplicateIds.length > 0) {
    problems.push(`duplicate draft IDs: ${duplicateIds.join(', ')}`)
  }
  const duplicateJudges = duplicateJudgeIds(input.panel)
  if (duplicateJudges.length > 0) {
    problems.push(`duplicate judge IDs: ${duplicateJudges.join(', ')}`)
  }
  return problems
}

function countAuthorships(drafts: BlindTestDraft[]): {
  customerCount: number
  agentCount: number
} {
  let customerCount = 0
  let agentCount = 0
  for (const d of drafts) {
    if (d.authorship === 'customer') customerCount++
    else if (d.authorship === 'agent') agentCount++
  }
  return { customerCount, agentCount }
}

function duplicateDraftIds(drafts: BlindTestDraft[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const d of drafts) {
    if (seen.has(d.id)) dupes.add(d.id)
    seen.add(d.id)
  }
  return [...dupes]
}

function duplicateJudgeIds(panel: string[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const id of panel) {
    if (seen.has(id)) dupes.add(id)
    seen.add(id)
  }
  return [...dupes]
}

/**
 * Deterministic Fisher-Yates shuffle seeded by a string. Uses a simple
 * xorshift-derived seed mixer so the same run_id always produces the
 * same presentation order. NOT cryptographically secure — the goal is
 * reproducibility, not unguessable order. Judges never see the seed.
 */
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  const rng = () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    h >>>= 0
    return h / 0x100000000
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]] as [T, T]
  }
  return out
}

/**
 * Shape a draft for presentation to a judge — strips the authorship
 * label so the label cannot leak through to a frontend that
 * re-serializes the response.
 */
export interface PresentedDraft {
  id: string
  cohort: RecipientCohort
  body: string
  subject?: string
  scenario?: string
}

export function presentDraft(d: BlindTestDraft): PresentedDraft {
  const presented: PresentedDraft = {
    id: d.id,
    cohort: d.cohort,
    body: d.body,
  }
  if (d.metadata?.includeInPresentation) {
    if (d.metadata.subject !== undefined) presented.subject = d.metadata.subject
    if (d.metadata.scenario !== undefined) presented.scenario = d.metadata.scenario
  }
  return presented
}

/**
 * Active panel session. Held by the CLI runner (or the dashboard form
 * when wired in a future workstream) between draft presentation and
 * judge submission.
 *
 * The session is immutable after construction except via
 * `recordIdentification`, which appends to the identifications list.
 * Idempotency is handled by `(judge_id, draft_id)` pair: a second
 * identification for the same pair overwrites the first.
 */
export class PanelSession {
  readonly run: BlindTestRun
  private readonly presented: PresentedDraft[]

  constructor(input: CreatePanelSessionInput) {
    const problems = validatePanelInput(input)
    if (problems.length > 0) {
      throw new Error(`invalid panel input: ${problems.join('; ')}`)
    }
    const shuffled = seededShuffle(input.drafts, input.run_id)
    this.run = {
      run_id: input.run_id,
      customer_slug: input.customer_slug,
      cohort: input.cohort,
      started_at: input.started_at ?? new Date().toISOString(),
      scored_at: null,
      drafts: input.drafts,
      panel: [...input.panel],
      identifications: [],
      cycle_count: input.cycle_count,
    }
    this.presented = shuffled.map(presentDraft)
  }

  /**
   * Drafts in randomized presentation order, authorship stripped.
   */
  presentationOrder(): PresentedDraft[] {
    return [...this.presented]
  }

  /**
   * Record (or replace) a judge's identification for one draft.
   * Returns `true` if it was a new identification, `false` if it
   * replaced an earlier one.
   */
  recordIdentification(j: JudgeIdentification): boolean {
    if (!this.run.panel.includes(j.judge_id)) {
      throw new Error(`judge ${j.judge_id} not on this panel (${this.run.panel.join(', ')})`)
    }
    if (!this.run.drafts.some((d) => d.id === j.draft_id)) {
      throw new Error(`draft ${j.draft_id} not in this session`)
    }
    const existingIdx = this.run.identifications.findIndex(
      (e) => e.judge_id === j.judge_id && e.draft_id === j.draft_id
    )
    if (existingIdx >= 0) {
      this.run.identifications[existingIdx] = j
      return false
    }
    this.run.identifications.push(j)
    return true
  }

  /**
   * Whether every judge has identified every draft. The CLI uses this
   * to know when to seal the run and hand it to scoring.
   */
  isComplete(): boolean {
    const total = this.run.drafts.length * this.run.panel.length
    return this.run.identifications.length === total
  }

  /**
   * Mark the run as scored and freeze the run record. Idempotent —
   * subsequent calls update the timestamp.
   */
  seal(scored_at?: string): BlindTestRun {
    this.run.scored_at = scored_at ?? new Date().toISOString()
    return this.run
  }
}
