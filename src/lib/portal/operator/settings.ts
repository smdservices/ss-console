/**
 * Operator settings — typed contracts for the config-derived rows the
 * console renders:
 *
 *   - Trust ceiling rows per action class
 *   - Skill toggles (per-persona skill list)
 *   - Connector status rows
 *
 * Source of truth is `customer.yaml` per
 * [ADR 0012](../../../../docs/adr/0012-customer-yaml-storage.md); the
 * portal D1 `customer_configs` table is the projected read replica
 * (see `src/lib/portal/customer-config.ts`) and these helpers shape
 * that projection for the facet resolvers that consume them
 * (overview, skills, connections).
 *
 * Voice-sample management was removed 2026-07-15 (Captain close-out):
 * the portal surface was chrome over a stub — no ingestion wiring
 * existed. Client-voice establishment is its own workstream.
 */

import type { PersonaConfig } from '../customer-config'
import type { ActionClass, AuthoredExposureActionClass } from '../../operator/customer-yaml/types'

// ---------------------------------------------------------------------------
// Trust ceiling
// ---------------------------------------------------------------------------

/**
 * Closed vocabulary for the exposure decision attached to a persona action
 * class. The old exported names are retained for component compatibility while
 * the UI is renamed.
 *
 *   autonomous       — the Operator may execute and send without
 *                      a human reviewer in the loop
 *   draft_for_review — default; the Operator proposes; a reviewer
 *                      must approve and send
 *   refused          — the skill is configured but the Operator
 *                      will refuse to run it
 *
 * The vocabulary is closed because adding a value silently breaks
 * persona-renderer dispatch in both the portal and Hermes. New
 * ceilings require a customer.yaml schema bump.
 */
export type TrustCeilingLevel = 'autonomous' | 'draft_for_review' | 'refused'

export const TRUST_CEILING_LEVELS: readonly TrustCeilingLevel[] = [
  'autonomous',
  'draft_for_review',
  'refused',
] as const

export function isTrustCeilingLevel(value: unknown): value is TrustCeilingLevel {
  return typeof value === 'string' && (TRUST_CEILING_LEVELS as readonly string[]).includes(value)
}

/**
 * Human label for a TrustCeilingLevel. Closed vocabulary; unknown
 * values fall through to the raw value rather than fabricating a
 * friendly label.
 */
export function formatTrustCeilingLevel(level: TrustCeilingLevel): string {
  switch (level) {
    case 'autonomous':
      return 'Autonomous'
    case 'draft_for_review':
      return 'Draft for review'
    case 'refused':
      return 'Refused'
  }
}

/**
 * One row in the trust-ceiling section. Shape mirrors the persona
 * skill entry from customer.yaml, with the ceiling parsed against
 * the closed vocabulary. Unknown ceiling strings render as the raw
 * value so a hand-edited customer.yaml does not silently change
 * runtime behavior.
 */
export interface TrustCeilingRow {
  skillName: string
  currentLevel: TrustCeilingLevel | null
  rawLevel: string
  actionClass: ActionClass
}

/**
 * Project a persona's skill list into trust-ceiling rows. Order is
 * preserved (skills are authored in priority order by the customer
 * principal in customer.yaml).
 */
export function trustCeilingRowsFromPersona(persona: PersonaConfig | null): TrustCeilingRow[] {
  if (!persona) return []
  const classes: AuthoredExposureActionClass[] = [
    'internal_write',
    'external_send',
    'external_send_internal',
    'external_send_client',
    'external_send_vendor',
    'commitment',
    'destructive',
    'code_execution',
  ]
  return classes.map((actionClass) => {
    const level = persona.entitlements.exposure[actionClass]
    return {
      skillName: actionClass,
      currentLevel: isTrustCeilingLevel(level) ? level : null,
      rawLevel: typeof level === 'string' ? level : '',
      actionClass,
    }
  })
}

// ---------------------------------------------------------------------------
// Skill toggles
// ---------------------------------------------------------------------------

/**
 * One skill toggle row. Sourced from the customer's persona skill
 * list — a skill is "enabled" for this customer iff it appears in
 * persona.skills. Initiation modes are displayed separately from exposure.
 *
 *   skillName       — slug from `operator/skills/<name>/SKILL.md`
 *   enabled         — true when the persona configures the skill
 *                     and its ceiling is not `refused`
 *   trustCeiling    — current ceiling (or null when the persona's
 *                     ceiling does not match the closed vocabulary)
 */
