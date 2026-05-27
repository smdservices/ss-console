/**
 * Validator for the `vertical:` field — accepts either bare form (legacy
 * back-compat) or pinned form (`<vertical>@<semver>`).
 *
 * Added by ADR 0022 Stream 1. Replaces the pre-ADR-0022 inline
 * `checkEnum(root, 'vertical', ACCEPTED_VERTICALS, errors)` call in
 * validator.ts. The bare form continues to be accepted so existing customer
 * YAMLs do not need to be edited in lockstep with this PR.
 *
 * Bare form: `vertical: law-firm`
 *   → returns { vertical: 'law-firm', version: null }
 *
 * Pinned form: `vertical: law-firm@1.4.0`
 *   → returns { vertical: 'law-firm', version: '1.4.0' }
 *
 * Once a customer is bound to a specific vertical-pack release (after Stream
 * 2 substrate work lands and bootstrap consumes the manifest), the pinned
 * form becomes the recommended shape. See ADR 0022 §"Properties of the
 * vertical model" bullet 5.
 */

import { ACCEPTED_VERTICALS, SEMVER_PATTERN, type ValidationError, type Vertical } from './types'

export interface VerticalCheckResult {
  vertical: Vertical | null
  version: string | null
}

export function checkVerticalPinned(
  root: Record<string, unknown>,
  errors: ValidationError[]
): VerticalCheckResult {
  const raw = root['vertical']
  if (raw === undefined || raw === null) {
    errors.push({
      code: 'MissingField',
      path: 'vertical',
      message: 'vertical is required',
    })
    return { vertical: null, version: null }
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    errors.push({
      code: 'TypeMismatch',
      path: 'vertical',
      message: 'vertical must be a non-empty string',
    })
    return { vertical: null, version: null }
  }

  const atIndex = raw.indexOf('@')
  if (atIndex === -1) {
    // Bare form — back-compat path.
    if (!(ACCEPTED_VERTICALS as readonly string[]).includes(raw)) {
      errors.push({
        code: 'EnumViolation',
        path: 'vertical',
        message: `vertical must be one of: ${ACCEPTED_VERTICALS.join(', ')}`,
      })
      return { vertical: null, version: null }
    }
    return { vertical: raw as Vertical, version: null }
  }

  // Pinned form: <vertical>@<semver>
  const verticalPart = raw.slice(0, atIndex)
  const versionPart = raw.slice(atIndex + 1)
  if (verticalPart.length === 0 || versionPart.length === 0) {
    errors.push({
      code: 'InvalidVerticalSpec',
      path: 'vertical',
      message:
        'vertical pinned form must match <vertical>@<semver>, ' +
        'e.g. law-firm@1.4.0; both sides of "@" are required',
    })
    return { vertical: null, version: null }
  }
  if (!(ACCEPTED_VERTICALS as readonly string[]).includes(verticalPart)) {
    errors.push({
      code: 'EnumViolation',
      path: 'vertical',
      message: `vertical must be one of: ${ACCEPTED_VERTICALS.join(', ')}`,
    })
    return { vertical: null, version: null }
  }
  if (!SEMVER_PATTERN.test(versionPart)) {
    errors.push({
      code: 'InvalidVerticalSpec',
      path: 'vertical',
      message:
        `vertical version "${versionPart}" must match MAJOR.MINOR.PATCH ` +
        '(e.g. 1.4.0); pre-release and build-metadata suffixes are not ' +
        'accepted in v1',
    })
    return { vertical: verticalPart as Vertical, version: null }
  }
  return { vertical: verticalPart as Vertical, version: versionPart }
}

/**
 * Top-level `extends:` is RESERVED for a future ADR amendment (industry-to-
 * specialty inheritance, ADR 0022 §"Flat manifest in v1"). Until that
 * amendment lands and inheritance machinery exists, accepting `extends:`
 * silently would let authors write manifests the runtime ignores — a foot-
 * gun. Reject with an explicit error message so the failure is loud and
 * the next agent to land inheritance changes one validator in one place.
 */
export function checkExtendsReserved(
  root: Record<string, unknown>,
  errors: ValidationError[]
): void {
  if (root['extends'] === undefined) return
  errors.push({
    code: 'ExtendsReserved',
    path: 'extends',
    message:
      'extends: is reserved for a future ADR amendment (industry-to-specialty ' +
      'inheritance per ADR 0022) and not yet supported; remove this field',
  })
}
