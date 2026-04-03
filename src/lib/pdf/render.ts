/**
 * Thin wrapper around Forme PDF rendering.
 *
 * Provides a single entry point for generating SOW PDFs from typed props.
 *
 * @see docs/spikes/forme-wasm-pdf.md — Forme spike results
 * @see src/lib/pdf/sow-template.tsx — SOW template component
 */

import { renderDocument } from '@formepdf/core'
import { SOWTemplate } from './sow-template'
import type { SOWTemplateProps } from './sow-template'
import { ScorecardReportTemplate } from './scorecard-template'
import type { ScorecardReportProps } from './scorecard-template'

/**
 * Render a Statement of Work PDF from quote/client/contact data.
 *
 * @param props - All data needed for the SOW template (see SOWTemplateProps)
 * @returns PDF binary as Uint8Array — suitable for R2 storage or HTTP response
 */
export async function renderSow(props: SOWTemplateProps): Promise<Uint8Array> {
  const pdf = await renderDocument(SOWTemplate(props))
  return pdf
}

/**
 * Render an Operations Health Scorecard report PDF.
 *
 * @param props - Scorecard results data (see ScorecardReportProps)
 * @returns PDF binary as Uint8Array — suitable for email attachment
 */
export async function renderScorecardReport(props: ScorecardReportProps): Promise<Uint8Array> {
  const pdf = await renderDocument(ScorecardReportTemplate(props))
  return pdf
}
