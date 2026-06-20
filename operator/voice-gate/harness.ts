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
   * per voice-gate-fallback.md §Contract.
   *
   * Defaults to TRUE — fail safe. The voice gate decides whether the
   * agent may send under a firm's name; a caller that forgets this flag
   * must get enforcement, not a free pass (issue #1124). Synthetic /
   * fixture callers that deliberately use small sample sets MUST opt out
   * explicitly by passing `false` (the CLI exposes this as
   * `--allow-undersized`, honored for synthetic mode only).
   */
  enforceProductionMinimums?: boolean
}

/**
 * One-shot orchestration: build the session, replay all identifications,
 * seal the run, score it. Returns the run + result so the caller can
 * persist both.
 *
 * Fails closed on an INCOMPLETE run — every judge must have identified
 * every draft before scoring. Size validation (`enforceProductionMinimums`)
 * checks draft/judge *counts*; it does not check *coverage*. Without this
 * gate a run that clears the size minimums but submits a partial batch of
 * identifications would still score, and because the indistinguishability
 * denominator is only the agent judgments actually submitted (see
 * `scoreForDraftSubset`), a partial batch can inflate to a false PASS on a
 * fraction of the data. Since this gate decides whether the agent may send
 * under a firm's name, an incomplete run is a hard error, not a free pass.
 * Completeness is orthogonal to sample size, so it is enforced
 * unconditionally — `--allow-undersized` does not relax it.
 */
export function runVoiceGate(input: RunVoiceGateInput): {
  run: BlindTestRun
  result: GateResult
} {
  const problems = validatePanelInput(input, {
    enforceProductionMinimums: input.enforceProductionMinimums ?? true,
  })
  if (problems.length > 0) {
    throw new Error(`voice-gate validation failed: ${problems.join('; ')}`)
  }
  const session = new PanelSession(input)
  for (const id of input.identifications) {
    session.recordIdentification(id)
  }
  if (!session.isComplete()) {
    const expected = session.run.drafts.length * session.run.panel.length
    const got = session.run.identifications.length
    throw new Error(
      `voice-gate incomplete run: ${got}/${expected} (judge, draft) identifications recorded; ` +
        `every judge must identify every draft before scoring (fail-closed)`
    )
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
