/**
 * Operator SCHEDULE facet helper — deterministic cron → plain-language
 * translation (console blueprint §4: the schedule coverage gap; registry
 * `schedule` facet). Consumed by the skills and work resolvers to attach
 * "when it runs" prose to duties.
 *
 * Covers ONLY the shapes the seats author (fixed minute/hour with daily /
 * weekday / single-weekday cadence); anything else returns null and no
 * schedule prose renders — a wrong translation would be fabrication, a
 * missing one is just less detail (the "On a schedule" label still shows).
 * Times render in the seat's own clock: seat cron runs seat-local
 * (business_hours.timezone → HERMES_TIMEZONE), so no zone math happens here.
 */

import type { PersonaCronEntry } from '../../../customer-config'

const WEEKDAY_NAME: Record<string, string> = {
  '0': 'Sunday',
  '1': 'Monday',
  '2': 'Tuesday',
  '3': 'Wednesday',
  '4': 'Thursday',
  '5': 'Friday',
  '6': 'Saturday',
  '7': 'Sunday',
}

export function describeCronSchedule(expr: string): string | null {
  const m = expr.trim().match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|\d|1-5)$/)
  if (!m) return null
  const minute = Number(m[1])
  const hour = Number(m[2])
  if (minute > 59 || hour > 23) return null
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const ampm = hour < 12 ? 'a.m.' : 'p.m.'
  const time = `${h12}:${String(minute).padStart(2, '0')} ${ampm}`
  if (m[3] === '*') return `Daily at ${time}`
  if (m[3] === '1-5') return `Weekdays at ${time}`
  const day = WEEKDAY_NAME[m[3]]
  return day ? `Weekly on ${day} at ${time}` : null
}

/**
 * Build the skill → schedule-prose map from projected cron entries. A skill
 * scheduled more than once keeps every describable entry, joined; entries
 * whose expression is outside the describable shapes are omitted (never
 * mistranslated).
 */
export function scheduleDetailBySkill(entries: readonly PersonaCronEntry[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const entry of entries) {
    const prose = describeCronSchedule(entry.schedule)
    if (!prose) continue
    const existing = out.get(entry.skill)
    out.set(entry.skill, existing ? `${existing} · ${prose}` : prose)
  }
  return out
}
