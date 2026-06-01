/**
 * CourtAccess capability — case law lookup, docket query, citation
 * extraction. READ-ONLY.
 *
 * This is a raw data retrieval layer. The citation-refusal filter
 * (invariant #6, Platform PRD §9 / Law-firm PRD §9) runs on ALL
 * outputs BEFORE surfacing to any skill or draft surface — including
 * any content retrieved via this interface. CourtAccess does not
 * filter; the runtime layer does.
 *
 * Phase-1 signatures adopted from the Tech Lead contribution.
 * Implemented by adapters for CourtListener, Westlaw (when licensed),
 * LexisNexis (when licensed), state-specific court PACER systems.
 */

import type { AdapterBase, DateRange } from './types'

// ---------------------------------------------------------------------------
// Case search
// ---------------------------------------------------------------------------

export interface CaseQuery {
  /** Free-text search across case title, parties, and judges. */
  search?: string
  jurisdiction?: string
  court?: string
  /** Filing date window. */
  filed_within?: DateRange
  limit?: number
  cursor?: string
}

export interface CaseResult {
  /** Adapter-specific case identifier. */
  id: string
  /** Full case title (e.g. "Smith v. Jones"). */
  title: string
  /** Court that heard the case. */
  court: string
  jurisdiction: string
  /** ISO 8601 filing date. Null when the source doesn't expose it. */
  filed_at: string | null
  /** Citation string as the source formats it. May be a Bluebook-style
   * cite; the citation-refusal filter inspects this downstream. */
  citation: string | null
}

// ---------------------------------------------------------------------------
// Dockets
// ---------------------------------------------------------------------------

export interface Docket {
  case_id: string
  title: string
  court: string
  /** Latest activity timestamp. */
  last_activity_at: string | null
  /** Whether the docket is publicly accessible (PACER fee, free, etc.).
   * Affects whether the runtime caches retrieved content. */
  access_class: 'public' | 'paid' | 'restricted'
}

export interface DocketEntry {
  id: string
  case_id: string
  /** Entry number as the court orders them. */
  entry_number: number
  filed_at: string
  /** Type of filing (motion, order, brief, etc.) as the source labels it. */
  filing_type: string
  description: string
  /** When the adapter can retrieve the underlying document, this is the
   * adapter's opaque reference. Skill code passes this back to
   * `get_filing_document` to fetch the content. */
  document_ref: string | null
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface CourtAccess extends AdapterBase {
  search_cases(query: CaseQuery): Promise<CaseResult[]>
  get_case(case_id: string): Promise<CaseResult | null>

  get_docket(case_id: string): Promise<Docket | null>
  get_docket_entries(case_id: string, range: DateRange): Promise<DocketEntry[]>

  /**
   * Retrieve the underlying filing document by docket entry. Returns
   * the raw bytes (typically PDF). The citation-refusal filter runs
   * AFTER retrieval, in skill code; this method itself does not
   * inspect content.
   */
  get_filing_document(document_ref: string): Promise<Uint8Array | null>

  // NO write methods. The agent does not file documents or post to
  // the court. The interface is read-only by design; the conformance
  // harness asserts no write methods are added.
}
