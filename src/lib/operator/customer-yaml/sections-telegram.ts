/**
 * Optional `telegram:` block validator (ADR 0033).
 *
 * Telegram is wired as a Hermes native polling channel: the bot token is a Fly
 * secret (TELEGRAM_BOT_TOKEN) that auto-enables the platform; this block authors
 * the ALLOWLIST (who may DM the bot) as reviewable config. The overlay
 * translate.py `_materialize_telegram_platform` renders it into the profile
 * config.yaml `telegram.allow_from`, which Hermes maps to TELEGRAM_ALLOWED_USERS.
 *
 * Fail-closed: when the block is enabled, `allow_from` MUST be a non-empty list of
 * numeric Telegram user-id strings — the pinned Hermes ref allows ALL users when
 * the allowlist is empty (`telegram.py: if not allowed_csv: return True`), so an
 * empty allowlist is the fail-open trap this pre-merge check exists to catch.
 *
 * Validate-only (pushes errors); the value is materialized by the overlay, not
 * consumed from the parsed CustomerYaml object.
 */

import type { ValidationError } from './types'
import { isPlainObject } from './helpers'

export function checkTelegram(root: Record<string, unknown>, errors: ValidationError[]): void {
  const raw = root['telegram']
  if (raw === undefined || raw === null) return // optional block
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path: 'telegram', message: 'telegram must be an object' })
    return
  }

  const enabled = raw['enabled']
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    errors.push({
      code: 'TypeMismatch',
      path: 'telegram.enabled',
      message: 'telegram.enabled must be a boolean',
    })
  }
  for (const key of ['require_mention', 'reactions'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') {
      errors.push({
        code: 'TypeMismatch',
        path: `telegram.${key}`,
        message: `telegram.${key} must be a boolean`,
      })
    }
  }

  const allow = raw['allow_from']
  if (enabled === true) {
    if (!Array.isArray(allow) || allow.length === 0) {
      errors.push({
        code: 'MissingField',
        path: 'telegram.allow_from',
        message:
          'telegram.allow_from is required and must be a non-empty list when telegram.enabled is true. ' +
          'An empty allowlist fails OPEN (the pinned Hermes ref answers any user). See ADR 0033.',
      })
    } else {
      allow.forEach((id, i) => {
        if (typeof id !== 'string' || !/^\d+$/.test(id.trim())) {
          errors.push({
            code: 'TypeMismatch',
            path: `telegram.allow_from[${i}]`,
            message:
              'each allow_from entry must be a numeric Telegram user id as a string (e.g. "7367659986")',
          })
        }
      })
    }
  } else if (allow !== undefined && !Array.isArray(allow)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'telegram.allow_from',
      message: 'telegram.allow_from must be a list',
    })
  }
}
