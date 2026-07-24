/**
 * `google_auth` section validator — selects the Google credential mode for the
 * customer's Operator (ADR 0035; connector dispatch shipped in ss-console
 * #1212, boot wiring #1213).
 *
 * Optional block. Absent ⇒ user-OAuth (today's behavior): the connectors read
 * an authorized-user token relayed to `/opt/data/oauth/google.json`, and
 * nothing is materialized. When present with `mode: dwd`, the Operator uses a
 * service-account key with domain-wide delegation, impersonating `subject` at
 * the authored `scopes`; bootstrap exports `GOOGLE_IMPERSONATE_SUBJECT` +
 * `GOOGLE_OAUTH_SCOPES` so the connector's service-account branch activates.
 *
 * Modeled at the top level (not per-connector) because one Google identity is
 * shared across Gmail (inbox-triage), Calendar, and Drive — and Gmail is not a
 * `connectors[]` entry. Fail-closed: `mode: dwd` requires a `subject` and a
 * non-empty `scopes` list (a partial DWD block is a hard error, never a silent
 * fallback to user-OAuth — the same fail-closed posture the connector enforces).
 */

import {
  ACCEPTED_GOOGLE_AUTH_MODES,
  type GoogleAuth,
  type ManagedMailbox,
  type ValidationError,
} from './types'
import { isPlainObject } from './helpers'

export function checkGoogleAuth(
  root: Record<string, unknown>,
  errors: ValidationError[]
): GoogleAuth | null {
  const raw = root['google_auth']
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'google_auth',
      message: 'google_auth must be an object when present',
    })
    return null
  }
  const mode = raw['mode']
  if (
    typeof mode !== 'string' ||
    !(ACCEPTED_GOOGLE_AUTH_MODES as readonly string[]).includes(mode)
  ) {
    errors.push({
      code: 'EnumViolation',
      path: 'google_auth.mode',
      message: `google_auth.mode must be one of: ${ACCEPTED_GOOGLE_AUTH_MODES.join(', ')}`,
    })
    return null
  }
  if (mode === 'user_oauth') {
    // user-OAuth needs no authored subject/scopes — the relayed token carries them.
    return { mode, subject: null, scopes: [], managed_mailboxes: [] }
  }
  return checkDwd(raw, errors)
}

function checkDwd(raw: Record<string, unknown>, errors: ValidationError[]): GoogleAuth | null {
  const subject = raw['subject']
  const scopes = raw['scopes']
  let ok = true
  if (typeof subject !== 'string' || !subject.includes('@')) {
    errors.push({
      code: 'InvalidFormat',
      path: 'google_auth.subject',
      message: 'google_auth.subject must be the email address to impersonate when mode is "dwd"',
    })
    ok = false
  }
  if (
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    !scopes.every((s) => typeof s === 'string')
  ) {
    errors.push({
      code: 'EmptyList',
      path: 'google_auth.scopes',
      message:
        'google_auth.scopes must be a non-empty list of OAuth scope strings when mode is "dwd"',
    })
    ok = false
  }
  const managed = checkManagedMailboxes(raw['managed_mailboxes'], errors)
  if (managed === null) ok = false
  if (!ok) return null
  return {
    mode: 'dwd',
    subject: subject as string,
    scopes: scopes as string[],
    managed_mailboxes: managed ?? [],
  }
}

/**
 * Validate the optional `google_auth.managed_mailboxes` list (fail-closed):
 * absent ⇒ `[]`; present-but-malformed ⇒ a hard error (return null) so a partial
 * managed-mailbox block never silently degrades the authored authority surface.
 */
function checkManagedMailboxes(raw: unknown, errors: ValidationError[]): ManagedMailbox[] | null {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'google_auth.managed_mailboxes',
      message: 'google_auth.managed_mailboxes must be a list when present',
    })
    return null
  }
  const out: ManagedMailbox[] = []
  let ok = true
  for (let i = 0; i < raw.length; i++) {
    const mb = checkOneManagedMailbox(raw[i], `google_auth.managed_mailboxes[${i}]`, errors)
    if (mb === null) ok = false
    else out.push(mb)
  }
  return ok ? out : null
}

function checkOneManagedMailbox(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): ManagedMailbox | null {
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be an object` })
    return null
  }
  let ok = true
  const address = raw['address']
  if (typeof address !== 'string' || !address.includes('@')) {
    errors.push({
      code: 'InvalidFormat',
      path: `${path}.address`,
      message: `${path}.address must be the primary email address to impersonate (never an alias)`,
    })
    ok = false
  }
  const sendAs = raw['send_as']
  if (
    !Array.isArray(sendAs) ||
    sendAs.length === 0 ||
    !sendAs.every((s) => typeof s === 'string' && s.includes('@'))
  ) {
    errors.push({
      code: 'EmptyList',
      path: `${path}.send_as`,
      message: `${path}.send_as must be a non-empty list of "Send mail as" email addresses`,
    })
    ok = false
  }
  if (raw['action_ceilings'] !== undefined) {
    errors.push({
      code: 'LegacyEntitlementField',
      path: `${path}.action_ceilings`,
      message: 'mailbox-level action_ceilings is retired; author persona entitlements.exposure',
    })
    ok = false
  }
  if (!ok) return null
  return {
    address: address as string,
    send_as: sendAs as string[],
  }
}
