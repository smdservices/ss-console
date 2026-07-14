/**
 * Payments capability — payment-request drafts, transaction lookup,
 * payment-status monitoring.
 *
 * READ-ONLY for transaction data and trust-account state. Writes are
 * limited to DRAFT payment requests.
 * The agent does not initiate trust transfers or move money under any
 * configuration. Invariant #3 (no commitment execution) governs.
 *
 * Implemented by adapters for LawPay, Stripe (where applicable),
 * QuickBooks Payments, and other vendor-specific payment processors.
 */

import type { AdapterBase, DateRange } from './types'

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export type TransactionType =
  'payment' | 'refund' | 'chargeback' | 'trust_deposit' | 'trust_disbursement' | 'transfer'

export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed' | 'disputed'

export interface Transaction {
  id: string
  type: TransactionType
  status: TransactionStatus
  /** Amount in minor units (cents). Negative for refunds and reversals. */
  amount_cents: number
  currency: string
  /** Description as the source platform records it. */
  description: string | null
  /** When the transaction posted. */
  posted_at: string
  /** Matter the transaction relates to, when known. */
  matter_ref: string | null
  /** Payer information when known. May be a contact, an opposing party,
   * or a court. */
  payer_name: string | null
}

export interface TransactionQuery {
  matter_ref?: string
  type?: TransactionType
  status?: TransactionStatus
  date_range?: DateRange
  /** Minimum amount in minor units. */
  min_amount_cents?: number
  limit?: number
  cursor?: string
}

// ---------------------------------------------------------------------------
// Payment requests — drafts only
// ---------------------------------------------------------------------------

export interface PaymentRequestDraftInput {
  /** The reviewer who will send the request. */
  reviewer_account_id: string
  /** Who to bill. Email is the canonical channel; adapters may also
   * accept a contact reference. */
  recipient_email: string
  recipient_name?: string
  amount_cents: number
  currency: string
  description: string
  /** Matter correlation. */
  matter_ref?: string | null
  /** Optional due date (ISO 8601). */
  due_at?: string
  drafted_by_skill: string
}

export interface PaymentRequestDraftRef {
  id: string
  status: 'pending_review' | 'ready_for_send'
  created_at: string
  /** Where in the source platform the reviewer finds the draft. */
  reviewer_ui_hint: string | null
}

// ---------------------------------------------------------------------------
// Trust-account balance (read-only)
// ---------------------------------------------------------------------------

export interface TrustAccountBalance {
  matter_ref: string
  /** Current trust balance in minor units. */
  balance_cents: number
  currency: string
  /** When the balance was last updated by the underlying system. */
  as_of: string
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface Payments extends AdapterBase {
  // Read
  list_transactions(query: TransactionQuery): Promise<Transaction[]>
  get_transaction(transaction_id: string): Promise<Transaction | null>

  /** Trust-account balance by matter. Returns null when the matter has
   * no trust balance (vs. zero balance, which returns a row with
   * balance_cents=0). */
  get_trust_balance(matter_ref: string): Promise<TrustAccountBalance | null>

  /**
   * Create a draft payment request. Per ADR 0005 the reviewer sends the
   * request from the source platform's native UI; the agent never
   * initiates a payment request directly. Per invariant #3, no
   * autonomous trust transfers — adapters MUST NOT expose any method
   * that moves money in or out of a trust account.
   */
  create_payment_request_draft(input: PaymentRequestDraftInput): Promise<PaymentRequestDraftRef>

  // NO send_payment_request, NO initiate_transfer, NO trust_disbursement.
  // The conformance harness asserts these methods are absent.
}
