/**
 * Hosted Agent transactional emails (ADR 0067). Separate module (rather
 * than templates.ts) to respect that file's 500-line ceiling; composes the
 * same shared portal shell helpers so the emails render identically.
 */

import {
  actionButton,
  detailPanel,
  escapeEmailHtml,
  greeting,
  mutedParagraph,
  paragraph,
  portalDocument,
} from './templates'

/**
 * Sent to the buyer when their Hosted Agent checkout completes. Status
 * framing only: no timeline promises, no outreach promises (Pattern A
 * guards). The portal is the single place setup progresses.
 */
export function hostedAgentWelcomeEmailHtml(clientName: string, portalUrl: string): string {
  return portalDocument(
    [
      paragraph(greeting(clientName), '0 0 8px'),
      paragraph('Your Hosted Agent subscription is active. Setup is underway.', '0 0 8px'),
      paragraph(
        'Next step: complete the short setup questionnaire in your portal. It covers what to call your agent, what you want it working on, and which senders it should accept email from.'
      ),
      actionButton(portalUrl, 'Complete Setup'),
      mutedParagraph(
        'Your portal shows setup status at every step. Questions any time: reply to this email.'
      ),
    ].join('\n')
  )
}

export interface HostedAgentOrderNotificationInput {
  entityName: string
  buyerEmail: string
  plan: 'founding' | 'standard'
  entityId: string
  adminQueueUrl: string
}

/** Operational alert to team@ when a Hosted Agent purchase lands. */
export function hostedAgentOrderNotificationEmailHtml(
  input: HostedAgentOrderNotificationInput
): string {
  return portalDocument(
    [
      paragraph('A Hosted Agent subscription was purchased.', '0 0 8px'),
      detailPanel('Customer', escapeEmailHtml(input.entityName)),
      detailPanel('Buyer email', escapeEmailHtml(input.buyerEmail)),
      detailPanel('Plan', input.plan === 'founding' ? 'Founding ($49/mo)' : 'Standard ($79/mo)'),
      detailPanel('Entity', escapeEmailHtml(input.entityId)),
      paragraph('The concierge work item is in the admin queue.'),
      actionButton(input.adminQueueUrl, 'Open the Queue'),
    ].join('\n')
  )
}

/**
 * Sent by the Captain's activate action when the agent goes live. Channel
 * details are authored per customer in the admin activate form, never
 * templated: this wrapper renders exactly what was authored.
 */
export function hostedAgentLiveEmailHtml(
  clientName: string,
  authoredChannelDetailsHtml: string,
  portalUrl: string
): string {
  return portalDocument(
    [
      paragraph(greeting(clientName), '0 0 8px'),
      paragraph('Your agent is live.', '0 0 8px'),
      paragraph(authoredChannelDetailsHtml),
      actionButton(portalUrl, 'Open Your Portal'),
      mutedParagraph('Your portal shows your agent status and settings.'),
    ].join('\n')
  )
}
