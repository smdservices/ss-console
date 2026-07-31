/**
 * POST /api/portal/operator/settings/output-class-specs
 *
 * The write half of the authoring surface (ADR 0083, #2089). A Named
 * Administrator says, in plain speech, how an output of a given class should
 * sound or be shaped; this endpoint stores that statement as a class property
 * in the customer's own vault object, where the seat's spec applier picks it up
 * and installs it root-owned.
 *
 * WHAT MAKES THIS DIFFERENT FROM ITS NEIGHBOUR. `customer-yaml-update` in the
 * same directory validates and records and writes nothing, because
 * `customer.yaml` is git-authoritative. This one writes. That is the whole
 * point of the split ADR 0083 draws: the DECLARATION that a class expects a
 * spec is a commitment and moves through a PR; the spec CONTENT is prose the
 * customer edits, and a portal edit cannot reach git — so it goes to
 * `vaults/<slug>/output-classes.json`, a key space the git publisher is
 * structurally barred from touching, and vice versa.
 *
 * WHICH CLASSES ARE AUTHORABLE. Exactly the ones the customer's own
 * `output_classes:` block declares. Nothing here invents a class vocabulary:
 * a form field naming a class the seat did not declare is dropped, not stored,
 * so a hand-crafted POST cannot mint a spec for a class the engagement never
 * agreed to.
 *
 * THE DECLARED HASH IS COMPUTED HERE. The request carries bodies and nothing
 * else; the sha256 beside each body in the written document is computed
 * server-side over the bytes about to be written. A submitted digest is never
 * read. See `src/lib/operator/output-class-specs.ts`.
 *
 * STATUS IS AN OUTCOME, NOT AN INTENTION. `saved` is redirected only after the
 * object has been written AND read back byte-identical. Every other path says
 * what actually happened.
 */

import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { getCustomerConfigBySlug } from '../../../../../lib/portal/customer-config'
import { authorizeAdvancedSettings } from '../../../../../lib/portal/operator/advanced-settings-auth'
import { recordPortalActionEvent } from '../../../../../lib/portal/operator/action-events'
import { checkOutputClasses } from '../../../../../lib/operator/customer-yaml/sections-output-classes'
import type { ValidationError } from '../../../../../lib/operator/customer-yaml'
import {
  buildSpecDocument,
  collectAuthoredBodies,
  readSpecDocument,
  writeSpecDocument,
  type SpecDocument,
} from '../../../../../lib/operator/output-class-specs'

const OPERATOR_ROOT = '/portal/products/operator'

function redirectWithStatus(instance: string | null, status: string): Response {
  const base = instance ? `${OPERATOR_ROOT}/${instance}/settings/advanced` : OPERATOR_ROOT
  return new Response(null, {
    status: 303,
    headers: { Location: `${base}?status=${encodeURIComponent(status)}` },
  })
}

/**
 * The classes this customer declared, in `output_classes:`. Parsed with the
 * shared validator rather than cast — the projection column is JSON written by
 * the sync job, which is external input to this process.
 */
function declaredClasses(raw: unknown): string[] {
  const errors: ValidationError[] = []
  const declared = checkOutputClasses({ output_classes: raw }, errors)
  if (declared === null) return []
  return Object.keys(declared)
}

/**
 * Carry forward any class the form did not address.
 *
 * A class can leave `output_classes:` while its authored prose is still in the
 * vault. Rebuilding the document from the form alone would silently delete
 * that prose on the next unrelated save. Merging preserves it, and the write
 * stays idempotent for everything the form did address.
 */
function mergeUnaddressed(
  built: SpecDocument,
  existing: SpecDocument | null,
  addressed: readonly string[]
): SpecDocument {
  if (existing === null) return built
  const classes = { ...built.classes }
  for (const [slug, entry] of Object.entries(existing.classes)) {
    if (addressed.includes(slug)) continue
    classes[slug] = entry
  }
  return { schema_version: built.schema_version, classes }
}

async function recordAttempt(
  auth: { userId: string; userEmail: string; entityId: string; customerSlug: string },
  status: 'applied' | 'rejected',
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await recordPortalActionEvent(env.DB, {
      entity_id: auth.entityId,
      customer_slug: auth.customerSlug,
      action_type: 'output_class_spec_authored',
      actor_user_id: auth.userId,
      actor_email: auth.userEmail,
      actor_role: 'principal',
      source: 'portal',
      target: null,
      status,
      metadata,
    })
  } catch (err) {
    console.error('output-class-specs: failed to record portal_action_events row', err)
  }
}

export const POST: APIRoute = async ({ request, locals }) => {
  const form = await request.formData()
  const rawInstance = form.get('instance')
  const instance = typeof rawInstance === 'string' ? rawInstance : ''
  if (!instance) {
    return new Response(null, { status: 303, headers: { Location: OPERATOR_ROOT } })
  }

  const auth = await authorizeAdvancedSettings(env.DB, locals, instance)
  if (auth === null) return redirectWithStatus(instance, 'forbidden')

  const row = await getCustomerConfigBySlug(env.DB, auth.customerSlug)
  if (row === null) return redirectWithStatus(auth.customerSlug, 'no_config')

  const classes = declaredClasses(row.output_classes)
  if (classes.length === 0) return redirectWithStatus(auth.customerSlug, 'spec_no_classes')

  const built = await buildSpecDocument(collectAuthoredBodies(form, classes))
  if (!built.ok) {
    await recordAttempt(auth, 'rejected', { errors: built.errors })
    return redirectWithStatus(auth.customerSlug, 'spec_invalid')
  }

  // Read before write. An unparseable existing document must not be
  // overwritten: whatever prose it holds was authored by someone, and we could
  // not show it back to them. An R2 fault at either end is a refusal, never a
  // partial claim — the key-space guard throws rather than addressing a
  // neighbouring object, and that throw must land here, not as a 500.
  try {
    const existing = await readSpecDocument(env.CUSTOMER_CONFIG, auth.customerSlug)
    if (existing.kind === 'unreadable') {
      await recordAttempt(auth, 'rejected', { reason: 'existing_document_unreadable' })
      return redirectWithStatus(auth.customerSlug, 'spec_unreadable')
    }

    const merged = mergeUnaddressed(
      built.doc,
      existing.kind === 'document' ? existing.doc : null,
      classes
    )

    const written = await writeSpecDocument(env.CUSTOMER_CONFIG, auth.customerSlug, merged)
    if (!written.ok) {
      await recordAttempt(auth, 'rejected', { errors: written.errors })
      return redirectWithStatus(auth.customerSlug, 'spec_write_failed')
    }

    await recordAttempt(auth, 'applied', {
      key: written.key,
      bodies: written.bodies,
      classes: Object.keys(merged.classes).sort(),
    })
    return redirectWithStatus(auth.customerSlug, 'spec_saved')
  } catch (err) {
    console.error('output-class-specs: vault write failed for', auth.customerSlug, err)
    await recordAttempt(auth, 'rejected', { reason: 'vault_error' })
    return redirectWithStatus(auth.customerSlug, 'spec_write_failed')
  }
}
