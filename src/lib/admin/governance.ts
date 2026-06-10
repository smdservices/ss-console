/**
 * Governance matrix reader + cell resolver for the admin Operator console
 * governance surface (`/admin/operator/[customer]/governance`) — design §5.3,
 * ADR 0025 (action-class ceilings) / ADR 0035 (no imposed defaults).
 *
 * The surface shows, per persona × skill × action class: the SMD-set floor
 * (non-raisable), the authored ceiling, and the effective ceiling. The one rule
 * that must not bend (ADR 0035, foundations §8): an action class with no
 * authored ceiling renders **unconfigured → fail-closed**, NEVER a presumed
 * "draft_for_review." Draft-for-review is a value authored in `action_ceilings`,
 * not a fallback. This module encodes exactly that — `authored === null` yields a
 * `fail_closed` cell with no invented value.
 *
 * Why an admin-side reader (not the frozen getCustomerConfig): the customer_configs
 * projection type under-declares skills as `{name, trust_ceiling}` and drops
 * `action_ceilings`. Rather than edit the shared read path (customer-config.ts),
 * this module parses `personas_json` directly with the fields governance needs.
 * Defensive parse: a malformed row degrades to an explicit error, not a crash.
 *
 * The floor lookup and the restrictiveness ordering are the frozen governance
 * foundation (config-governance.ts); this module imports them read-only and adds
 * no new floor source.
 */

import type { D1Database } from '@cloudflare/workers-types'
import {
  getVerticalFloor,
  restrictiveness,
  isCeiling,
  type Ceiling,
} from '../portal/operator/config-governance'
import { ACCEPTED_ACTION_CLASSES, type ActionClass } from '../operator/customer-yaml/types'

export interface GovernanceSkill {
  name: string
  enabled: boolean
  trust_ceiling: Ceiling
  action_ceilings: Partial<Record<ActionClass, Ceiling>>
}

export interface GovernancePersona {
  slug: string
  name: string
  status: string
  skills: GovernanceSkill[]
}

export type GovernanceRead =
  | { ok: true; vertical: string | null; personas: GovernancePersona[] }
  | { ok: false; error: 'not_found' | 'malformed' }

interface ConfigRow {
  personas_json: string
  vertical: string | null
}

/**
 * Read the governance-relevant config for one customer by slug. Parses
 * `personas_json` for the full skill shape (including action_ceilings + enabled),
 * which the frozen projection omits. Returns a typed error rather than throwing.
 */
export async function readGovernanceConfig(db: D1Database, slug: string): Promise<GovernanceRead> {
  const row = await db
    .prepare('SELECT personas_json, vertical FROM customer_configs WHERE customer_slug = ?')
    .bind(slug)
    .first<ConfigRow>()
  if (!row) return { ok: false, error: 'not_found' }
  try {
    return { ok: true, vertical: row.vertical, personas: parsePersonas(row.personas_json) }
  } catch {
    return { ok: false, error: 'malformed' }
  }
}

function parsePersonas(raw: string): GovernancePersona[] {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('personas_json is not an array')
  return parsed.map((p) => {
    if (typeof p !== 'object' || p === null) throw new Error('persona is not an object')
    const rec = p as Record<string, unknown>
    return {
      slug: typeof rec.slug === 'string' ? rec.slug : '',
      name: typeof rec.name === 'string' ? rec.name : '',
      status: typeof rec.status === 'string' ? rec.status : 'unknown',
      skills: Array.isArray(rec.skills) ? rec.skills.map(parseSkill) : [],
    }
  })
}

function parseSkill(s: unknown): GovernanceSkill {
  if (typeof s !== 'object' || s === null) throw new Error('skill is not an object')
  const rec = s as Record<string, unknown>
  return {
    name: typeof rec.name === 'string' ? rec.name : '',
    enabled: rec.enabled !== false, // default-enabled unless explicitly false
    trust_ceiling: isCeiling(rec.trust_ceiling) ? rec.trust_ceiling : 'refused',
    action_ceilings: parseActionCeilings(rec.action_ceilings),
  }
}

function parseActionCeilings(raw: unknown): Partial<Record<ActionClass, Ceiling>> {
  const out: Partial<Record<ActionClass, Ceiling>> = {}
  if (typeof raw !== 'object' || raw === null) return out
  const rec = raw as Record<string, unknown>
  for (const cls of ACCEPTED_ACTION_CLASSES) {
    const v = rec[cls]
    if (isCeiling(v)) out[cls] = v
  }
  return out
}

// ===========================================================================
// Cell resolution (pure) — the ADR-0035 keystone
// ===========================================================================

export type CellStatus = 'authored' | 'fail_closed'

export interface GovernanceCell {
  actionClass: ActionClass
  /** SMD-set non-raisable floor for this class on this vertical, or null. */
  floor: Ceiling | null
  /** The authored ceiling for this class, or null when unauthored. */
  authored: Ceiling | null
  /**
   * The effective ceiling: the most restrictive of {floor, authored}. Null ONLY
   * when the class is unauthored — in which case status is `fail_closed` and the
   * surface must render "unconfigured", never a default value (ADR 0035).
   */
  effective: Ceiling | null
  status: CellStatus
}

/**
 * Resolve one skill × action-class cell. `internal_write` is governed by the
 * skill scalar (always authored); every other class is authored only via an
 * `action_ceilings` entry. An unauthored class is fail-closed with no invented
 * value — this is the rule ADR 0035 / foundations §8 forbid bending.
 */
export function resolveCell(
  skill: GovernanceSkill,
  actionClass: ActionClass,
  vertical: string | null
): GovernanceCell {
  const floor = getVerticalFloor(vertical, actionClass)
  const authored: Ceiling | null =
    actionClass === 'internal_write'
      ? skill.trust_ceiling
      : (skill.action_ceilings[actionClass] ?? null)

  if (authored === null) {
    return { actionClass, floor, authored: null, effective: null, status: 'fail_closed' }
  }
  const effective = mostRestrictive(floor, authored)
  return { actionClass, floor, authored, effective, status: 'authored' }
}

/** Most restrictive of an optional floor and an authored value. */
function mostRestrictive(floor: Ceiling | null, authored: Ceiling): Ceiling {
  if (floor === null) return authored
  return restrictiveness(floor) > restrictiveness(authored) ? floor : authored
}

/** Resolve every action-class cell for a skill, in canonical class order. */
export function resolveSkillCells(
  skill: GovernanceSkill,
  vertical: string | null
): GovernanceCell[] {
  return ACCEPTED_ACTION_CLASSES.map((cls) => resolveCell(skill, cls, vertical))
}

/** Human label for a ceiling value (display only). */
export function ceilingLabel(ceiling: Ceiling): string {
  switch (ceiling) {
    case 'autonomous':
      return 'Autonomous'
    case 'draft_for_review':
      return 'Draft for review'
    case 'refused':
      return 'Refused'
  }
}

/** Human label for an action class (display only). */
export function actionClassLabel(actionClass: ActionClass): string {
  switch (actionClass) {
    case 'read':
      return 'Read'
    case 'internal_write':
      return 'Internal write'
    case 'external_send':
      return 'External send'
    case 'commitment':
      return 'Commitment'
    case 'destructive':
      return 'Destructive'
  }
}
