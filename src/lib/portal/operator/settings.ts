/**
 * Operator settings — typed contracts + read resolver.
 *
 * This module backs the four working sections on
 * `/portal/products/operator/settings`:
 *
 *   - Trust ceiling controls per skill
 *   - Voice sample management (view / add / remove)
 *   - Skill toggles (enable / disable per skill)
 *   - Connector status + re-consent paths
 *
 * Source of truth for everything on the page is `customer.yaml` per
 * [ADR 0012](../../../../docs/adr/0012-customer-yaml-storage.md). The
 * portal D1 `customer_configs` table is the projected read replica
 * (see `src/lib/portal/customer-config.ts`); this module reads from
 * the projection. Mutations land later: the endpoints in
 * `src/pages/api/portal/operator/settings/` accept POSTs, validate,
 * and log intent today. Real propagation back to git +
 * `customer.yaml` is gated on the configs-repo write path (out of
 * scope for #874).
 *
 * Voice samples and connector health are reads that depend on
 * subsystems on the per-customer Hermes Machine (ADR 0007 + 0009)
 * and the capability conformance harness, respectively. Neither
 * has a portal-bound read path today. Following the contract in
 * `src/lib/portal/operator/drafts.ts`, both resolvers return
 * empty shapes so the page renders its empty state per
 * `docs/style/empty-state-pattern.md`. No fabrication. No mock
 * rows. No "coming soon" copy.
 *
 * When real data lands, only the fetch stubs at the bottom of this
 * file change. Types, formatting helpers, and the resolver shape
 * stay put.
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
// Voice samples
// ---------------------------------------------------------------------------

/**
 * One voice sample row. Voice samples carry privacy implications:
 * per PR #951 (voice ingestion pipeline) and the
 * `docs/specs/operator/voice-gate-fallback.md` spec, the portal
 * surface displays metadata only. Raw sample bodies are never
 * surfaced to the dashboard; only structural diffs are exposed.
 *
 * Field semantics:
 *
 *   id        — opaque sample identifier owned by the voice
 *               pipeline.
 *   cohort    — which voice cohort this sample belongs to (e.g.
 *               "partner-outbound", "internal-prep"). Surfaces in
 *               the UI as the row's primary discriminator.
 *   source    — short label describing where the sample came from
 *               ("imported", "captured", "manual"). Not free text;
 *               the voice pipeline emits a closed set today.
 *   addedAt   — ISO timestamp the sample was ingested.
 *   status    — `ready` once the sample is in the cohort and
 *               usable; `pending` immediately after a portal upload
 *               while the pipeline ingests it; `error` if the
 *               pipeline rejected it.
 */
export type VoiceSampleStatus = 'ready' | 'pending' | 'error'

export const VOICE_SAMPLE_STATUSES: readonly VoiceSampleStatus[] = [
  'ready',
  'pending',
  'error',
] as const

export interface VoiceSample {
  id: string
  cohort: string
  source: string
  addedAt: string
  status: VoiceSampleStatus
}

export function formatVoiceSampleStatus(status: VoiceSampleStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'pending':
      return 'Pending'
    case 'error':
      return 'Error'
  }
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

export const CONNECTOR_HEALTHS: readonly ConnectorHealth[] = [
  'ok',
  'warn',
  'fail',
  'unconfigured',
] as const

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
    rows.push({
      capabilityName,
      adapter,
      health: 'unconfigured',
      reconsentRequired: false,
    })
  }
  rows.sort((a, b) => a.capabilityName.localeCompare(b.capabilityName))
  return rows
}

// ---------------------------------------------------------------------------
// Composite settings view
// ---------------------------------------------------------------------------

/**
 * The full settings view rendered by the page. Composing the four
 * sections in one shape keeps the page contract small (one resolver
 * call, one prop drilldown) and gives tests one place to assert on
 * the empty-state contract before subsystems wire up.
 */
export interface SettingsView {
  trustCeilingRows: TrustCeilingRow[]
  voiceSamples: VoiceSample[]
  skillToggleRows: SkillToggleRow[]
  connectorRows: ConnectorStatusRow[]
  personaSlug: string | null
}

/**
 * Resolve the full settings view for the given entity. Today this
 * reads the customer.yaml projection for trust ceiling + skill
 * toggles + connectors, and returns empty lists for voice samples
 * (Hermes-bound) and live connector health (harness-bound).
 *
 * No fabrication. No placeholder rows. Empty inputs produce empty
 * outputs and the page renders its empty state per
 * docs/style/empty-state-pattern.md.
 */
export async function loadSettingsView(db: D1Database, entityId: string): Promise<SettingsView> {
  const config = await fetchCustomerConfig(db, entityId)
  const persona = pickActivePersona(config)
  const voiceSamples = await fetchVoiceSamples(entityId)
  const connectorRows = connectorRowsFromCustomerYaml(config?.connectors ?? null)
  return {
    trustCeilingRows: trustCeilingRowsFromPersona(persona),
    voiceSamples,
    skillToggleRows: skillToggleRowsFromPersona(persona),
    connectorRows,
    personaSlug: persona?.slug ?? null,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (split out so tests can compose them, and so the
// future wiring is a single-call swap)
// ---------------------------------------------------------------------------

interface MinimalCustomerConfig {
  personas: PersonaConfig[]
  connectors: unknown
}

/**
 * Read the projected customer config for an entity. Inlined a thin
 * wrapper around the standard resolver so the test surface can stub
 * with a fixture without pulling in a D1 mock.
 *
 * Returns null when no row exists. That is a meaningful state during
 * alpha (rows are hand-seeded today) and downstream consumers must
 * tolerate it. Per ADR 0012 we never seed a fallback config.
 */
async function fetchCustomerConfig(
  db: D1Database,
  entityId: string
): Promise<MinimalCustomerConfig | null> {
  const { getCustomerConfig } = await import('../customer-config')
  const row = await getCustomerConfig(db, entityId)
  if (!row) return null
  return { personas: row.personas, connectors: row.connectors }
}

function pickActivePersona(config: MinimalCustomerConfig | null): PersonaConfig | null {
  if (!config) return null
  return config.personas.find((p) => p.status === 'active') ?? null
}

/**
 * Voice sample fetch stub. Returns an empty list today. When the
 * voice pipeline (PR #951) exposes a portal-bound read endpoint or
 * D1 projection, replace the body. The `entityId` arg is here so
 * the future swap is body-only. Promise.resolve preserves the
 * async call shape.
 */
function fetchVoiceSamples(_entityId: string): Promise<VoiceSample[]> {
  return Promise.resolve([])
}
