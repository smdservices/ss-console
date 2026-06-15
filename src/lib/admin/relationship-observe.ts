/**
 * Relationship-surface view-model for the admin Operator console
 * (`/admin/operator/[customer]/memory`) — ADR 0048.
 *
 * The Operator's working relationship with a person is a *composition* of lanes
 * (ADR 0048). This module loads the deterministic **style lane** — the taught
 * style corrections in `voice_corrections` (migration 0010) — across the
 * isolation boundary via the frozen `memory_export` read path (ADR 0043 path A).
 *
 * Same fail-closed discipline as runtime-observe: when the read path is not
 * configured we return `not_enabled` WITHOUT a read (no audit noise on a dark
 * feature); otherwise we read and classify honestly (unreachable / empty /
 * items). The inferred lane (`persona_observations` / Honcho) is deferred
 * (ADR 0016); the authored lane (`customer.yaml`) is the page's concern. This
 * module owns only the style-lane read and a **defensive parse** of the opaque
 * row payload — never a cast (coding-standards: parse external inputs).
 */

import {
  readMachineRuntime,
  type MachineRuntimeTransport,
  type RuntimeReadAudit,
  type RuntimeReadActor,
} from '../operator/runtime-read'

/** One taught style correction (an active `voice_corrections` row). */
export interface StyleCorrection {
  /** 'greeting' | 'signoff' | 'honorific' | 'lexical' (migration 0010). */
  correctionKind: string
  beforePattern: string
  afterText: string
  /** 'live_edit' (learned from an edit) | 'calibration_session' (authored). */
  source: string
  /** Scope: null = firm-wide / all cohorts. */
  reviewerUserId: string | null
  recipientCohort: string | null
}

export type StyleLaneResult =
  | { status: 'not_enabled' }
  | { status: 'unreachable'; reason: string }
  | { status: 'empty' }
  | { status: 'items'; corrections: StyleCorrection[] }

interface RuntimeReadDeps {
  transport: MachineRuntimeTransport
  audit: RuntimeReadAudit
}

/**
 * Load the style lane (taught corrections) for one customer. Mirrors
 * `loadRuntimeView`: no read (and no audit row) when the path is unconfigured;
 * otherwise reads `memory_export?table=voice_corrections` via the fail-closed
 * seam and classifies the outcome.
 */
export async function loadStyleLane(
  deps: RuntimeReadDeps,
  customerSlug: string,
  actor: RuntimeReadActor,
  configured: boolean
): Promise<StyleLaneResult> {
  if (!configured) return { status: 'not_enabled' }
  const result = await readMachineRuntime(
    deps,
    customerSlug,
    { kind: 'memory_export', table: 'voice_corrections' },
    actor
  )
  if (!result.ok) return { status: 'unreachable', reason: result.reason }
  const corrections = parseStyleCorrections(result.data)
  return corrections.length === 0 ? { status: 'empty' } : { status: 'items', corrections }
}

/**
 * Parse the opaque `memory_export` payload (`{ entries: [...] }`) into active
 * style corrections. Defensive by construction: every field is checked, never
 * cast; a row missing a required field, or one that has been superseded, is
 * skipped rather than rendered half-formed.
 */
export function parseStyleCorrections(data: unknown): StyleCorrection[] {
  const out: StyleCorrection[] = []
  for (const entry of extractEntries(data)) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    // Active only: a superseded correction was overridden by a newer/more-specific
    // one (migration 0010 supersession chain) and must not be shown as current.
    if (row.superseded_by != null) continue
    const correctionKind = asNonEmptyString(row.correction_kind)
    const beforePattern = asString(row.before_pattern)
    const afterText = asString(row.after_text)
    const source = asNonEmptyString(row.source)
    if (
      correctionKind === null ||
      beforePattern === null ||
      afterText === null ||
      source === null
    ) {
      continue
    }
    out.push({
      correctionKind,
      beforePattern,
      afterText,
      source,
      reviewerUserId: asStringOrNull(row.reviewer_user_id),
      recipientCohort: asStringOrNull(row.recipient_cohort),
    })
  }
  return out
}

/** One authored person on the standing-preferences (authored behavioral) lane —
 * a `relationship.people[]` entry served by `config_export?section=relationship`
 * (ADR 0048). */
export interface StandingPreferencePerson {
  id: string
  name: string
  role: string | null
  prefers: string[]
  avoid: string[]
}

export type StandingPreferencesResult =
  | { status: 'not_enabled' }
  | { status: 'unreachable'; reason: string }
  | { status: 'empty' }
  | { status: 'items'; people: StandingPreferencePerson[] }

/**
 * Load the standing-preferences lane (authored `relationship:` block) for one
 * customer. Mirrors {@link loadStyleLane}: no read (and no audit row) when the
 * seam is unconfigured; otherwise reads `config_export?section=relationship`
 * via the fail-closed seam and classifies the outcome. The Machine serves the
 * live `customer.yaml` block normalized to the closed-set fields, so this is the
 * truth the running Operator works from — not a possibly-stale console copy.
 */
export async function loadStandingPreferences(
  deps: RuntimeReadDeps,
  customerSlug: string,
  actor: RuntimeReadActor,
  configured: boolean
): Promise<StandingPreferencesResult> {
  if (!configured) return { status: 'not_enabled' }
  const result = await readMachineRuntime(
    deps,
    customerSlug,
    { kind: 'config_export', section: 'relationship' },
    actor
  )
  if (!result.ok) return { status: 'unreachable', reason: result.reason }
  const people = parseStandingPreferences(result.data)
  return people.length === 0 ? { status: 'empty' } : { status: 'items', people }
}

/**
 * Parse the opaque `config_export` payload (`{ entries: [...] }`) into authored
 * people. Defensive by construction: id and name are required (a row missing
 * either is skipped rather than half-rendered); role/prefers/avoid normalize to
 * `null`/`[]`; non-string list items are dropped. (The Machine already
 * normalizes to the closed set, but the console never trusts the wire shape —
 * coding-standards: parse external inputs, never cast.)
 */
export function parseStandingPreferences(data: unknown): StandingPreferencePerson[] {
  const out: StandingPreferencePerson[] = []
  for (const entry of extractEntries(data)) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const id = asNonEmptyString(row.id)
    const name = asNonEmptyString(row.name)
    if (id === null || name === null) continue
    out.push({
      id,
      name,
      role: asStringOrNull(row.role),
      prefers: asStringList(row.prefers),
      avoid: asStringList(row.avoid),
    })
  }
  return out
}

/** Pull the row list from the seam payload shape (`{ entries: [...] }`). */
function extractEntries(data: unknown): unknown[] {
  if (data && typeof data === 'object') {
    const entries = (data as { entries?: unknown }).entries
    if (Array.isArray(entries)) return entries
  }
  return []
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Coerce an unknown to a list of non-empty strings, dropping anything else. */
function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((item): item is string => typeof item === 'string' && item.length > 0)
}
