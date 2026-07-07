/**
 * Client-language allowlist for Operator activity (portal IA rebuild,
 * Captain decision 7, 2026-07-07): clients see curated human-language
 * summaries only. Raw runtime vocabulary ("INVARIANT_VIOLATION",
 * "LLM_TURN_COMPLETED") never renders on a client surface.
 *
 * Every raw action string is either MAPPED (has authored client copy) or
 * SUPPRESSED (renders nothing). The exhaustiveness test in
 * activity-language.test.ts asserts that every member of
 * AUDIT_ACTION_TYPES appears in exactly one of the two sets, so a new
 * writer-side action forces a deliberate client-language decision at
 * merge time. Unknown strings the runtime emits beyond the enum (e.g.
 * LLM_TURN_COMPLETED) are implicitly suppressed by the absent-key rule.
 *
 * Copy rules: authored template sentences describing SHIPPED system
 * behavior only; entry.skill / entry.target / entry.reason are real data
 * and may be interpolated; nothing is invented (anti-fabrication policy).
 * The admin console keeps the raw vocabulary via formatAuditAction; a
 * guard test bans that function from client surfaces.
 */

import type { AuditEntry } from './audit'

export interface ClientActivityCategory {
  /** Stable filter value used in URLs. */
  key: string
  /** Human label for the filter control. */
  label: string
  /** Raw action types this bucket absorbs. */
  actions: readonly string[]
}

export const CLIENT_ACTIVITY_CATEGORIES: readonly ClientActivityCategory[] = [
  {
    key: 'drafts',
    label: 'Drafts and replies',
    actions: [
      'DRAFT_CREATED',
      'DRAFT_APPROVED',
      'DRAFT_REJECTED',
      'DRAFT_EXPIRED',
      'REPLY_SENT',
      'REPLY_HELD',
    ],
  },
  {
    key: 'escalations',
    label: 'Escalations',
    actions: ['ESCALATION_FIRED', 'ESCALATION_ACKNOWLEDGED'],
  },
  {
    key: 'status',
    label: 'Operator status',
    actions: ['AGENT_STOPPED', 'AGENT_RESUMED'],
  },
  {
    key: 'configuration',
    label: 'Configuration',
    actions: [
      'SKILL_ENABLED',
      'SKILL_DISABLED',
      'TRUST_PROMOTED',
      'TRUST_DEMOTED',
      'SCOPE_CHANGED',
    ],
  },
  {
    key: 'connections',
    label: 'Connections',
    actions: [
      'CONNECTOR_BOUND',
      'CONNECTOR_UNBOUND',
      'CONNECTOR_AUTH_EXPIRED',
      'CONNECTOR_AUTH_RESTORED',
    ],
  },
  {
    key: 'compliance',
    label: 'Compliance',
    actions: ['COMPLIANCE_PACKET_EXPORTED'],
  },
] as const

/**
 * Raw actions that deliberately render NOTHING on client surfaces:
 * internal telemetry, safety substrate, mirrors, and lifecycle plumbing.
 * Kept as an explicit set (not "everything else") so the exhaustiveness
 * test can prove every writer-side action was consciously placed.
 */
export const SUPPRESSED_ACTIONS: ReadonlySet<string> = new Set([
  'MEMORY_RULE_ADDED',
  'MEMORY_RULE_EDITED',
  'MEMORY_RULE_DELETED',
  'CONNECTOR_TOKEN_REFRESHED',
  'CONNECTOR_HEALTH_PROBE_FAILED',
  'INVARIANT_VIOLATION',
  'INVARIANT_BOOT_CHECK_FAILED',
  'RBAC_EVENT',
  'VOICE_GATE_PASSED',
  'VOICE_GATE_NEAR_PASS',
  'VOICE_GATE_FAILED',
  'FABRICATION_FILTER_TRIGGERED',
  'IDENTIFIER_UNVERIFIED',
  'INBOUND_RECEIVED',
  'HONCHO_CONCLUSION_DISMISSED',
  'AGENT_SKILL_CREATED',
  'AGENT_SKILL_REMOVED',
  'CUSTOMER_YAML_SYNCED',
  'CUSTOMER_YAML_STRUCTURAL_CHANGE_DEFERRED',
  'SUBAGENT_STOPPED',
  'SUBAGENT_INCOMPLETE',
  'SUPPRESSED_WAKE',
  'REPLY_FAILED',
  'DECOMMISSION_INITIATED',
  'DECOMMISSION_DRAIN_COMPLETE',
  'DECOMMISSION_STEP_BEGIN',
  'DECOMMISSION_STEP_COMPLETE',
  'DECOMMISSION_STEP_FAILED',
  'DECOMMISSION_FINAL',
])

