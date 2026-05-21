/**
 * Voice-gate harness — top-level orchestration.
 *
 * Composes panel + scoring into the one-call shape the CLI consumes.
 * Caller supplies drafts, panel, customer_slug, run_id, cycle_count
 * (typically from the per-customer Hermes D1 voice_samples + audit_log
 * tables; see d1-schema.md §1 and §8) and identifications (collected
 * either via the CLI prompt loop or a future dashboard form per
 * voice-gate-fallback.md §Implementation notes).
 *
 * The harness does not read or write state. Persistence happens in
 * downstream wiring (out of scope this PR — documented in README).
 */

import { PanelSession, validatePanelInput } from './panel.js'
import { buildAuditMetadata, scoreRun } from './scoring.js'
import type {
  BlindTestRun,
  GateResult,
  JudgeIdentification,
  VoiceGatePanelScoreRow,
} from './types.js'
import type { CreatePanelSessionInput } from './panel.js'

/**
 * Inputs to a one-shot blind-test run. Combines panel session
 * construction + identifications + sealing into a single call. Use this
 * when identifications are already collected (e.g. a dashboard form
 * submitted a complete batch). Use `PanelSession` directly when you
 * need to collect identifications interactively.
 */
export interface RunVoiceGateInput extends CreatePanelSessionInput {
  /** Complete set of identifications captured from the panel. */
  identifications: JudgeIdentification[]
  /**
   * Production mode enforces ≥10 drafts per authorship and ≥3 judges
   * per voice-gate-fallback.md §Contract. Default false to support
   * synthetic-fixture testing; CLI sets true for real customer runs.
   */
  enforceProductionMinimums?: boolean
}

/**
 * One-shot orchestration: build the session, replay all identifications,
 * seal the run, score it. Returns the run + result so the caller can
 * persist both.
 */
export function runVoiceGate(input: RunVoiceGateInput): {
  run: BlindTestRun
  result: GateResult
} {
  const problems = validatePanelInput(input, {
    enforceProductionMinimums: input.enforceProductionMinimums ?? false,
  })
  if (problems.length > 0) {
    throw new Error(`voice-gate validation failed: ${problems.join('; ')}`)
  }
  const session = new PanelSession(input)
  for (const id of input.identifications) {
    session.recordIdentification(id)
  }
  const run = session.seal()
  const result = scoreRun(run)
  return { run, result }
}

/**
 * Build the D1 panel-score row for the audit_log table. Pure shape
 * transformation; the D1 writer is downstream and lives in a separate
 * workstream (see README integration section).
 *
 * The row ID convention matches d1-schema.md §1 — ULID. The caller
 * supplies the ULID; this function does not generate one to keep the
 * harness side-effect-free.
 */
export function buildAuditRow(
  rowId: string,
  run: BlindTestRun,
  result: GateResult,
  ts?: string
): VoiceGatePanelScoreRow {
  return {
    id: rowId,
    ts: ts ?? new Date().toISOString(),
    action_type: result.audit_action,
    actor: 'captain',
    actor_role: 'captain',
    skill_name: null,
    matter_ref: null,
    input_digest: null,
    output_digest: null,
    diff_digest: null,
    trust_ceiling: null,
    metadata: buildAuditMetadata(run, result),
  }
}
