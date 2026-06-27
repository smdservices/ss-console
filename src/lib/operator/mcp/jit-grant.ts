/**
 * Pure email-domain matching for the open-by-domain JIT gate (slice 2e, ADR 0057).
 *
 * The strictness here IS the isolation control: under `policy: open`, a verified
 * firm-domain identity is auto-granted, so a sloppy domain check would admit
 * outsiders. Match the full host after the LAST `@`, lowercased, single-`@` only,
 * and exact membership (no implicit subdomain match — a firm authors `mail.firm.com`
 * explicitly if it wants it). `allowed_domains` arrive already lowercased + shape-
 * validated from the validator / projection read.
 */

/** Lowercased host after a single `@`, or null for a malformed address. */
export function extractEmailDomain(email: string): string | null {
  const at = email.indexOf('@')
  if (at < 1) return null
  // Reject more than one '@' (quoted local parts, junk) — fail closed.
  if (email.indexOf('@', at + 1) !== -1) return null
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
  return domain.length > 0 ? domain : null
}

/** Exact-host membership test for an open-policy JIT grant. */
export function domainAllowed(email: string, allowedDomains: readonly string[]): boolean {
  const domain = extractEmailDomain(email)
  return domain !== null && allowedDomains.includes(domain)
}
