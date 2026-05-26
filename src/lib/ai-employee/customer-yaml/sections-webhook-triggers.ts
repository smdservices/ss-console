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

import type {
  CapabilityName,
  Connector,
  Persona,
  ValidationError,
  WebhookTrigger,
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

function collectAdapterSlugs(connectors: Partial<Record<CapabilityName, Connector>>): Set<string> {
  const out = new Set<string>()
  for (const c of Object.values(connectors)) {
    if (c && c.webhook_url !== null) {
      out.add(c.adapter)
    }
  }
  return out
}

function indexPersonas(personas: Persona[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const p of personas) {
    const skillNames = new Set<string>()
    for (const s of p.skills) {
      if (s.enabled) skillNames.add(s.name)
    }
    out.set(p.slug, skillNames)
  }
  return out
}

function checkOneTrigger(
  raw: unknown,
  path: string,
  adapterSlugs: Set<string>,
  personaIndex: Map<string, Set<string>>,
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
  if (!skillSet.has(skill)) {
    errors.push({
      code: 'UnknownWebhookSkill',
      path: `${path}.skill`,
      message: `webhook_triggers.skill "${skill}" is not an enabled skill on persona "${persona}"`,
    })
    return null
  }
  return { source, event_type: eventType, skill, persona }
}

function checkTriggerString(raw: unknown, path: string, errors: ValidationError[]): string | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    errors.push({ code: 'MissingField', path, message: `${path} is required` })
    return null
  }
  return raw
}
