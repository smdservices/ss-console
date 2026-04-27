/**
 * Strict domain-match guard for Google Places lookups (#612).
 *
 * Why this exists
 * ---------------
 * Google Places `searchText` is a fuzzy text search. Passing a business
 * name + locality bias can return a confident, well-rated result that has
 * nothing to do with the domain a prospect submitted. The 2026-04-27
 * Captain smoke test exposed the problem in production: submitting
 * `venturecrane.com` returned "Sunrise Crane" — a Phoenix crane-rental
 * company at sunrisecrane.com. Without a guard, that wrong business's
 * website + phone wrote into the entity row, and every downstream
 * enrichment module (website_analysis, review_synthesis, deep_website)
 * ran against `sunrisecrane.com` instead of the real submitted domain.
 *
 * Had the report finished rendering, it would have described Sunrise
 * Crane labelled as Venturecrane — a direct CLAUDE.md anti-fabrication
 * P0 violation.
 *
 * The guard
 * ---------
 * After a Places result returns, we compare its `website` field against
 * the submitted domain using strict equality with one allowed normalization:
 *
 *   - Strip protocol (`http://`, `https://`)
 *   - Strip leading `www.`
 *   - Strip path / query / fragment
 *   - Trailing-slash-insensitive
 *   - Case-insensitive (lowercased)
 *
 * That collapses `https://www.X.com/path/?q=1` and `X.com` to the same
 * canonical form. They match. A multi-level subdomain like
 * `scan.X.com` does NOT match `X.com` — that's a different host, possibly
 * a different operator, and we treat it as no match.
 *
 * If Places returned no website, no match. If the websites disagree
 * after normalization, no match. Either way, the guard's contract is to
 * return `null` so the orchestrator skips the entity write and trips the
 * thin-footprint gate. The wrong business's data is never persisted.
 */

import type { PlacesEnrichment } from '../enrichment/google-places'

/**
 * Normalize a hostname for strict-match comparison.
 *
 * Returns null if the input is empty or fails to parse — the caller
 * should treat null as "definitely doesn't match anything".
 *
 * Examples:
 *   normalizeHost('https://www.X.com/path/?q=1')  -> 'x.com'
 *   normalizeHost('X.com')                         -> 'x.com'
 *   normalizeHost('www.X.com')                     -> 'x.com'
 *   normalizeHost('scan.X.com')                    -> 'scan.x.com'
 *   normalizeHost('  HTTPS://X.COM/  ')            -> 'x.com'
 */
export function normalizeHost(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = String(input).trim()
  if (!trimmed) return null

  // Try to parse as a URL. Tolerate a missing scheme.
  let host: string
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const u = new URL(withScheme)
    host = u.hostname
  } catch {
    return null
  }

  host = host.toLowerCase()
  if (host.startsWith('www.')) host = host.slice(4)
  // Defensive — should never fire after URL parse, but keeps the contract
  // explicit: a host must have at least one dot to be a real domain.
  if (!host || host.indexOf('.') === -1) return null
  return host
}

/**
 * Strict match: the two hosts compare equal after normalization. The only
 * normalization difference we treat as a match is the leading `www.` —
 * any other subdomain difference (`scan.X.com` vs `X.com`) is NOT a match.
 */
export function isStrictDomainMatch(
  submittedDomain: string | null | undefined,
  candidateUrl: string | null | undefined
): boolean {
  const a = normalizeHost(submittedDomain)
  const b = normalizeHost(candidateUrl)
  if (!a || !b) return false
  return a === b
}

/**
 * Apply the strict-match guard to a Places result. Returns:
 *
 *   - the same `places` object when its website matches the submitted
 *     domain, OR
 *   - `null` when there is no match — the orchestrator must NOT write
 *     the candidate's phone/website into the entity row, and the
 *     thin-footprint gate should subsequently trip.
 *
 * A Places result with no website is treated as no match — we have no
 * way to verify it's the right business, and the prospect submitted a
 * domain expecting that domain to be the index.
 */
export function guardPlacesByDomain(
  places: PlacesEnrichment | null,
  submittedDomain: string
): PlacesEnrichment | null {
  if (!places) return null
  if (!isStrictDomainMatch(submittedDomain, places.website)) {
    return null
  }
  return places
}
