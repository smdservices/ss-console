/**
 * Operator console transactional emails. Separate module (templates.ts sits
 * near its 500-line ceiling); composes the same shared portal shell helpers
 * so the emails render identically.
 */

import { actionButton, detailPanel, escapeEmailHtml, paragraph, portalDocument } from './templates'

export interface ChangeRequestNotificationInput {
  entityName: string
  customerSlug: string
  domainLabel: string
  requestedByEmail: string
  summary: string
  adminInboxUrl: string
}

/**
 * Operational alert to team@ when a client files an operator change request.
 * Without it the request sits silently in `operator_change_requests` until
 * someone happens to open the admin inbox (Captain finding, 2026-07-15: a
 * request filed 06-23 went unnoticed for three weeks).
 */
export function operatorChangeRequestNotificationEmailHtml(
  input: ChangeRequestNotificationInput
): string {
  return portalDocument(
    [
      paragraph('An operator change request was filed from the client portal.', '0 0 8px'),
      detailPanel('Client', escapeEmailHtml(input.entityName)),
      detailPanel('Operator', escapeEmailHtml(input.customerSlug)),
      detailPanel('Domain', escapeEmailHtml(input.domainLabel)),
      detailPanel('Filed by', escapeEmailHtml(input.requestedByEmail)),
      detailPanel('Request', escapeEmailHtml(input.summary)),
      actionButton(input.adminInboxUrl, 'Open the Request Inbox'),
    ].join('\n')
  )
}
