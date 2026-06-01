/**
 * Validator for the `addons:` field — per ADR 0022 Stream 1.
 *
 * Each entry is `<vertical>/<addon>@<semver>`, e.g. `law-firm/pi@2.1.0`.
 * Cross-vertical add-on composition is supported (ADR 0022 §"Properties of
 * the vertical model" bullet 3): a customer subscribed to `vertical: law-firm`
 * may also subscribe to `accounting/bookkeeping` once that pack ships. The
 * origin vertical is namespaced into the spec for provenance.
 *
 * v1 ships with `law-firm/pi` only — populated in ACCEPTED_ADDONS in types.ts.
 * Future add-ons append to that registry.
 *
 * Field is OPTIONAL. Omission and empty array both mean "no add-ons" — the
 * customer uses only the vertical defaults.
 */

import {
  ACCEPTED_ADDONS,
  ACCEPTED_VERTICALS,
  SEMVER_PATTERN,
  type AddonSpec,
  type ValidationError,
  type Vertical,
} from './types'

export function checkAddons(root: Record<string, unknown>, errors: ValidationError[]): AddonSpec[] {
  const raw = root['addons']
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'addons',
      message: 'addons must be a list of strings (<vertical>/<addon>@<semver>) when present',
    })
    return []
  }

  const out: AddonSpec[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const entry: unknown = raw[i]
    if (typeof entry !== 'string' || entry.length === 0) {
      errors.push({
        code: 'TypeMismatch',
        path: `addons[${i}]`,
        message: 'addons entries must be non-empty strings',
      })
      continue
    }
    const parsed = parseAddonEntry(entry, i, errors)
    if (parsed === null) continue
    const dedupeKey = `${parsed.vertical}/${parsed.addon}`
    if (seen.has(dedupeKey)) {
      errors.push({
        code: 'InvalidAddonSpec',
        path: `addons[${i}]`,
        message: `addons entry "${dedupeKey}" appears more than once`,
      })
      continue
    }
    seen.add(dedupeKey)
    out.push(parsed)
  }
  return out
}

function parseAddonEntry(entry: string, i: number, errors: ValidationError[]): AddonSpec | null {
  const slashIndex = entry.indexOf('/')
  const atIndex = entry.indexOf('@')
  if (slashIndex === -1 || atIndex === -1 || slashIndex > atIndex) {
    errors.push({
      code: 'InvalidAddonSpec',
      path: `addons[${i}]`,
      message:
        `addons entry "${entry}" must match <vertical>/<addon>@<semver>, ` +
        'e.g. law-firm/pi@2.1.0',
    })
    return null
  }
  const verticalPart = entry.slice(0, slashIndex)
  const addonPart = entry.slice(slashIndex + 1, atIndex)
  const versionPart = entry.slice(atIndex + 1)
  if (verticalPart.length === 0 || addonPart.length === 0 || versionPart.length === 0) {
    errors.push({
      code: 'InvalidAddonSpec',
      path: `addons[${i}]`,
      message:
        `addons entry "${entry}" must match <vertical>/<addon>@<semver>; ` +
        'all three parts are required',
    })
    return null
  }
  if (!(ACCEPTED_VERTICALS as readonly string[]).includes(verticalPart)) {
    errors.push({
      code: 'EnumViolation',
      path: `addons[${i}]`,
      message:
        `addons entry "${entry}" references unknown vertical "${verticalPart}"; ` +
        `must be one of: ${ACCEPTED_VERTICALS.join(', ')}`,
    })
    return null
  }
  const vertical = verticalPart as Vertical
  const acceptedForVertical = ACCEPTED_ADDONS[vertical]
  if (!acceptedForVertical.includes(addonPart)) {
    const known = acceptedForVertical.length > 0 ? acceptedForVertical.join(', ') : '(none)'
    errors.push({
      code: 'UnknownAddon',
      path: `addons[${i}]`,
      message:
        `addons entry "${entry}" references unknown addon "${addonPart}" ` +
        `under vertical "${vertical}"; accepted: ${known}`,
    })
    return null
  }
  if (!SEMVER_PATTERN.test(versionPart)) {
    errors.push({
      code: 'InvalidAddonSpec',
      path: `addons[${i}]`,
      message:
        `addons entry "${entry}" version "${versionPart}" must match ` +
        'MAJOR.MINOR.PATCH (e.g. 2.1.0)',
    })
    return null
  }
  return { vertical, addon: addonPart, version: versionPart }
}
