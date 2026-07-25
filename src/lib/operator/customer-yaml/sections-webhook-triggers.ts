/**
 * Top-level `webhook_triggers:` validator. ADR 0021 Stream E.
 *
 * Each trigger maps an inbound webhook payload (delivered to a connector's
 * `webhook_url` from Stream E) to a specific (persona, skill) invocation
 * via the overlay's `hermes-smd-webhook-router` plugin
 * (pre_gateway_dispatch hook).
 *
 * Validation is cross-section: the trigger's `source` must match a
 * configured connector's adapter slug, and the `persona`/`skill` pair
 * must reference real declarations on this customer. The validator
 * receives the already-validated personas and connectors so the lookup
 * never opens a hole for inconsistent intermediate states.
 *
 * Source-adapter coupling rationale: a trigger whose source has no
 * webhook_url configured will never fire, so we flag it at authoring time
 * rather than waiting for runtime silence. Stream-E connectors set both
 * webhook_url and trigger entries together; either-without-the-other is
 * almost always a typo.
 */

import type { CapabilityName } from '../capabilities/types'
import type {
  Connector,
  Persona,
  ValidationError,
  WebhookTrigger,
  WebhookTriggerExclude,
  WebhookTriggerThrottle,
} from './types'
import { isPlainObject } from './helpers'

export function checkWebhookTriggers(
  root: Record<string, unknown>,
  personas: Persona[],
  connectors: Partial<Record<CapabilityName, Connector>>,
  errors: ValidationError[]
): WebhookTrigger[] {
  const raw = root['webhook_triggers']
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'webhook_triggers',
      message: 'webhook_triggers must be a list when present',
    })
    return []
  }
  const adapterSlugs = collectAdapterSlugs(connectors)
  const personaIndex = indexPersonas(personas)
  const out: WebhookTrigger[] = []
  for (let i = 0; i < raw.length; i++) {
    const trig = checkOneTrigger(
      raw[i],
      `webhook_triggers[${i}]`,
      adapterSlugs,
      personaIndex,
      errors
    )
    if (trig !== null) out.push(trig)
  }
  return out
}

// Adapters whose inbound is driven by a POLLER, not a registered webhook_url.
// They legitimately carry no webhook_url but are still valid webhook_triggers
// sources: the delta poller injects each new message through the same
// gate→router loopback that a push webhook uses, so fence/taint/roster apply
// identically (ADR 0078 / email-channel-seam D1 — msgraph).
const POLL_DRIVEN_INBOUND_ADAPTERS: ReadonlySet<string> = new Set(['msgraph'])

function collectAdapterSlugs(connectors: Partial<Record<CapabilityName, Connector>>): Set<string> {
  const out = new Set<string>()
  for (const c of Object.values(connectors)) {
    if (!c) continue
    // A connector is a valid inbound source either via a registered webhook_url
    // (push) or as a poll-driven adapter (the poller is its inbound driver).
    if (c.webhook_url !== null || POLL_DRIVEN_INBOUND_ADAPTERS.has(c.adapter)) {
      out.add(c.adapter)
    }
  }
  return out
}

function indexPersonas(personas: Persona[]): Map<string, Map<string, boolean>> {
  const out = new Map<string, Map<string, boolean>>()
  for (const p of personas) {
    const skillNames = new Map<string, boolean>()
    for (const s of p.skills) {
      if (s.enabled) skillNames.set(s.name, s.initiation.webhook)
    }
    out.set(p.slug, skillNames)
  }
  return out
}

