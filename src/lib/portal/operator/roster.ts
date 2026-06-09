/**
 * Operator roster model (client-portal §5.2). Projects the customer's personas
 * into roster entries — one per operator (persona = Hermes profile, ADR 0011).
 *
 * Built for N, shipped at 1: the validator locks personas[] to length 1 at v1,
 * so today this returns a roster of one. The surface suppresses roster chrome
 * for a single operator (it is the default scope, not a placeholder) and shows
 * the full roster once v2 unlocks N personas — a validator flip, not a
 * rearchitecture.
 *
 * Pure — no I/O. "What it handles" is the set of enabled (non-refused) skill
 * names; a refused skill is configured but never runs, so it is not surfaced as
 * something the operator handles.
 */

import type { PersonaConfig, PersonaStatus } from '../customer-config'

export interface OperatorRosterEntry {
  slug: string
  name: string
  title: string | null
  status: PersonaStatus
  /** Enabled skill names (ceiling other than refused) — what this operator handles. */
  handles: string[]
  tone: string[]
}

export function buildOperatorRoster(personas: readonly PersonaConfig[]): OperatorRosterEntry[] {
  return personas.map((p) => ({
    slug: p.slug,
    name: p.name,
    title: p.title,
    status: p.status,
    handles: p.skills.filter((s) => s.trust_ceiling !== 'refused').map((s) => s.name),
    tone: p.tone,
  }))
}

/**
 * True when the roster is a single operator — the surface shows it as the
 * default scope without switcher chrome (§5.2 roster-of-one). An empty roster
 * is also "single" for chrome purposes (nothing to switch between); the page
 * handles the empty case with its own honest state.
 */
export function isRosterOfOne(roster: readonly OperatorRosterEntry[]): boolean {
  return roster.length <= 1
}
