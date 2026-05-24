/**
 * Audit log export formatters — CSV and JSON.
 *
 * Per issue #896, export the current query result so ethics counsel
 * can ingest it into their own tooling. We support two formats:
 *
 *   - CSV: RFC 4180-compliant. Comma-delimited, CRLF line endings,
 *     double-quote field wrap with `""` escape for embedded quotes.
 *     Header row mirrors `AuditEntry` field names — the same columns
 *     a SQL dump of the underlying `audit_log` would surface.
 *
 *   - JSON: an array of `AuditEntry` objects. No envelope, no
 *     pagination metadata — the export contract is "exactly what
 *     matched the filter", and a wrapper would force ethics counsel
 *     tooling to know about it.
 *
 * Export contract:
 *
 *   The export is the FULL filtered+sorted result set, not just the
 *   current page. Reviewers exporting a compliance packet need the
 *   whole window, not a snapshot of whatever page they happened to
 *   be looking at. The caller is responsible for passing the
 *   unpaginated array; this module is pure.
 *
 * No fabrication: every field is taken verbatim from the AuditEntry.
 * Null values surface as empty CSV cells / JSON nulls — never as
 * placeholder strings like "n/a".
 */

import type { AuditEntry } from './audit'

/**
 * Stable column order for the CSV export. Mirrors the canonical
 * `AuditEntry` shape so the export is round-trippable against the
 * source contract. Order is locked because compliance tooling
 * downstream may depend on column position.
 */
export const AUDIT_CSV_COLUMNS = [
  'id',
  'ts',
  'actor',
  'actorRole',
  'action',
  'target',
  'decision',
  'reason',
  'skill',
  'matterRef',
] as const

export type AuditCsvColumn = (typeof AUDIT_CSV_COLUMNS)[number]

/**
 * Escape a single CSV cell per RFC 4180. Wraps in double quotes when
 * the value contains a comma, double quote, CR, or LF; otherwise
 * returns the value unwrapped. Embedded quotes are doubled. Null
 * surfaces as the empty string.
 */
export function csvCell(value: string | null): string {
  if (value === null) return ''
  const needsQuote = /[",\r\n]/.test(value)
  const escaped = value.replace(/"/g, '""')
  return needsQuote ? `"${escaped}"` : escaped
}

function entryToRow(entry: AuditEntry): string {
  return AUDIT_CSV_COLUMNS.map((col) => {
    const raw = entry[col]
    return csvCell(raw === null ? null : String(raw))
  }).join(',')
}

/**
 * Render an audit list as a CSV string. CRLF line endings per
 * RFC 4180 §2.1. Header row first; one row per entry; trailing
 * newline at the end for POSIX-friendly downstream tools.
 */
export function renderAuditCsv(entries: readonly AuditEntry[]): string {
  const lines: string[] = []
  lines.push(AUDIT_CSV_COLUMNS.join(','))
  for (const entry of entries) {
    lines.push(entryToRow(entry))
  }
  return lines.join('\r\n') + '\r\n'
}

/**
 * Render an audit list as JSON. Pretty-printed with two-space
 * indentation — exports are downloaded for human inspection or
 * one-off ingest, not parsed at scale, so the size cost of the
 * indentation is fine and readability wins.
 *
 * The output is a plain array of AuditEntry — no envelope. This
 * matches the CSV contract: "exactly what matched the filter".
 */
export function renderAuditJson(entries: readonly AuditEntry[]): string {
  return JSON.stringify(entries, null, 2) + '\n'
}

/**
 * Compose a download filename for the export. The compliance reviewer
 * usually saves the file straight to their case files, so a stable
 * descriptive name beats a UUID.
 *
 * Format: `audit-{customerSlug}-{nowIso}.{ext}` with the ISO timestamp
 * stripped of separators that some filesystems balk at.
 */
export function exportFilename(
  customerSlug: string,
  ext: 'csv' | 'json',
  nowMs: number = Date.now()
): string {
  const ts = new Date(nowMs).toISOString().replace(/[:.]/g, '-').replace(/Z$/, '')
  return `audit-${customerSlug}-${ts}.${ext}`
}
