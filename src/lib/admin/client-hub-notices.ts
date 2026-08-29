/**
 * Outcome notices for the client hub (`/admin/clients/[id]`).
 *
 * The hub's own POST routes (operator-price, subscription-billing, invoices)
 * redirect back with one query key each. Every value is mapped to a sentence
 * here; an unknown value renders its raw key so a new redirect is never
 * silently swallowed.
 */

const BILLING_NOTICES: Record<string, string> = {
  started: 'Monthly billing started. The subscription is live in the client portal.',
  paused: 'Billing paused.',
  resumed: 'Billing resumed.',
  cancelled: 'Billing cancelled.',
}

const ERROR_NOTICES: Record<string, string> = {
  no_authored_price: 'Author the monthly price before starting billing.',
  no_billing_contact:
    'Add a contact with an email address first. Stripe keys the customer by email.',
  billing_already_attached: 'Billing is already attached to this subscription.',
  no_subscription_row: 'No operator subscription row exists for this client.',
  no_billing_attached: 'Billing is not attached yet.',
  bad_billing_start: 'Billing start must be a calendar date that is today or later.',
  bad_billing_action: 'Unknown billing action.',
  billing_server: 'Billing request failed. Check the logs.',
  bad_price: 'Enter a whole-dollar monthly price.',
  invalid_type: 'Unknown invoice type.',
  invalid_amount: 'Enter an invoice amount greater than zero.',
  missing: 'The invoice form was incomplete.',
  missing_line_items: 'Author the line item before presenting or sending an invoice.',
  invalid_transition: 'That invoice action is not valid from its current status.',
  server: 'Request failed. Check the logs.',
}

export interface ClientHubNotices {
  success: string | null
  error: string | null
}

export function resolveClientHubNotices(params: URLSearchParams): ClientHubNotices {
  const billing = params.get('billing')
  const error = params.get('error')
  let success: string | null = null
  if (params.get('saved')) success = 'Invoice updated.'
  else if (params.get('priced')) success = 'Monthly price saved.'
  else if (billing) success = BILLING_NOTICES[billing] ?? billing
  return { success, error: error ? (ERROR_NOTICES[error] ?? error) : null }
}
