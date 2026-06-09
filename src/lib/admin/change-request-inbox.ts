/**
 * Change-request inbox view-model for the admin Operator console
 * (`/admin/operator/requests`) — design doc §4.4.
 *
 * The receiving end of the authority model: when a client in an SMD-operated
 * domain files a "request a change," it lands in `operator_change_requests` and
 * SMD actions or declines it here. The store reader/writer
 * (listOpenChangeRequests / updateChangeRequestStatus) is the frozen seam
 * (src/lib/portal/operator/change-request.ts); this module owns only the
 * admin-side action vocabulary and the pure display derivations.
 *
 * "This is what makes Managed real: the client asks, SMD does."
 */

import { relativeTimestamp } from './fleet-status'
import { AUTHORITY_DOMAIN_LABELS } from './operator-overview'
import type { ChangeRequestStatus } from '../portal/operator/change-request'
import type { SwitchableAuthorityDomain } from '../operator/authority'

/**
 * The actions SMD can take on a request from the inbox. Each maps to a target
 * status on the frozen updateChangeRequestStatus:
 *   - acknowledge → 'acknowledged' (receipt; stays in the inbox, not closed)
 *   - resolve     → 'resolved'     (terminal; SMD made the change)
 *   - decline     → 'declined'     (terminal; with a note)
 */
export const CHANGE_REQUEST_ACTIONS = ['acknowledge', 'resolve', 'decline'] as const
export type ChangeRequestAction = (typeof CHANGE_REQUEST_ACTIONS)[number]

const ACTION_TO_STATUS: Record<ChangeRequestAction, ChangeRequestStatus> = {
  acknowledge: 'acknowledged',
  resolve: 'resolved',
  decline: 'declined',
}

/** Validate an untrusted action string → the target status, or null. */
export function actionToStatus(action: string): ChangeRequestStatus | null {
  return (CHANGE_REQUEST_ACTIONS as readonly string[]).includes(action)
    ? ACTION_TO_STATUS[action as ChangeRequestAction]
    : null
}

/** Friendly label for a change-request domain (a switchable authority domain). */
export function changeRequestDomainLabel(domain: SwitchableAuthorityDomain): string {
  return AUTHORITY_DOMAIN_LABELS[domain]
}

export interface RequestStatusBadge {
  label: string
  classes: string
}

const STATUS_BADGE_STRUCTURE =
  'inline-flex items-center px-2 py-0.5 rounded-[var(--ss-radius-badge)] ' +
  'text-[10px] font-medium uppercase tracking-wide whitespace-nowrap'

/**
 * Badge for a request's status. Only open / acknowledged appear in the inbox
 * (the reader filters to those), but resolved / declined are mapped too so the
 * badge is total.
 */
export function requestStatusBadge(status: ChangeRequestStatus): RequestStatusBadge {
  switch (status) {
    case 'open':
      return {
        label: 'Open',
        classes: `${STATUS_BADGE_STRUCTURE} bg-[color:var(--ss-color-attention)] text-white`,
      }
    case 'acknowledged':
      return {
        label: 'Acknowledged',
        classes: `${STATUS_BADGE_STRUCTURE} bg-[color:var(--ss-color-primary)] text-white`,
      }
    case 'resolved':
      return {
        label: 'Resolved',
        classes: `${STATUS_BADGE_STRUCTURE} bg-[color:var(--ss-color-complete)] text-white`,
      }
    case 'declined':
      return {
        label: 'Declined',
        classes: `${STATUS_BADGE_STRUCTURE} bg-[color:var(--ss-color-border)] text-[color:var(--ss-color-text-secondary)]`,
      }
  }
}

export function requestAge(createdAt: string, now: Date = new Date()): string {
  return relativeTimestamp(createdAt, now)
}
