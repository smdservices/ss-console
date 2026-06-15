/**
 * Validator for the optional `relationship:` block — the **authored behavioral
 * lane** of the relationship model (ADR 0048).
 *
 * The block holds per-person, human-reviewed, standing preferences for HOW the
 * Operator should work with each person it serves. The overlay materializes it
 * into each persona's `SOUL.md` (so the Operator actually works the authored
 * way) and the admin relationship surface renders it read-only via the
 * `config_export` seam.
 *
 * Two binding policies from ADR 0048 §2 shape what this validator does — and,
 * just as importantly, what it deliberately does NOT do:
 *
 *   - **§2c Informational only.** Preferences shape drafting/help; they never
 *     grant capability. Entitlements stay in `scope:`/`escalation:` and are
 *     enforced by `trust_ceiling.enforce()`. So this validator does NOT try to
 *     police preference *content* for entitlement-shaped phrasing — `enforce()`
 *     is the real and only gate, and a heuristic content filter here would be
 *     both brittle and security-theatre. Validation stays structural.
 *   - **§2d Not the style lane.** Greeting/sign-off/honorific/lexical STYLE
 *     corrections live in `voice_corrections` (migration 0010). This block must
 *     not duplicate them; it carries behavioral working preferences, not draft
 *     phrasing. (Not machine-enforceable without content heuristics — documented
 *     here and in the schema doc as authoring guidance.)
 *
 * Validation is therefore structural + bounded only: shape, required fields,
 * unique ids, and size caps that keep the rendered `SOUL.md` section bounded.
 * Absent block ⇒ `{ people: [] }` (fail-safe empty, never fabricated).
 */

import { isPlainObject } from './helpers'
import { type Relationship, type RelationshipPerson, type ValidationError } from './types'

/** Caps that keep the materialized `SOUL.md` "Working relationships" section
 * bounded — a `customer.yaml` is human-authored, so these are generous ceilings
 * that only catch runaway/pasted input, not real authoring. */
const MAX_PEOPLE = 50
const MAX_ITEMS_PER_LIST = 25
const MAX_STRING_LEN = 400

/** Stable per-person id: kebab-case, so it can align with a
 * `voice_corrections.reviewer_user_id`. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export function checkRelationship(
  root: Record<string, unknown>,
  errors: ValidationError[]
): Relationship {
  const raw = root['relationship']
  if (raw === undefined || raw === null) return { people: [] }
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'relationship',
      message: 'relationship must be a mapping when present',
    })
    return { people: [] }
  }

  const peopleRaw = raw['people']
  if (peopleRaw === undefined || peopleRaw === null) return { people: [] }
  if (!Array.isArray(peopleRaw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'relationship.people',
      message: 'relationship.people must be a list when present',
    })
    return { people: [] }
  }
  if (peopleRaw.length > MAX_PEOPLE) {
    errors.push({
      code: 'TypeMismatch',
      path: 'relationship.people',
      message: `relationship.people must not exceed ${MAX_PEOPLE} entries`,
    })
    return { people: [] }
  }

  const people: RelationshipPerson[] = []
  const seenIds = new Set<string>()

  peopleRaw.forEach((entry, i) => {
    const path = `relationship.people[${i}]`
    if (!isPlainObject(entry)) {
      errors.push({ code: 'TypeMismatch', path, message: `${path} must be a mapping` })
      return
    }

    const id = requireBoundedString(entry, 'id', `${path}.id`, errors)
    if (id !== null) {
      if (!ID_PATTERN.test(id)) {
        errors.push({
          code: 'InvalidSlug',
          path: `${path}.id`,
          message: `${path}.id must be kebab-case (lowercase letters, digits, hyphens)`,
        })
      } else if (seenIds.has(id)) {
        errors.push({
          code: 'DuplicateRelationshipPersonId',
          path: `${path}.id`,
          message: `relationship.people id "${id}" is duplicated`,
        })
      } else {
        seenIds.add(id)
      }
    }

    const name = requireBoundedString(entry, 'name', `${path}.name`, errors)
    const role = optionalBoundedString(entry, 'role', `${path}.role`, errors)
    const prefers = boundedNonEmptyStringList(entry, 'prefers', `${path}.prefers`, errors)
    const avoid = boundedNonEmptyStringList(entry, 'avoid', `${path}.avoid`, errors)

    // Only assemble a person when the required fields are well-formed; a
    // malformed entry has already pushed an error and is dropped rather than
    // rendered half-formed.
    if (id !== null && ID_PATTERN.test(id) && name !== null) {
      people.push({ id, name, role, prefers, avoid })
    }
  })

  // On any error the caller (`validate`) early-returns before assembly, so this
  // value is only inspected by unit tests asserting the well-formed subset.
  return { people }
}

function requireBoundedString(
  rec: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationError[]
): string | null {
  const v = rec[key]
  if (v === undefined || v === null) {
    errors.push({ code: 'MissingField', path, message: `${path} is required` })
    return null
  }
  if (typeof v !== 'string') {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be a string` })
    return null
  }
  if (v.length === 0) {
    errors.push({ code: 'EmptyField', path, message: `${path} must not be empty` })
    return null
  }
  if (v.length > MAX_STRING_LEN) {
    errors.push({
      code: 'TypeMismatch',
      path,
      message: `${path} must not exceed ${MAX_STRING_LEN} characters`,
    })
    return null
  }
  return v
}

function optionalBoundedString(
  rec: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationError[]
): string | null {
  const v = rec[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be a string when present` })
    return null
  }
  if (v.length === 0) {
    errors.push({ code: 'EmptyField', path, message: `${path} must not be empty when present` })
    return null
  }
  if (v.length > MAX_STRING_LEN) {
    errors.push({
      code: 'TypeMismatch',
      path,
      message: `${path} must not exceed ${MAX_STRING_LEN} characters`,
    })
    return null
  }
  return v
}

/** Optional list of non-empty, bounded strings. Absent ⇒ `[]`. */
function boundedNonEmptyStringList(
  rec: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationError[]
): string[] {
  const v = rec[key]
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be a list when present` })
    return []
  }
  if (v.length > MAX_ITEMS_PER_LIST) {
    errors.push({
      code: 'TypeMismatch',
      path,
      message: `${path} must not exceed ${MAX_ITEMS_PER_LIST} items`,
    })
    return []
  }
  const out: string[] = []
  v.forEach((item, i) => {
    const itemPath = `${path}[${i}]`
    if (typeof item !== 'string') {
      errors.push({ code: 'TypeMismatch', path: itemPath, message: `${itemPath} must be a string` })
      return
    }
    if (item.length === 0) {
      errors.push({ code: 'EmptyField', path: itemPath, message: `${itemPath} must not be empty` })
      return
    }
    if (item.length > MAX_STRING_LEN) {
      errors.push({
        code: 'TypeMismatch',
        path: itemPath,
        message: `${itemPath} must not exceed ${MAX_STRING_LEN} characters`,
      })
      return
    }
    out.push(item)
  })
  return out
}
