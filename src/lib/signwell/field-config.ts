/**
 * SignWell field placement configurations.
 *
 * Coordinates are read directly from the signing-layout constants,
 * which are measured from actual rendered PDFs — not calculated.
 *
 * Each document type exports a function that returns field placements
 * for a given signer. This pattern scales to future document types
 * (proposals, invoices) by adding new functions here and new layout
 * constants in signing-layout.ts.
 *
 * @see src/lib/pdf/signing-layout.ts — layout constants (single source of truth)
 */

import { SIGNING_PAGE } from '../pdf/signing-layout'
import type { SignWellField } from './types'

export interface SigningFieldConfig {
  signature: Omit<SignWellField, 'required' | 'api_id'>
  date: Omit<SignWellField, 'required' | 'api_id'>
}

/**
 * Get SignWell field placements for the SOW document.
 *
 * The CLIENT signature and date fields are placed on the left column
 * of the dedicated signing page's AGREEMENT section (page 3).
 *
 * Coordinates come from signing-layout.ts constants, which are
 * measured from the actual rendered PDF.
 */
export function getSowSigningFields(): SigningFieldConfig {
  return {
    signature: {
      type: 'signature',
      page: SIGNING_PAGE.pageNumber,
      x: SIGNING_PAGE.clientSignature.x,
      y: SIGNING_PAGE.clientSignature.y,
      width: SIGNING_PAGE.clientSignature.width,
      height: SIGNING_PAGE.clientSignature.height,
    },
    date: {
      type: 'date',
      page: SIGNING_PAGE.pageNumber,
      x: SIGNING_PAGE.clientDate.x,
      y: SIGNING_PAGE.clientDate.y,
      width: SIGNING_PAGE.clientDate.width,
      height: SIGNING_PAGE.clientDate.height,
    },
  }
}
