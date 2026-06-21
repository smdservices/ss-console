/**
 * Onboarding read path (client-portal §6). The guided "how a client gets a
 * working operator" path, derived from real state — never a fabricated
 * checklist.
 *
 * Two steps:
 *   1. Invite & roles   → the Team surface (people_access)
 *   2. Connect systems  → the Connections surface
 *
 * (Calibration was removed per ADR 0050 — it is an off-portal onboarding/
 * delivery activity, not a shipped client portal surface.)
 *
 * Each step's status is computed from the same readers the destination surfaces
 * use, so the hub never disagrees with the surface it links to. Honesty is the
 * rule: a step with no real signal is "not started," not a fabricated
 * completion.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { getCustomerConfig } from '../customer-config'
import { loadTeamRoster } from './team-read'
import { buildConnectionRows } from './connections'

export type StepStatus = 'done' | 'not_started'

export type OnboardingStepKey = 'invite' | 'connect'

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

/** The real signals the two steps derive from — keeps derivation pure. */
export interface OnboardingSignals {
  memberCount: number
  connectedCount: number
  totalConnectors: number
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

  return deriveOnboardingState({
    memberCount: roster.members.length,
    connectedCount: connectors.filter((c) => c.health === 'ok').length,
    totalConnectors: connectors.length,
  })
}

/** Pure step derivation from the resolved signals. Honest: no signal → not started. */
export function deriveOnboardingState(signals: OnboardingSignals): OnboardingState {
  const { memberCount, connectedCount, totalConnectors } = signals
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
  ]

  return { steps, doneCount: steps.filter((s) => s.status === 'done').length, total: steps.length }
}
