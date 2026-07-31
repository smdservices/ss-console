/**
 * Output-class declaration section for customer.yaml (ADR 0083).
 *
 * WHAT THIS BLOCK IS FOR, and what it deliberately is not.
 *
 * ADR 0083 puts the customer's authored voice and format SPECS in their own
 * vault object, not in git — a spec is prose the customer edits, and putting it
 * here would mean a portal edit had to reach git, which no portal actor can do.
 * What lives here is the commitment-shaped half: a per-class declaration of
 * whether an authored spec is EXPECTED at all.
 *
 * That single bit is what separates three states a system otherwise cannot
 * tell apart:
 *
 *   none      — the customer chose not to author here. The persona's own
 *               judgment produces the shape. A legitimate authored outcome,
 *               NOT an SMD default (ADR 0037 tenet 3).
 *   expected + spec present, hash matches  — apply it.
 *   expected + spec missing or mismatched  — FAIL CLOSED. This is a broken
 *               control wearing an unauthored costume, and without the
 *               declaration it would be indistinguishable from `none` — the
 *               system would silently fall back to persona judgment on an
 *               output the customer believes they shaped.
 *
 * GATES AND DELIVERY ARE NOT AUTHORED HERE, despite ADR 0083 listing them as
 * class properties. They already have an authority: exposure ceilings live in
 * `personas[].entitlements.exposure` per action class, and per-routine posture
 * lives in the routine grid (ADR 0075). Restating them per output class would
 * create a second authority over the same behaviour, and two authorities over
 * one behaviour is the drift this registry exists to end. The class REGISTRY
 * (operator/contracts/output-classes.yaml) records which gates apply to which
 * class; the customer authors their strength in the one place they already do.
 *
 * OPTIONAL BY CONSTRUCTION. Like `seat:`, this block validates as optional so
 * the portal's projection-reconstructed root keeps resolving. See
 * sections-seat.ts for the #1965 failure this avoids.
 */

import { isPlainObject } from './helpers'
import {
  SPEC_DISPOSITIONS,
  type OutputClasses,
  type SpecDisposition,
  type ValidationError,
} from './types'

/**
 * Validate the optional `output_classes:` block.
 *
 * Class slugs are NOT validated against operator/contracts/output-classes.yaml
 * here: this validator runs in the console and in the overlay's parity harness,
 * neither of which reads the operator contracts tree. Cross-checking a declared
 * class against the registry is the conformance test's job
 * (operator/bin/tests/test_output_class_conformance.py), where both files are
 * in reach. Shape is proven here; agreement is proven there.
 */
export function checkOutputClasses(
  root: Record<string, unknown>,
  errors: ValidationError[]
): OutputClasses | null {
  const raw = root['output_classes']
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'output_classes',
      message: 'output_classes must be an object when present',
    })
    return null
  }
  const out: OutputClasses = {}
  let failed = false
  for (const [slug, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) {
      errors.push({
        code: 'TypeMismatch',
        path: `output_classes.${slug}`,
        message: `output_classes.${slug} must be an object`,
      })
      failed = true
      continue
    }
    const voice = checkDisposition(entry['voice_spec'], `output_classes.${slug}.voice_spec`, errors)
    const format = checkDisposition(
      entry['format_spec'],
      `output_classes.${slug}.format_spec`,
      errors
    )
    if (voice === null || format === null) {
      failed = true
      continue
    }
    out[slug] = { voice_spec: voice, format_spec: format }
  }
  return failed ? null : out
}

function checkDisposition(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): SpecDisposition | null {
  if (raw === undefined || raw === null) {
    errors.push({
      code: 'MissingField',
      path,
      message: `${path} is required — an unauthored property needs a named outcome, never an implied one`,
    })
    return null
  }
  if (typeof raw !== 'string' || !SPEC_DISPOSITIONS.includes(raw as SpecDisposition)) {
    errors.push({
      code: 'EnumViolation',
      path,
      message: `${path} must be one of: ${SPEC_DISPOSITIONS.join(', ')}`,
    })
    return null
  }
  return raw as SpecDisposition
}
