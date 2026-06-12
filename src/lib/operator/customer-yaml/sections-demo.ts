/**
 * Validator for the optional `demo:` block — demo-only switches.
 *
 * The block holds behavior that exists solely to drive a tangible prospect
 * demo and must never be authored for a real customer holding real client data
 * (see the {@link Demo} doc comment). Every switch is fail-closed: an absent
 * block, or an absent field, resolves to OFF.
 *
 * v1 ships one switch: `reply_relay` (the overlay `hermes-smd-demo-relay`
 * plugin). Future demo switches append here.
 */

import { isPlainObject } from './helpers'
import { type Demo, type ValidationError } from './types'

const DEMO_DEFAULT: Demo = { reply_relay: false }

export function checkDemo(root: Record<string, unknown>, errors: ValidationError[]): Demo {
  const raw = root['demo']
  if (raw === undefined || raw === null) return { ...DEMO_DEFAULT }
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'demo',
      message: 'demo must be a mapping when present',
    })
    return { ...DEMO_DEFAULT }
  }

  const replyRelayRaw = raw['reply_relay']
  let replyRelay = false
  if (replyRelayRaw !== undefined && replyRelayRaw !== null) {
    if (typeof replyRelayRaw === 'boolean') {
      replyRelay = replyRelayRaw
    } else if (typeof replyRelayRaw === 'string') {
      // The overlay loader (shared/customer_config.py) accepts the string form
      // "enabled" as the on value; mirror that here so author intent validates
      // identically on both sides of the contract.
      const normalized = replyRelayRaw.trim().toLowerCase()
      if (normalized === 'enabled' || normalized === 'true' || normalized === 'on') {
        replyRelay = true
      } else if (normalized === 'disabled' || normalized === 'false' || normalized === 'off') {
        replyRelay = false
      } else {
        errors.push({
          code: 'EnumViolation',
          path: 'demo.reply_relay',
          message:
            'demo.reply_relay must be a boolean or one of: enabled, disabled, ' +
            'true, false, on, off',
        })
      }
    } else {
      errors.push({
        code: 'TypeMismatch',
        path: 'demo.reply_relay',
        message: 'demo.reply_relay must be a boolean (or the string "enabled"/"disabled")',
      })
    }
  }

  return { reply_relay: replyRelay }
}
