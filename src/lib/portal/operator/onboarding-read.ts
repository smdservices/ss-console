/**
 * Onboarding & calibration read path (client-portal §6). The guided "how a
 * client gets a working operator" path, derived from real state — never a
 * fabricated checklist.
 *
 * Three steps (§6):
 *   1. Invite & roles   → the Team surface (people_access)
 *   2. Connect systems  → the Connections surface (§5.8)
 *   3. Calibrate        → the Calibration surface (principal-led tuning)
 *
 * Each step's status is computed from the same readers the destination surfaces
 * use, so the hub never disagrees with the surface it links to. Honesty is the
 * rule: a step with no real signal is "not started," not a fabricated
 * completion — calibration in particular reads as "not started" until a cycle
 * exists (its runtime wiring lands with #821), exactly as §6 requires.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { getCustomerConfig, getActivePersona } from '../customer-config'
import { loadTeamRoster } from './team-read'
import { buildConnectionRows } from './connections'
import { getActiveCalibrationCycle } from './calibration'

export type StepStatus = 'done' | 'not_started'

export type OnboardingStepKey = 'invite' | 'connect' | 'calibrate'

export interface OnboardingStep {
  key: OnboardingStepKey
  title: string
  description: string
  href: string
  status: StepStatus
  /** Honest one-line current-state detail. */
  detail: string
}

export interface OnboardingState {
  steps: OnboardingStep[]
  doneCount: number
  total: number
}

/** The real signals the three steps derive from — keeps derivation pure. */
export interface OnboardingSignals {
  memberCount: number
  connectedCount: number
  totalConnectors: number
  cycleStarted: boolean
}

const OPERATOR_ROOT = '/portal/products/operator'

export async function loadOnboardingState(
  db: D1Database,
  entityId: string,
  orgId: string
): Promise<OnboardingState> {
  const config = await getCustomerConfig(db, entityId)
  const roster = await loadTeamRoster(db, entityId, orgId)
  const connectors = buildConnectionRows(
    config?.connectors,
    config?.credential_custody_default ?? 'delegated'
  )
  const persona = await getActivePersona(db, entityId)
  const cycle = await getActiveCalibrationCycle(db, entityId, persona)

  return deriveOnboardingState({
    memberCount: roster.members.length,
    connectedCount: connectors.filter((c) => c.health === 'ok').length,
    totalConnectors: connectors.length,
    cycleStarted: cycle !== null && cycle.state !== 'not_started',
  })
}

/** Pure step derivation from the resolved signals. Honest: no signal → not started. */
export function deriveOnboardingState(signals: OnboardingSignals): OnboardingState {
  const { memberCount, connectedCount, totalConnectors, cycleStarted } = signals
  const steps: OnboardingStep[] = [
    {
      key: 'invite',
      title: 'Invite & roles',
      description: 'Add the people who will work with your operator, and set what each can do.',
      href: `${OPERATOR_ROOT}/team`,
      status: memberCount > 0 ? 'done' : 'not_started',
      detail:
        memberCount > 0
          ? `${memberCount} ${memberCount === 1 ? 'person' : 'people'} on the account`
          : 'No one on the account yet',
    },
    {
      key: 'connect',
      title: 'Connect systems',
      description: 'Connect the tools your operator works across, and choose how each is held.',
      href: `${OPERATOR_ROOT}/connections`,
      status: connectedCount > 0 ? 'done' : 'not_started',
      detail:
        totalConnectors === 0
          ? 'No systems configured yet'
          : `${connectedCount} of ${totalConnectors} connected`,
    },
    {
      key: 'calibrate',
      title: 'Calibrate',
      description:
        "Tune your operator's voice and confirm its behavior before it works externally.",
      href: `${OPERATOR_ROOT}/calibration`,
      status: cycleStarted ? 'done' : 'not_started',
      detail: cycleStarted ? 'Calibration underway' : 'Not started',
    },
  ]

  return { steps, doneCount: steps.filter((s) => s.status === 'done').length, total: steps.length }
}
