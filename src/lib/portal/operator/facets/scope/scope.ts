/**
 * Operator SCOPE facet — the shared boundaries view model (ADR 0069; signed-off
 * brief docs/design/operator/surface-briefs/operator-scope.md; first Boundaries
 * chapter per ADR 0076).
 *
 * Answers "what are the limits?" from the `scope_json` projection, grouped as
 * four client-legible questions:
 *   - what it can see        — email_folders_visible / email_folders_blind
 *   - who it responds to     — inbound_allow_from, the ADR 0055 organization
 *                              roster (addresses and @domains). The single most
 *                              consequential scope fact; previously rendered
 *                              nowhere (Configure's Scope card drops it). An
 *                              EMPTY roster is the fail-closed safety posture —
 *                              the operator drafts but never responds on its
 *                              own — and the viewer says so plainly, never as
 *                              an error. This list is REPLY AUTHORITY only: it
 *                              no longer implies "firm staff" (ss#2263), so an
 *                              address can appear here AND under "who it writes
 *                              to" with a class — that is how a firm says "reply
 *                              to my client, and treat them as a client".
 *   - who sets its standards — admins (ADR 0085 §2), the Operator-admin allow
 *                              list. Distinct from the roster above: everyone
 *                              rostered gets answered, but only these people
 *                              may establish how the firm's work reads. Shown
 *                              read-only; the list is changed through a PR.
 *   - who it writes to       — outbound_roster (ADR 0075), the human-authored
 *                              standing outbound recipients with their class
 *                              rendered through the closed label map. Coverage
 *                              gap closed per the console blueprint §4 (the
 *                              resolver predated `outbound_roster`). Empty is
 *                              the honest default: no standing recipients are
 *                              configured.
 *   - what's off limits      — the three block lists, separately labeled
 *                              (Configure mashes them into one line, losing
 *                              which kind each is). matter_blocks is vertical
 *                              vocabulary and renders only when non-empty.
 *
 * Deliberately NOT surfaced (brief §5): the external-send ceiling (rendered on
 * The work as the authority view, Lock 4), business hours (Schedule facet), and
 * the unvalidated `trusted_sender_domains` yaml key (never reaches the
 * projection).
 *
 * Pure and total: a null config or missing scope blob yields `scope: null` and
 * the viewer renders the honest empty state (docs/style/empty-state-pattern.md).
 */

import type { CustomerConfigRow } from '../../../customer-config'
import type { OutboundRosterClass } from '../../../../operator/customer-yaml/types'
import { parseScope } from '../../configure'

/**
 * Closed plain-language labels for the outbound-roster class vocabulary
 * (OUTBOUND_ROSTER_CLASSES). Display-only; the authored class token never
 * reaches the page.
 */
const OUTBOUND_CLASS_LABEL: Record<OutboundRosterClass, string> = {
  client: 'Client',
  records_vendor: 'Records vendor',
  firm_staff: 'Firm staff',
}

/** One standing outbound recipient, rendered from the authored roster entry. */
export interface OutboundRosterView {
  /** The authored address or @domain grant, verbatim. */
  address: string
  /** Plain-language class label from the closed map. */
  classLabel: string
  /** The authored free-text note, or null. */
  note: string | null
}

export interface OperatorScopeModel {
  /** null when the projection carries no scope blob — page-level empty state. */
  scope: {
    /** Folders the operator can read (email_folders_visible). */
    sees: string[]
    /** Folders deliberately kept out of view (email_folders_blind). */
    neverSees: string[]
    /** The ADR 0055 roster: who gets real replies and action (inbound_allow_from). */
    respondsTo: string[]
    /**
     * The ADR 0085 §2 Operator-admin allow list (scope.admins): the people who
     * may set the firm's standards. Narrower than `respondsTo`, which is
     * everyone who gets answered. Read-only here by design — the list is
     * changed through a PR, never from the portal. Empty is the fail-closed
     * posture and the viewer says so plainly.
     */
    setsStandards: string[]
    /**
     * The ADR 0075 outbound roster: the standing recipients a person authored
     * for outbound work, each with its plain-language class. Empty means no
     * standing outside recipients are configured.
     */
    writesTo: OutboundRosterView[]
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
      setsStandards: scope.admins,
      writesTo: scope.outbound_roster.map((e) => ({
        address: e.address,
        classLabel: OUTBOUND_CLASS_LABEL[e.class],
        note: e.note ?? null,
      })),
      blockedTopics: scope.email_keyword_blocks,
      blockedSenders: scope.domain_blocks,
      blockedWork: scope.matter_blocks,
    },
  }
}
