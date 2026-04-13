/**
 * Shared constants for the client portal.
 *
 * Single source of truth for client-facing engagement status labels and colors.
 * Used by both the portal dashboard and the engagement progress page.
 */

/** Client-friendly engagement status labels. */
export const CLIENT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Starting Soon',
  active: 'Underway',
  handoff: 'Wrapping Up',
  safety_net: 'Support',
  completed: 'Complete',
  cancelled: 'Cancelled',
}

/** Tailwind classes for engagement status badges. */
export const CLIENT_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-slate-100 text-slate-600',
  active: 'bg-blue-100 text-blue-800',
  handoff: 'bg-amber-100 text-amber-800',
  safety_net: 'bg-green-100 text-green-800',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
}
