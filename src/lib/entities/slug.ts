/**
 * Slug computation for entity dedup.
 *
 * Normalizes business names into URL-safe slugs for UNIQUE(org_id, slug)
 * dedup. When area is provided, it's appended for location disambiguation
 * (e.g., two PIRTEK franchises in different cities).
 *
 * Known limitation: genuinely different name variants for the same business
 * (e.g., "AZ Comfort Solutions" vs "Arizona Comfort Solutions") will create
 * separate entities. Handle with admin merge action at the UI layer.
 */

/** Common business suffixes stripped during normalization. */
const SUFFIX_PATTERN =
  /\b(llc|l\.l\.c|inc|corp|co|company|corporation|incorporated|limited|llp|ltd|pllc|pc|p\.c|lp|plc|dba)\b\.?/gi

/** Parenthetical location/description info stripped from names. */
const PAREN_PATTERN = /\s*\(.*?\)\s*/g

/**
 * Compute a normalized slug from a business name and optional area.
 *
 * Examples:
 *   computeSlug("PIRTEK (Goodyear, AZ – Franchise Location)", "Goodyear, AZ")
 *     → "pirtek-goodyear-az"
 *   computeSlug("ProGuard Roofing LLC", "Phoenix, AZ")
 *     → "proguard-roofing-phoenix-az"
 *   computeSlug("Smith & Sons Plumbing")
 *     → "smith-sons-plumbing"
 */
export function normalizeBusinessName(name: string): string {
  let s = name.toLowerCase()

  s = s.replace(PAREN_PATTERN, ' ')
  s = s.replace(SUFFIX_PATTERN, '')
  s = s.replace(/\baz\b/g, 'arizona')
  s = s.replace(/[^a-z0-9\s-]/g, ' ')
  return s.trim().replace(/\s+/g, ' ').replace(/-+/g, '-')
}

function normalizeArea(area: string): string {
  return area
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function computeSlug(name: string, area?: string | null): string {
  let s = normalizeBusinessName(name).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

  if (area) {
    const a = normalizeArea(area)
    if (a) {
      s = `${s}-${a}`
    }
  }

  return s
}

export function jaroWinklerSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0

  const matchDistance = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0)
  const aMatches = new Array<boolean>(a.length).fill(false)
  const bMatches = new Array<boolean>(b.length).fill(false)

  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, b.length)
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0

  let transpositions = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }

  const m = matches
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3

  let prefix = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] !== b[i]) break
    prefix++
  }

  return jaro + prefix * 0.1 * (1 - jaro)
}
