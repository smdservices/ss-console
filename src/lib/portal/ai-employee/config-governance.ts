/**
 * Config governance — the portal-side security boundary for autonomy config
 * (ADR 0026 / ADR 0030 §4).
 *
 * A change to a trust ceiling or exposure setting is a privileged, principal-
 * authenticated, immutably-audited, floor-checked act. This module holds the
 * pure decision logic plus the append-only audit writer. It is imported ONLY
 * by principal-gated portal POST handlers — never by agent/skill/tool code
 * (the agent runs on the Machine in the overlay repo, physically unable to
 * reach this module per the ADR 0009 isolation boundary; this is the portal-
 * side statement of ADR 0026 §1 "the agent can never raise its own ceiling").
 *
 * This module does NOT mutate the live `customer_configs` replica: that table
 * is read-only on principle (ADR 0012 §2 — only git -> CI writes it). The
 * value change reaches the runtime via the deferred git write-back path
 * (ADR 0025 step 7). What we persist here is the governance ACTION and its
 * floor decision, in the `config_change_audit` ledger — that is ADR 0026's
 * "immutably audited," honestly scoped `portal_intent`.
 */

import { ACCEPTED_ACTION_CLASSES, type ActionClass } from '../../ai-employee/customer-yaml/types'
import type { D1Database } from '@cloudflare/workers-types'

export type Ceiling = 'autonomous' | 'draft_for_review' | 'refused'

/**
 * Restrictiveness ordering — mirrors `ai-employee/adapter/trust_ceiling.py`
 * `_RESTRICTIVENESS`. Higher = more restrictive. Single source for the
 * raise/lower asymmetry and the floor comparison on the TS side.
 */
const RESTRICTIVENESS: Record<Ceiling, number> = {
  autonomous: 0,
  draft_for_review: 1,
  refused: 2,
}

export function isCeiling(value: unknown): value is Ceiling {
  return value === 'autonomous' || value === 'draft_for_review' || value === 'refused'
}

export function restrictiveness(c: Ceiling): number {
  return RESTRICTIVENESS[c]
}

export type ChangeDirection = 'raise' | 'lower' | 'lateral' | 'n/a'

/**
 * Direction of a ceiling change. A "raise" moves toward LESS restrictive
 * (more autonomy) — the privileged direction ADR 0026 §5 guards.
 */
export function changeDirection(oldValue: Ceiling, newValue: Ceiling): ChangeDirection {
  const delta = RESTRICTIVENESS[newValue] - RESTRICTIVENESS[oldValue]
  if (delta < 0) return 'raise'
  if (delta > 0) return 'lower'
  return 'lateral'
}

/**
 * Non-raisable per-action-class vertical floors (ADR 0025 / ADR 0022
 * compliance constraints). Seeded constant — the source of truth is the
 * vertical pack manifest (`ai-employee/verticals/<v>/vertical.yaml`
 * `trust_floors`); this mirror is kept tiny and the keys are asserted to be
 * real action classes (see config-governance.test.ts) so the portal and the
 * runtime can never drift on the identifier. CI projection of floors from the
 * vertical manifests is a tracked follow-on; until then a Captain-reviewed
 * constant is authored data, not fabrication.
 *
 * For a law firm, ABA Formal Opinion 512 / state AI-disclosure rules pin every
 * outbound communication to reviewer-as-sender, so `external_send` is floored
 * at `draft_for_review` and cannot be promoted to `autonomous`.
 */
export const VERTICAL_FLOORS: Readonly<Record<string, Partial<Record<ActionClass, Ceiling>>>> = {
  'law-firm': { external_send: 'draft_for_review' },
}

/** Every action-class key used in VERTICAL_FLOORS, for the membership assertion. */
export function verticalFloorActionClasses(): string[] {
  const keys = new Set<string>()
  for (const floors of Object.values(VERTICAL_FLOORS)) {
    for (const k of Object.keys(floors)) keys.add(k)
  }
  return [...keys]
}

export function getVerticalFloor(vertical: string | null, action: ActionClass): Ceiling | null {
  if (!vertical) return null
  return VERTICAL_FLOORS[vertical]?.[action] ?? null
}

export interface FloorCheck {
  allowed: boolean
  reason: string | null
}

/**
 * A requested ceiling may not be LESS restrictive than the floor. Returns
 * disallowed for a raise above the floor; allowed when at/below the floor or
 * when no floor applies.
 */
export function checkFloor(floor: Ceiling | null, requested: Ceiling): FloorCheck {
  if (floor === null) return { allowed: true, reason: null }
  if (RESTRICTIVENESS[requested] < RESTRICTIVENESS[floor]) {
    return {
      allowed: false,
      reason: `vertical floor requires '${floor}' for this action class; '${requested}' would raise above it`,
    }
  }
  return { allowed: true, reason: null }
}

export type ConfigChangeType = 'trust_ceiling' | 'action_ceiling' | 'skill_toggle'
export type ConfigChangeOutcome = 'accepted' | 'rejected_floor' | 'rejected_invalid'

export interface ConfigChangeAuditEvent {
  customer_slug: string
  entity_id: string
  actor_user_id: string
  actor_email: string
  actor_role: string
  change_type: ConfigChangeType
  persona_slug: string | null
  skill_name: string | null
  action_class: string | null
  old_value: string | null
  new_value: string | null
  outcome: ConfigChangeOutcome
  outcome_reason: string | null
  direction: ChangeDirection
}

