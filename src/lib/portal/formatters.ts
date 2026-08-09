/**
 * Portal-facing formatters. Centralized so no list/detail surface redefines
 * its own formatDate/formatCurrency variant (the pattern that produced the
 * three-different-date-formats drift this registry is fixing).
 *
 * Money rendering: use `<MoneyDisplay amountCents={N}>` as the default.
 */

/**
 * Short date: "Apr 13, 2026" / "Apr 13" when within the current year.
 * Returns an empty string for invalid ISO input so callers can chain without
 * guarding.
 */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * Due caption: "Due Monday, April 20" for a future date; "Overdue — was
 * Monday, April 20" for past. Used on invoice list rows + the detail
 * action card.
 *
 * @public The shared composer. Kept as the canonical form while
 * src/pages/portal/billing/invoices/[id].astro wraps its own local variant;
 * that comment names this function as the alternative.
 */
export function formatRelativeDueCaption(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const long = d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  const now = Date.now()
  const diffMs = d.getTime() - now
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return `Overdue — was ${long}`
  if (diffDays === 0) return `Due today`
  return `Due ${long}`
}
