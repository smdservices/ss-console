/**
 * Configure surface model (client-portal §5.6). Read-side helpers for the
 * skills / governance / voice / scope / hours sub-domains. Pure — no I/O.
 *
 * Governance is rendered on the ACTION-CLASS model (ADR 0025), not the legacy
 * per-skill scalar. At launch every config domain is Read + Request, so this
 * surface shows the non-raisable vertical FLOORS (the hard stops the client
 * can never cross) per action class — the accurate, always-available half of
 * the model. The per-action configured ceilings surface when the projection
 * carries persona exposure and the configuration/trust switch is flipped
 * operable. Until then the runtime treats an unconfigured action class as
 * fail-closed (refused) — never "drafts for review" (ADR 0035 landmine).
 */

import { getVerticalFloor, type Ceiling } from './config-governance'
import {
  ACCEPTED_ACTION_CLASSES,
  OUTBOUND_ROSTER_CLASSES,
  type ActionClass,
  type OutboundRosterClass,
  type OutboundRosterEntry,
  type Scope,
  type BusinessHours,
} from '../../operator/customer-yaml/types'

export const ACTION_CLASS_LABEL: Record<ActionClass, string> = {
  read: 'Read',
  internal_write: 'Internal write',
  external_send: 'External send (outside)',
  external_send_internal: 'Internal send (staff)',
  external_send_client: 'Client send',
  external_send_vendor: 'Records-vendor send',
  commitment: 'Commitment',
  destructive: 'Destructive',
  code_execution: 'Code execution',
}

export interface GovernanceFloorRow {
  actionClass: ActionClass
  label: string
  /** The non-raisable floor for this action class, or null when none applies. */
  floor: Ceiling | null
}

/**
 * The action-class governance rows: every action class with its vertical floor.
 * A null floor means the vertical sets no hard stop for that class (the client,
 * once operable, may set any ceiling); a non-null floor is the hard stop the
 * client cannot raise above. No vertical currently declares one (the law-firm
 * external_send floor was removed 2026-07, ADR 0073).
 */
export function buildGovernanceFloorRows(vertical: string | null): GovernanceFloorRow[] {
  return ACCEPTED_ACTION_CLASSES.map((ac) => ({
    actionClass: ac,
    label: ACTION_CLASS_LABEL[ac],
    floor: getVerticalFloor(vertical, ac),
  }))
}

export function formatCeiling(c: Ceiling): string {
  return c === 'autonomous'
    ? 'Autonomous'
    : c === 'confirm'
      ? 'Confirm'
      : c === 'draft_for_review'
        ? 'Draft for review'
        : 'Refused'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Parse the projected `scope` blob into a Scope, or null when absent/malformed. */
export function parseScope(raw: unknown): Scope | null {
  if (!isRecord(raw)) return null
  return {
    email_folders_visible: strArray(raw['email_folders_visible']),
    email_folders_blind: strArray(raw['email_folders_blind']),
    email_keyword_blocks: strArray(raw['email_keyword_blocks']),
    domain_blocks: strArray(raw['domain_blocks']),
    matter_blocks: strArray(raw['matter_blocks']),
    inbound_allow_from: strArray(raw['inbound_allow_from']),
    outbound_roster: parseOutboundRoster(raw['outbound_roster']),
    admins: strArray(raw['admins']),
  }
}

/**
 * Read-side parser for the projected `outbound_roster` (ADR 0075). Lenient:
 * keeps only well-formed entries (a non-empty address string + a class in the
 * closed vocabulary), so a hand-edited or partial projection renders its valid
 * rows and silently drops malformed ones. The authoring-time validator is the
 * strict gate; this is display-only.
 */
function parseOutboundRoster(raw: unknown): OutboundRosterEntry[] {
  if (!Array.isArray(raw)) return []
  const out: OutboundRosterEntry[] = []
  for (const e of raw) {
    if (!isRecord(e)) continue
    const address = e['address']
    const cls = e['class']
    if (typeof address !== 'string' || address.length === 0) continue
    if (typeof cls !== 'string' || !(OUTBOUND_ROSTER_CLASSES as readonly string[]).includes(cls)) {
      continue
    }
    const entry: OutboundRosterEntry = { address, class: cls as OutboundRosterClass }
    const note = e['note']
    if (typeof note === 'string') entry.note = note
    out.push(entry)
  }
  return out
}

/** Parse the projected `business_hours` blob, or null when absent/malformed. */
export function parseBusinessHours(raw: unknown): BusinessHours | null {
  if (!isRecord(raw)) return null
  const timezone = typeof raw['timezone'] === 'string' ? raw['timezone'] : null
  const start = typeof raw['start'] === 'string' ? raw['start'] : null
  const end = typeof raw['end'] === 'string' ? raw['end'] : null
  if (timezone === null || start === null || end === null) return null
  return { timezone, days: strArray(raw['days']), start, end }
}
