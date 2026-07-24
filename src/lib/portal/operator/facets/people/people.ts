/**
 * Operator PEOPLE facet — chapter 4 of the console (console blueprint §5;
 * originally composed in 04-console-structure.md §3.4). Everyone the operator
 * interacts with, and on what terms:
 *
 *   - who it responds to      — the ADR 0055 inbound roster
 *   - who it writes to        — the ADR 0075 outbound roster (standing,
 *                               human-authored recipients with class labels)
 *   - who it escalates to     — escalation recipients from the projection
 *   - what it must never touch — the block lists (blocked work renders only
 *                               when authored; all-empty renders one plain
 *                               sentence in the viewer)
 *
 * "Who is on the account" (team members) needs a DB read (loadTeamRoster) and
 * is passed to the viewer by the page, not composed here — this resolver stays
 * pure over the config projection. The roster/blocks halves REUSE the scope
 * resolver (the same reader the retired Scope page used), so the People
 * chapter can never disagree with what scope_json says.
 */

import type { CustomerConfigRow } from '../../../customer-config'
import { parseEscalation, type EscalationView } from '../../account-read'
import { resolveOperatorScope, type OutboundRosterView } from '../scope/scope'

export interface OperatorPeopleModel {
  /** null when the projection carries no scope blob — page-level empty state. */
  people: {
    respondsTo: string[]
    writesTo: OutboundRosterView[]
    escalation: EscalationView
    blockedTopics: string[]
    blockedSenders: string[]
    blockedWork: string[]
  } | null
}

export function resolveOperatorPeople(config: CustomerConfigRow | null): OperatorPeopleModel {
  const scope = resolveOperatorScope(config).scope
  if (scope === null) return { people: null }
  return {
    people: {
      respondsTo: scope.respondsTo,
      writesTo: scope.writesTo,
      escalation: parseEscalation(config?.escalation),
      blockedTopics: scope.blockedTopics,
      blockedSenders: scope.blockedSenders,
      blockedWork: scope.blockedWork,
    },
  }
}
