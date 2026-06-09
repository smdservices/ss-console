/**
 * Same-origin return-path guard for client-portal form posts.
 *
 * Form-driven endpoints (e.g. the change-request filing path) carry a
 * `return_to` field so the 303 lands the client back on the surface they acted
 * from. An attacker-supplied `return_to` is an open-redirect vector, so the
 * value is never trusted: it must be a relative path inside the client operator
 * surface subtree. Anything else collapses to the operator root.
 *
 * Pure and total — accepts the raw FormDataEntryValue (string | File | null)
 * and always returns a safe path.
 */

/** The only subtree a return path may point at — the client operator surface. */
export const OPERATOR_ROOT = '/portal/products/operator'

export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string') return OPERATOR_ROOT
  const value = raw.trim()
  // Must be a root-relative path into the operator surface. Reject anything
  // that could escape origin: protocol-relative ("//host"), backslashes
  // (browser-normalized to "/"), or whitespace/control characters smuggled in.
  if (!value.startsWith(OPERATOR_ROOT)) return OPERATOR_ROOT
  if (value.includes('//') || value.includes('\\')) return OPERATOR_ROOT
  // Reject any whitespace or control character (code point <= 0x20).
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) <= 0x20) return OPERATOR_ROOT
  }
  // The char after the root must be a path boundary, so "/portal/products/operatorX"
  // (a sibling prefix) cannot pass as the operator subtree.
  const next = value.charAt(OPERATOR_ROOT.length)
  if (next !== '' && next !== '/' && next !== '?' && next !== '#') return OPERATOR_ROOT
  return value
}