export interface SkillToggleRow {
  skillName: string
  enabled: boolean
  trustCeiling: TrustCeilingLevel | null
}

export function skillToggleRowsFromPersona(persona: PersonaConfig | null): SkillToggleRow[] {
  if (!persona) return []
  return persona.skills.map((s) => ({
    skillName: s.name,
    enabled: true,
    trustCeiling: null,
  }))
}

// ---------------------------------------------------------------------------
// Connector status
// ---------------------------------------------------------------------------

/**
 * Closed vocabulary for the capability conformance harness's
 * `health_check()` result. `ok` means the connector authenticated
 * and the latest probe round-tripped. `warn` is a degraded but
 * functional state (quota near limit, partial scope grant). `fail`
 * is unauthenticated or unreachable. `unconfigured` is the
 * customer.yaml shape: the capability is named in `connectors:`
 * but no health check has run yet. See
 * `docs/specs/operator/capability-contracts.md`.
 */
export type ConnectorHealth = 'ok' | 'warn' | 'fail' | 'unconfigured'

export function formatConnectorHealth(health: ConnectorHealth): string {
  switch (health) {
    case 'ok':
      return 'OK'
    case 'warn':
      return 'Warn'
    case 'fail':
      return 'Fail'
    case 'unconfigured':
      return 'Unconfigured'
  }
}

/**
 * One connector row.
 *
 *   capabilityName    — closed-union value from CapabilityName
 *                       (e.g. `Email`, `PracticeManagement`,
 *                       `Calendar`). Reads straight from
 *                       customer.yaml's `connectors:` map keys.
 *   adapter           — adapter slug (e.g. `filevine`,
 *                       `microsoft-graph`).
 *   health            — current health from the conformance
 *                       harness. `unconfigured` when no probe has
 *                       run yet.
 *   reconsentRequired — true when the harness has signaled the
 *                       customer needs to re-grant scope (token
 *                       expired or revoked). Drives a
 *                       "Re-authorize" affordance in the UI.
 */
export interface ConnectorStatusRow {
  capabilityName: string
  adapter: string
  /** Authored `auth_mode` (e.g. 'authorization_code') — decides whether SMD
   *  can re-establish the connection alone or the firm must approve a fresh
   *  authorization. Null when not authored. */
  authMode: string | null
  health: ConnectorHealth
  reconsentRequired: boolean
}

/**
 * Shape of the `connectors:` map in customer.yaml after JSON parse.
 * Modeled loosely because the projection stores it as `unknown` and
 * we cannot rely on schema validation having run inside the portal.
 */
interface ConnectorYamlEntry {
  adapter?: unknown
}

/**
 * Project the customer.yaml `connectors:` map into a connector row
 * list. The health for every connector is `unconfigured` today
 * because the conformance harness has not yet been wired to the
 * portal Worker; PR #949 (Filevine) and #822 (Microsoft Graph) own
 * the upstream connector binding. When the harness lands, swap
 * `loadConnectorHealth` below; the row shape and rendering stay.
 */
export function connectorRowsFromCustomerYaml(connectorsYaml: unknown): ConnectorStatusRow[] {
  if (!connectorsYaml || typeof connectorsYaml !== 'object') return []
  const entries = Object.entries(connectorsYaml as Record<string, unknown>)
  const rows: ConnectorStatusRow[] = []
  for (const [capabilityName, raw] of entries) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as ConnectorYamlEntry
    const adapter = typeof entry.adapter === 'string' ? entry.adapter : ''
    const authModeRaw = (entry as Record<string, unknown>)['auth_mode']
    rows.push({
      capabilityName,
      adapter,
      authMode: typeof authModeRaw === 'string' ? authModeRaw : null,
      health: 'unconfigured',
      reconsentRequired: false,
    })
  }
  rows.sort((a, b) => a.capabilityName.localeCompare(b.capabilityName))
  return rows
}

// ---------------------------------------------------------------------------
// Composite settings view — REMOVED (2026-07-15, Captain close-out of inert
// voice chrome). `loadSettingsView` had no callers; it existed to carry a
// voice-samples list whose fetch was a stub returning [] and whose portal
// endpoint only logged intent. Real voice-sample ingestion is the #1851 /
// voice-establishment workstream; nothing renders sample chrome until the
// wiring exists (feedback: never build the chrome ahead of the wiring).
// The live exports above (trust ceilings, skill toggles, connectors) are
// consumed by the facet resolvers and remain.
// ---------------------------------------------------------------------------