/**
 * Append a governance action to the immutable control-plane ledger. Always
 * writes `source='portal_intent'`. Records accepted AND rejected outcomes —
 * a floor-rejected raise is itself a compliance-relevant event (ADR 0026 §4).
 */
export async function recordConfigChangeAudit(
  db: D1Database,
  event: ConfigChangeAuditEvent
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO config_change_audit ' +
        '(customer_slug, entity_id, source, actor_user_id, actor_email, actor_role, ' +
        'change_type, persona_slug, skill_name, action_class, old_value, new_value, ' +
        'outcome, outcome_reason, direction) ' +
        "VALUES (?, ?, 'portal_intent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      event.customer_slug,
      event.entity_id,
      event.actor_user_id,
      event.actor_email,
      event.actor_role,
      event.change_type,
      event.persona_slug,
      event.skill_name,
      event.action_class,
      event.old_value,
      event.new_value,
      event.outcome,
      event.outcome_reason,
      event.direction
    )
    .run()
}

export interface Actor {
  user_id: string
  email: string
  role: string
}

export interface ApplyCeilingChangeInput {
  customer_slug: string
  entity_id: string
  actor: Actor
  persona_slug: string | null
  skill_name: string
  /** Present for an exposure (action-class) change; null for a skill scalar. */
  action_class: ActionClass | null
  /** The customer's vertical, for the floor lookup. Null when unknown. */
  vertical: string | null
  old_value: Ceiling
  new_value: Ceiling
}

export interface ApplyResult {
  outcome: ConfigChangeOutcome
  reason: string | null
}

/**
 * Orchestrate a trust-ceiling / action-ceiling change: compute direction,
 * floor-check a raise on an action class, and record the outcome (accepted or
 * rejected) to the ledger. Does not write the live config (deferred git
 * write-back). The caller is responsible for being principal-gated.
 */
export async function applyCeilingChange(
  db: D1Database,
  input: ApplyCeilingChangeInput
): Promise<ApplyResult> {
  const direction = changeDirection(input.old_value, input.new_value)
  const floor = input.action_class ? getVerticalFloor(input.vertical, input.action_class) : null
  const floorCheck = checkFloor(floor, input.new_value)
  const outcome: ConfigChangeOutcome = floorCheck.allowed ? 'accepted' : 'rejected_floor'

  await recordConfigChangeAudit(db, {
    customer_slug: input.customer_slug,
    entity_id: input.entity_id,
    actor_user_id: input.actor.user_id,
    actor_email: input.actor.email,
    actor_role: input.actor.role,
    change_type: input.action_class ? 'action_ceiling' : 'trust_ceiling',
    persona_slug: input.persona_slug,
    skill_name: input.skill_name,
    action_class: input.action_class,
    old_value: input.old_value,
    new_value: input.new_value,
    outcome,
    outcome_reason: floorCheck.reason,
    direction,
  })

  return { outcome, reason: floorCheck.reason }
}

export interface ApplySkillToggleInput {
  customer_slug: string
  entity_id: string
  actor: Actor
  persona_slug: string | null
  skill_name: string
  next_enabled: boolean
  /** Current skill ceiling, for the old_value. */
  old_value: Ceiling
}

/**
 * Record a skill enable/disable. Disabling maps to `refused` (a lower — more
 * restrictive, always allowed); enabling maps back to `draft_for_review` (the
 * safe default, never a raise above a floor since draft_for_review is itself
 * the most permissive value any floor allows). Always `accepted`; audited.
 */
export async function applySkillToggle(
  db: D1Database,
  input: ApplySkillToggleInput
): Promise<ApplyResult> {
  const newValue: Ceiling = input.next_enabled ? 'draft_for_review' : 'refused'
  const direction = changeDirection(input.old_value, newValue)

  await recordConfigChangeAudit(db, {
    customer_slug: input.customer_slug,
    entity_id: input.entity_id,
    actor_user_id: input.actor.user_id,
    actor_email: input.actor.email,
    actor_role: input.actor.role,
    change_type: 'skill_toggle',
    persona_slug: input.persona_slug,
    skill_name: input.skill_name,
    action_class: null,
    old_value: input.old_value,
    new_value: newValue,
    outcome: 'accepted',
    outcome_reason: null,
    direction,
  })

  return { outcome: 'accepted', reason: null }
}

/** Action classes accepted on the action-ceiling path, re-exported for callers. */
export const ACTION_CLASSES: readonly ActionClass[] = ACCEPTED_ACTION_CLASSES

export interface ConfigChangeAuditRow {
  id: number
  created_at: string
  source: string
  actor_email: string
  change_type: ConfigChangeType
  persona_slug: string | null
  skill_name: string | null
  action_class: string | null
  old_value: string | null
  new_value: string | null
  outcome: ConfigChangeOutcome
  outcome_reason: string | null
  direction: ChangeDirection
}

/**
 * Read the most-recent N governance actions for an entity, newest first.
 * Powers the control-plane authority-audit pane (ADR 0030 §4). Read-only.
 */
export async function listConfigChangeAudit(
  db: D1Database,
  entityId: string,
  limit = 50
): Promise<ConfigChangeAuditRow[]> {
  const result = await db
    .prepare(
      'SELECT id, created_at, source, actor_email, change_type, persona_slug, skill_name, ' +
        'action_class, old_value, new_value, outcome, outcome_reason, direction ' +
        'FROM config_change_audit WHERE entity_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'
    )
    .bind(entityId, limit)
    .all<ConfigChangeAuditRow>()
  return result.results ?? []
}
