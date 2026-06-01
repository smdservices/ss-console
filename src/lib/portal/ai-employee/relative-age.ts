/**
 * Compact relative-age ladder for AI Employee list surfaces.
 *
 * `formatDraftAge` (drafts) and `formatNotificationAge` (notifications) carried
 * a byte-identical `just now → Nm → Nh → Nd → Nmo → Ny` ladder; the only
 * difference was the input (raw `ageSeconds` vs an ISO timestamp). This is the
 * single source for that ladder.
 *
 * Deliberately NOT date-fns: the surfaces pin exact output strings ("5m ago",
 * "2mo ago"), and date-fns `formatDistanceToNow` produces a different shape
 * ("about 2 hours ago"). Two other formatters (`formatMatterAge`'s "Opened …
 * ago" and `aliveness`'s spelled-out "… minutes ago") render intentionally
 * distinct copy and are left as-is — they are not this ladder.
 */

/** Compact relative age from a non-negative seconds delta. `< 60s` → "just now". */
export function formatRelativeAgeSeconds(ageSeconds: number): string {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 60) return 'just now'
  const minutes = Math.floor(ageSeconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

/**
 * Same ladder from an ISO timestamp string. Unparseable input is returned
 * verbatim (the notifications surface's contract — it shows the raw value
 * rather than a misleading "just now"). `nowMs` is injectable for tests.
 */
export function formatRelativeAgeIso(ts: string, nowMs: number = Date.now()): string {
  const parsedMs = Date.parse(ts)
  if (!Number.isFinite(parsedMs)) return ts
  const ageSeconds = Math.max(0, Math.floor((nowMs - parsedMs) / 1000))
  return formatRelativeAgeSeconds(ageSeconds)
}
