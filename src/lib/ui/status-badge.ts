/**
 * Returns Tailwind badge classes for a given status string.
 * Canonical source of truth for all status badge colors across admin UI.
 */
export function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-700',
    active: 'bg-green-100 text-green-700',
    completed: 'bg-emerald-100 text-emerald-700',
    handoff: 'bg-teal-100 text-teal-700',
    safety_net: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-slate-100 text-slate-500',
    disqualified: 'bg-red-100 text-red-600',
    converted: 'bg-green-100 text-green-700',
    draft: 'bg-slate-100 text-slate-600',
    sent: 'bg-blue-100 text-blue-700',
    accepted: 'bg-green-100 text-green-700',
    declined: 'bg-red-100 text-red-700',
    expired: 'bg-slate-100 text-slate-500',
    paid: 'bg-green-100 text-green-700',
    overdue: 'bg-red-100 text-red-700',
    void: 'bg-slate-100 text-slate-400',
    superseded: 'bg-slate-100 text-slate-400',
  }
  return map[status] ?? 'bg-slate-100 text-slate-600'
}
