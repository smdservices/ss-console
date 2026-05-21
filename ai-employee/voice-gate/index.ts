/**
 * Voice-gate harness public surface.
 *
 * Stable re-exports for callers (CLI runner, future dashboard form,
 * future D1 writer). Anything not re-exported here is internal and may
 * change without a major version.
 */

export type {
  BlindTestDraft,
  BlindTestRun,
  CohortScore,
  DraftAuthorship,
  FailureRecord,
  GateAuditAction,
  GateResult,
  GateState,
  JudgeChoice,
  JudgeIdentification,
  NearPassRecord,
  RecipientCohort,
  VoiceGatePanelScoreRow,
} from './types.js'

export {
  RECIPIENT_COHORTS,
  VOICE_GATE_MAX_NEAR_PASS_CYCLES,
  VOICE_GATE_MIN_DAYS_BETWEEN_CYCLES,
  VOICE_GATE_NEAR_PASS_LOWER_PCT,
  VOICE_GATE_PASS_THRESHOLD_PCT,
  auditActionFor,
  buildAuditMetadata,
  scoreRun,
  stateForScore,
} from './scoring.js'

export {
  PRODUCTION_MIN_DRAFTS_PER_AUTHORSHIP,
  PRODUCTION_MIN_JUDGES,
  PanelSession,
  presentDraft,
  validatePanelInput,
} from './panel.js'
export type { CreatePanelSessionInput, PresentedDraft } from './panel.js'

export { buildAuditRow, runVoiceGate } from './harness.js'
export type { RunVoiceGateInput } from './harness.js'

export { loadFixtureSet } from './fixtures/loader.js'
export type { FixtureSet } from './fixtures/loader.js'
