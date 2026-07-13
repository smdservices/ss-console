/**
 * Operator SCOPE facet — the shared boundaries view model (ADR 0069; signed-off
 * brief docs/design/operator/surface-briefs/operator-scope.md; first Boundaries
 * chapter per ADR 0076).
 *
 * Answers "what are the limits?" from the `scope_json` projection, grouped as
 * three client-legible questions:
 *   - what it can see        — email_folders_visible / email_folders_blind
 *   - who it responds to     — inbound_allow_from, the ADR 0055 organization
 *                              roster (addresses and @domains). The single most
 *                              consequential scope fact; previously rendered
 *                              nowhere (Configure's Scope card drops it). An
 *                              EMPTY roster is the fail-closed safety posture —
 *                              the operator drafts but never responds on its
 *                              own — and the viewer says so plainly, never as
 *                              an error.
 *   - what's off limits      — the three block lists, separately labeled
 *                              (Configure mashes them into one line, losing
 *                              which kind each is). matter_blocks is vertical
 *                              vocabulary and renders only when non-empty.
 *
 * Deliberately NOT surfaced (brief §5): the external-send ceiling (Governance
 * facet, Lock 4), business hours (Schedule facet), and the unvalidated
 * `trusted_sender_domains` yaml key (never reaches the projection).
 *
 * Pure and total: a null config or missing scope blob yields `scope: null` and
 * the viewer renders the honest empty state (docs/style/empty-state-pattern.md).
 */

import type { CustomerConfigRow } from '../../../customer-config'
import { parseScope } from '../../configure'

export interface OperatorScopeModel {
  /** null when the projection carries no scope blob — page-level empty state. */
  scope: {
    /** Folders the operator can read (email_folders_visible). */
    sees: string[]
    /** Folders deliberately kept out of view (email_folders_blind). */
    neverSees: string[]
    /** The ADR 0055 roster: who gets real replies and action (inbound_allow_from). */
    respondsTo: string[]
    /** email_keyword_blocks — topics it must not touch. */
    blockedTopics: string[]
    /** domain_blocks — senders and domains it must not engage. */
    blockedSenders: string[]
    /**
     * matter_blocks — specific client work the operator must not touch. The
     * client-facing label is the vertical-neutral "Blocked work" (ADR 0052 §6
     * bans law vocabulary on client operator surfaces); the authored VALUES
     * are the client's own object names and render as authored. Render only
     * when non-empty, so a seat whose vertical never authors this sees no
     * empty law-shaped row.
     */
    blockedWork: string[]
  } | null
}

/**
 * Compose the Scope view model from the config projection. `config.scope` is
 * the raw projected blob; `parseScope` (the same reader Configure uses) narrows
 * it, so the two surfaces can never disagree about what the data says.
 */
export function resolveOperatorScope(config: CustomerConfigRow | null): OperatorScopeModel {
  const scope = config ? parseScope(config.scope) : null
  if (scope === null) return { scope: null }
  return {
    scope: {
      sees: scope.email_folders_visible,
      neverSees: scope.email_folders_blind,
      respondsTo: scope.inbound_allow_from,
      blockedTopics: scope.email_keyword_blocks,
      blockedSenders: scope.domain_blocks,
      blockedWork: scope.matter_blocks,
    },
  }
}
