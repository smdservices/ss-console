/**
 * Accounting capability — invoice drafts, AR query, expense-entry
 * drafts.
 *
 * READ access to ledger state. WRITE access is limited to DRAFT
 * invoices and DRAFT expense entries (per invariant #3 no commitment
 * execution). The agent does not post
 * to the general ledger; the reviewer reviews and posts.
 *
 * Implemented by adapters for QuickBooks Online, Xero, Wave,
 * vendor-specific firm-accounting systems (Cosmolex, Soluno).
 */

import type { AdapterBase, DateRange } from './types'

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void'

export interface InvoiceLineItem {
  description: string
  /** Quantity (hours for time-based billing; units for fixed-price). */
  quantity: number
  /** Unit price in minor units. */
  unit_price_cents: number
  /** Optional time-entry ref the line was generated from. */
  time_entry_ref?: string | null
}

export interface Invoice {
  id: string
  invoice_number: string
  status: InvoiceStatus
  /** Customer/matter the invoice bills. */
  matter_ref: string | null
  client_name: string
  issue_date: string
  due_date: string | null
  total_cents: number
  amount_paid_cents: number
  currency: string
  line_items: InvoiceLineItem[]
}

export interface InvoiceQuery {
  status?: InvoiceStatus
  matter_ref?: string
  client_name?: string
  date_range?: DateRange
  limit?: number
  cursor?: string
}

export interface CreateInvoiceDraftInput {
  client_name: string
  matter_ref?: string | null
  issue_date: string
  due_date?: string
  currency: string
  line_items: InvoiceLineItem[]
  /** Optional notes/terms shown on the invoice. */
  notes?: string
  drafted_by_skill: string
}

export interface InvoiceDraftRef {
  id: string
  invoice_number: string
  status: 'draft'
  created_at: string
  reviewer_ui_hint: string | null
}

// ---------------------------------------------------------------------------
// Accounts receivable
// ---------------------------------------------------------------------------

export interface AccountsReceivableEntry {
  matter_ref: string | null
  client_name: string
  /** Sum of outstanding invoice balances. */
  outstanding_cents: number
  currency: string
  /** Oldest outstanding invoice's issue date. */
  oldest_invoice_at: string | null
  /** Number of days the oldest invoice is overdue. Null when nothing
   * is overdue. */
  days_overdue: number | null
}

export interface AccountsReceivableQuery {
  /** Only return clients with at least this much outstanding. */
  min_outstanding_cents?: number
  /** Only return clients overdue by at least this many days. */
  min_days_overdue?: number
  limit?: number
  cursor?: string
}

// ---------------------------------------------------------------------------
// Expense entries — drafts only
// ---------------------------------------------------------------------------

export interface ExpenseEntryDraftInput {
  matter_ref: string | null
  date: string
  amount_cents: number
  currency: string
  category: string
  description: string
  /** Whether the expense is billable to the matter's client. */
  billable: boolean
  drafted_by_skill: string
}

export interface ExpenseEntryDraftRef {
  id: string
  status: 'draft'
  created_at: string
  reviewer_ui_hint: string | null
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface Accounting extends AdapterBase {
  // Read
  list_invoices(query: InvoiceQuery): Promise<Invoice[]>
  get_invoice(invoice_id: string): Promise<Invoice | null>

  list_accounts_receivable(query: AccountsReceivableQuery): Promise<AccountsReceivableEntry[]>

  // Drafts — reviewer posts to the GL
  create_invoice_draft(input: CreateInvoiceDraftInput): Promise<InvoiceDraftRef>
  create_expense_entry_draft(input: ExpenseEntryDraftInput): Promise<ExpenseEntryDraftRef>

  // NO post_invoice, NO post_expense_entry, NO post_to_general_ledger.
  // The reviewer posts from the source platform's native UI. The
  // conformance harness asserts no autonomous-post methods are added.
}