type SummaryBuilder = (entry: AuditEntry) => string

const withSkill = (base: string) => (entry: AuditEntry) =>
  entry.skill ? `${base}: ${entry.skill}` : base

const CLIENT_LANGUAGE: Record<string, SummaryBuilder> = {
  DRAFT_CREATED: withSkill('Prepared a draft for your review'),
  DRAFT_APPROVED: () => 'A draft was approved and sent',
  DRAFT_REJECTED: () => 'A draft was declined',
  DRAFT_EXPIRED: () => 'A draft expired without review',
  REPLY_SENT: () => 'Replied to a message',
  REPLY_HELD: () => 'Held a reply for your review',
  ESCALATION_FIRED: (e) => e.reason ?? 'Flagged something for your attention',
  ESCALATION_ACKNOWLEDGED: () => 'An escalation was acknowledged',
  AGENT_STOPPED: () => 'Your operator was paused',
  AGENT_RESUMED: () => 'Your operator resumed work',
  SKILL_ENABLED: withSkill('A skill was turned on'),
  SKILL_DISABLED: withSkill('A skill was turned off'),
  TRUST_PROMOTED: withSkill('An approval level was raised'),
  TRUST_DEMOTED: withSkill('An approval level was lowered'),
  CONNECTOR_BOUND: (e) => (e.target ? `Connected ${e.target}` : 'Connected a system'),
  CONNECTOR_UNBOUND: (e) => (e.target ? `Disconnected ${e.target}` : 'Disconnected a system'),
  CONNECTOR_AUTH_EXPIRED: () => 'A connection needs re-authorization',
  CONNECTOR_AUTH_RESTORED: () => 'A connection was restored',
  SCOPE_CHANGED: () => 'Working scope was updated',
  COMPLIANCE_PACKET_EXPORTED: () => 'A compliance export was produced',
}

/** Raw action strings with authored client copy. */
export const MAPPED_ACTIONS: readonly string[] = Object.keys(CLIENT_LANGUAGE)

/**
 * The action filter to push into the runtime read (SQL-side) so a chatty
 * agent's suppressed noise cannot starve client feeds to emptiness.
 */
export function mappedActionsForCategories(categoryKeys: readonly string[]): string[] {
  if (categoryKeys.length === 0) return [...MAPPED_ACTIONS]
  const wanted = new Set(categoryKeys)
  return CLIENT_ACTIVITY_CATEGORIES.filter((c) => wanted.has(c.key)).flatMap((c) => [...c.actions])
}

export interface ClientActivityLine {
  id: string
  at: string
  summary: string
  categoryKey: string
}

const ACTION_TO_CATEGORY: ReadonlyMap<string, string> = new Map(
  CLIENT_ACTIVITY_CATEGORIES.flatMap((c) => c.actions.map((a) => [a, c.key] as const))
)

/** Map raw entries to client lines; unmapped entries are DROPPED. */
export function toClientActivity(entries: readonly AuditEntry[]): ClientActivityLine[] {
  const lines: ClientActivityLine[] = []
  for (const entry of entries) {
    const build = CLIENT_LANGUAGE[entry.action]
    if (!build) continue
    lines.push({
      id: entry.id,
      at: entry.ts,
      summary: build(entry),
      categoryKey: ACTION_TO_CATEGORY.get(entry.action) ?? 'other',
    })
  }
  return lines
}

/** Options for the client-facing activity filter control. */
export function clientActivityFilterOptions(): { value: string; label: string }[] {
  return CLIENT_ACTIVITY_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))
}
