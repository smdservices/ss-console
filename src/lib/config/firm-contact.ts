/**
 * Firm-level contact info for the SMD Services client portal.
 *
 * Captain decision 2026-05-26: contact icons in the portal header MUST
 * appear on every surface, in every state, with no exceptions. The header
 * sources these constants directly — it never depends on per-page data
 * being threaded through props (the prior arrangement let multiple
 * surfaces ship with no contact channel).
 *
 * Practitioner-firm model: Scott IS the firm. The phone and email below
 * are the firm's published contact channels, not per-engagement consultant
 * data. Update here when the published channels change.
 */

export const FIRM_CONTACT = {
  phone: '+16029995967',
  email: 'team@smd.services',
} as const