function checkOneTrigger(
  raw: unknown,
  path: string,
  adapterSlugs: Set<string>,
  personaIndex: Map<string, Map<string, boolean>>,
  errors: ValidationError[]
): WebhookTrigger | null {
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: 'webhook_triggers entries must be objects' })
    return null
  }
  const source = checkTriggerString(raw['source'], `${path}.source`, errors)
  const eventType = checkTriggerString(raw['event_type'], `${path}.event_type`, errors)
  const skill = checkTriggerString(raw['skill'], `${path}.skill`, errors)
  const persona = checkTriggerString(raw['persona'], `${path}.persona`, errors)
  if (source === null || eventType === null || skill === null || persona === null) return null

  if (!adapterSlugs.has(source)) {
    errors.push({
      code: 'UnknownWebhookSource',
      path: `${path}.source`,
      message:
        `webhook_triggers.source "${source}" does not match any connector adapter with ` +
        'webhook_url configured — either add webhook_url to the connector or drop the trigger',
    })
    return null
  }
  const skillSet = personaIndex.get(persona)
  if (skillSet === undefined) {
    errors.push({
      code: 'UnknownWebhookPersona',
      path: `${path}.persona`,
      message: `webhook_triggers.persona "${persona}" does not match any declared persona slug`,
    })
    return null
  }
  const webhookAllowed = skillSet.get(skill)
  if (webhookAllowed === undefined) {
    errors.push({
      code: 'UnknownWebhookSkill',
      path: `${path}.skill`,
      message: `webhook_triggers.skill "${skill}" is not an enabled skill on persona "${persona}"`,
    })
    return null
  }
  if (!webhookAllowed) {
    errors.push({
      code: 'UnknownWebhookSkill',
      path: `${path}.skill`,
      message:
        `webhook_triggers.skill "${skill}" is enabled on persona "${persona}" ` +
        'but does not grant initiation.webhook',
    })
    return null
  }
  const exclude = checkTriggerExclude(raw['exclude'], `${path}.exclude`, errors)
  if (exclude === undefined) return null
  const throttle = checkTriggerThrottle(raw['throttle'], `${path}.throttle`, errors)
  if (throttle === undefined) return null
  return { source, event_type: eventType, skill, persona, exclude, throttle }
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Parse the optional authored exception block. Returns null when absent
 * (no exceptions), the parsed block when valid, or `undefined` on a
 * validation error (the caller drops the trigger — a typo here must fail
 * authoring loudly, because the runtime gate deliberately fails OPEN).
 */
function checkTriggerExclude(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): WebhookTriggerExclude | null | undefined {
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: 'exclude must be an object when present' })
    return undefined
  }
  const known = ['matters', 'actors']
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) {
      errors.push({
        code: 'TypeMismatch',
        path: `${path}.${key}`,
        message: `unknown exclude key "${key}" (known: ${known.join(', ')})`,
      })
      return undefined
    }
  }
  const lists: Record<'matters' | 'actors', string[]> = { matters: [], actors: [] }
  for (const key of ['matters', 'actors'] as const) {
    const val = raw[key]
    if (val === undefined || val === null) continue
    if (!Array.isArray(val) || !val.every((v) => typeof v === 'string' && GUID_RE.test(v))) {
      errors.push({
        code: 'TypeMismatch',
        path: `${path}.${key}`,
        message: `${key} must be a list of vendor GUIDs`,
      })
      return undefined
    }
    lists[key] = val
  }
  if (lists.matters.length === 0 && lists.actors.length === 0) {
    errors.push({
      code: 'TypeMismatch',
      path,
      message: 'exclude must name at least one matter or actor when present',
    })
    return undefined
  }
  return { matters: lists.matters, actors: lists.actors }
}

/**
 * Parse the optional per-trigger cooldown block (#1781). Returns null when
 * absent (the overlay gate applies its platform default), the parsed block
 * when valid, or `undefined` on a validation error (the caller drops the
 * trigger). A typo here must fail authoring loudly: the runtime resolver
 * deliberately falls back to the platform default on a malformed block, so a
 * silently-accepted typo would silently replace the authored intent.
 * Mirrors the overlay validator (`bootstrap/validate.py`
 * `_validate_trigger_throttle`) — parity pinned by the fixtures contract.
 */
function checkTriggerThrottle(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): WebhookTriggerThrottle | null | undefined {
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: 'throttle must be an object when present' })
    return undefined
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'cooldown_minutes') {
      errors.push({
        code: 'TypeMismatch',
        path: `${path}.${key}`,
        message: `unknown throttle key "${key}" (known: cooldown_minutes)`,
      })
      return undefined
    }
  }
  const minutes = raw['cooldown_minutes']
  if (minutes === undefined || minutes === null) return { cooldown_minutes: null }
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0) {
    errors.push({
      code: 'TypeMismatch',
      path: `${path}.cooldown_minutes`,
      message: 'cooldown_minutes must be a non-negative integer (0 disables the throttle)',
    })
    return undefined
  }
  return { cooldown_minutes: minutes }
}

function checkTriggerString(raw: unknown, path: string, errors: ValidationError[]): string | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    errors.push({ code: 'MissingField', path, message: `${path} is required` })
    return null
  }
  return raw
}
