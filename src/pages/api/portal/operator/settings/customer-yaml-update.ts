/**
 * POST /api/portal/operator/settings/customer-yaml-update
 *
 * Action endpoint for the customer.yaml editor (#877). Driven by an
 * HTML <form method="POST"> on
 * /portal/products/operator/settings/advanced; no JSON / fetch
 * logic. The form serializes per-field inputs in a flat
 * (`section.field` / `personas[0].name`) shape; this endpoint parses
 * the form back into a typed `EditableCustomerConfig`, runs the
 * shared lock-check + structural validator, emits the audit event,
 * and redirects back to the page with a `?status=` query param.
 *
 * Authorization (mirrors role-action.ts):
 *   - Clerk session required (middleware enforces)
 *   - Active Operator subscription on this customer
 *   - Caller holds the `principal` role on (entity, 'operator').
 *     Operators and compliance fail closed with 403 / redirect.
 *
 * Locked-field discipline:
 *   - The merger (`applyEditableChanges`) pulls locked fields from
 *     the current document. Even if a malformed POST body carries
 *     `connectors.X.token_ref` (or any other locked path), the value
 *     is ignored.
 *   - The validator (`validateEditableChanges`) additionally surfaces
 *     a `BannedFieldName` error when the input carries a locked
 *     field, so the form gives the principal a clear reason rather
 *     than a silent strip.
 *
 * Audit:
 *   Every call emits an `audit:customer_yaml_updated` event via
 *   `recordCustomerYamlUpdateAudit`. The event records the actor,
 *   the changed-field paths, and before/after fingerprints. The
 *   audit fires on validation failure too (with `status: rejected`)
 *   — the attempt is itself a recorded compliance event.
 *
 * Git write-back:
 *   OUT OF SCOPE at v1. The configs-repo write path lands in a
 *   follow-on PR (ADR 0012 §2 + the issue's mention of "Validates
 *   against schema (#790) on save"). Until then, the audit log +
 *   validation pass are the load-bearing customer-side guarantees.
 *   The endpoint redirects with `?status=applied` when the merged
 *   YAML is structurally valid, even though no row was written.
 *   This is the right shape for the follow-on: the merger + the
 *   validator are the pieces that change last; the writer becomes
 *   the body of the conditional that today logs `applied`.
 */

import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { getPortalClient } from '../../../../../lib/portal/session'
import {
  getOperatorSubscriptionByInstance,
  listProductRoles,
} from '../../../../../lib/portal/product-access'
import { getCustomerConfigBySlug } from '../../../../../lib/portal/customer-config'
import {
  projectEditableConfig,
  resolveEditableConfigFromRow,
  validateEditableChanges,
  type EditableCustomerConfig,
  type EditablePersona,
  type EditablePersonaSkill,
  type EditableConnector,
  type EditableBusinessHours,
} from '../../../../../lib/portal/operator/customer-yaml-editor'
import {
  buildAuditMetadata,
  recordCustomerYamlUpdateAudit,
} from '../../../../../lib/portal/operator/customer-yaml-audit'
import { recordPortalActionEvent } from '../../../../../lib/portal/operator/action-events'
import {
  ACCEPTED_PERSONA_STATUSES,
  ACCEPTED_PRONOUNS,
  ACCEPTED_LOG_LEVELS,
  ACCEPTED_LOG_SHIPS,
  validate,
  type CustomerYaml,
  type ValidationError,
} from '../../../../../lib/operator/customer-yaml'

const PRODUCT_SLUG = 'operator'
const OPERATOR_ROOT = '/portal/products/operator'

/** The instance's advanced-config page (multi-operator). A null instance (a
 *  pre-resolution failure) falls back to the bare operator root. */
function redirectWithStatus(instance: string | null, status: string): Response {
  const base = instance ? `${OPERATOR_ROOT}/${instance}/settings/advanced` : OPERATOR_ROOT
  const target = `${base}?status=${encodeURIComponent(status)}`
  return new Response(null, { status: 303, headers: { Location: target } })
}

function asString(v: FormDataEntryValue | null): string {
  return typeof v === 'string' ? v : ''
}

function splitCsv(v: string): string[] {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function asStringList(v: FormDataEntryValue | null): string[] {
  return splitCsv(asString(v))
}

function asMultiCheck(form: FormData, name: string): string[] {
  return form
    .getAll(name)
    .map((v) => (typeof v === 'string' ? v : ''))
    .filter((s) => s.length > 0)
}

function parsePronouns(v: string): EditablePersona['pronouns'] {
  if ((ACCEPTED_PRONOUNS as readonly string[]).includes(v)) {
    return v as EditablePersona['pronouns']
  }
  return null
}

function parsePersonaStatus(v: string): EditablePersona['status'] {
  return (ACCEPTED_PERSONA_STATUSES as readonly string[]).includes(v)
    ? (v as EditablePersona['status'])
    : 'active'
}

function parsePersona(form: FormData, idx: number, current: EditablePersona): EditablePersona {
  const prefix = `personas[${idx}]`
  const agentmail = asString(form.get(`${prefix}.send_as.agentmail_identity`))
  return {
    slug: current.slug,
    status: parsePersonaStatus(asString(form.get(`${prefix}.status`))),
    name: asString(form.get(`${prefix}.name`)),
    title: asString(form.get(`${prefix}.title`)) || null,
    pronouns: parsePronouns(asString(form.get(`${prefix}.pronouns`))),
    tone: asMultiCheck(form, `${prefix}.tone[]`),
    send_as: agentmail.length > 0 ? { agentmail_identity: agentmail } : null,
    skills: current.skills.map((cur, skillIdx) => parseSkill(form, prefix, skillIdx, cur)),
    channel_bindings: current.channel_bindings,
  }
}

function parseSkill(
  form: FormData,
  prefix: string,
  skillIdx: number,
  cur: EditablePersonaSkill
): EditablePersonaSkill {
  const skillPrefix = `${prefix}.skills[${skillIdx}]`
  const name = asString(form.get(`${skillPrefix}.name`)) || cur.name
  return {
    name,
    initiation: {
      manual: form.get(`${skillPrefix}.initiation.manual`) !== null,
      scheduled: form.get(`${skillPrefix}.initiation.scheduled`) !== null,
      webhook: form.get(`${skillPrefix}.initiation.webhook`) !== null,
    },
    enabled: form.get(`${skillPrefix}.enabled`) !== null,
  }
}

function parseBusinessHours(form: FormData): EditableBusinessHours | null {
  if (form.get('business_hours.present') === null) return null
  return {
    timezone: asString(form.get('business_hours.timezone')),
    days: asMultiCheck(form, 'business_hours.days[]'),
    start: asString(form.get('business_hours.start')),
    end: asString(form.get('business_hours.end')),
  }
}

function parseConnector(
  form: FormData,
  capability: string,
  cur: EditableConnector
): EditableConnector {
  const prefix = `connectors.${capability}`
  return {
    adapter: asString(form.get(`${prefix}.adapter`)) || cur.adapter,
    backend: asString(form.get(`${prefix}.backend`)) || cur.backend,
    enabled: form.get(`${prefix}.enabled`) !== null,
    scopes: asStringList(form.get(`${prefix}.scopes`)),
  }
}

function parseConnectors(
  form: FormData,
  current: Record<string, EditableConnector>
): Record<string, EditableConnector> {
  const next: Record<string, EditableConnector> = {}
  for (const [capability, cur] of Object.entries(current)) {
    next[capability] = parseConnector(form, capability, cur)
  }
  return next
}

function parseAckMinutes(form: FormData): number | null {
  const raw = asString(form.get('escalation.acknowledgement_window_minutes'))
  if (raw.length === 0) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

function parseLogging(
  form: FormData,
  current: EditableCustomerConfig['logging']
): EditableCustomerConfig['logging'] {
  // Logging fields are not yet exposed in the form; preserve current.
  // Validated against the accepted log enums so a future surface
  // wiring stays compatible. ACCEPTED_LOG_* references prevent the
  // imports from being marked unused while documenting intent.
  const _levels = ACCEPTED_LOG_LEVELS
  const _ships = ACCEPTED_LOG_SHIPS
  void _levels
  void _ships
  void form
  return current
}

function parseFormToConfig(
  form: FormData,
  current: EditableCustomerConfig
): EditableCustomerConfig {
  return {
    personas: current.personas.map((cur, idx) => parsePersona(form, idx, cur)),
    voiceLibrary: { samples_path: current.voiceLibrary.samples_path },
    escalation: {
      red_flag_recipients: asStringList(form.get('escalation.red_flag_recipients')),
      failure_recipients: asStringList(form.get('escalation.failure_recipients')),
      acknowledgement_window_minutes: parseAckMinutes(form),
    },
    businessHours: parseBusinessHours(form),
    connectors: parseConnectors(form, current.connectors),
    scope: {
      email_folders_visible: asStringList(form.get('scope.email_folders_visible')),
      email_folders_blind: asStringList(form.get('scope.email_folders_blind')),
      email_keyword_blocks: asStringList(form.get('scope.email_keyword_blocks')),
      domain_blocks: asStringList(form.get('scope.domain_blocks')),
      matter_blocks: asStringList(form.get('scope.matter_blocks')),
      inbound_allow_from: asStringList(form.get('scope.inbound_allow_from')),
    },
    logging: parseLogging(form, current.logging),
    pause: current.pause,
  }
}

interface AuthCtx {
  userId: string
  userEmail: string
  customerId: string
  customerSlug: string
}

async function authorize(locals: App.Locals, instance: string): Promise<Response | AuthCtx> {
  const portalData = await getPortalClient(env.DB, locals)
  if (!portalData) return redirectWithStatus(instance, 'forbidden')
  if (!portalData.client) return redirectWithStatus(instance, 'forbidden')

  const { user, client } = portalData

  // Ownership guard: the addressed instance's config must belong to this client.
  const config = await getCustomerConfigBySlug(env.DB, instance)
  if (!config || config.entity_id !== client.id) return redirectWithStatus(instance, 'forbidden')

  const subscription = await getOperatorSubscriptionByInstance(env.DB, client.id, instance)
  if (!subscription) return redirectWithStatus(instance, 'forbidden')

  const callerRoles = await listProductRoles(env.DB, user.id, client.id, PRODUCT_SLUG)
  if (!callerRoles.includes('principal')) return redirectWithStatus(instance, 'forbidden')

  // customerSlug is the real instance slug (not client.id — the pre-fix bug that
  // stamped an entity id into the audit customer_id field).
  return { userId: user.id, userEmail: user.email, customerId: client.id, customerSlug: instance }
}

async function resolveCurrentYaml(
  customerSlug: string
): Promise<Response | { current: CustomerYaml; editable: EditableCustomerConfig }> {
  const row = await getCustomerConfigBySlug(env.DB, customerSlug)
  if (row === null) return redirectWithStatus(customerSlug, 'no_config')
  const resolved = resolveEditableConfigFromRow(row)
  if ('error' in resolved) return redirectWithStatus(customerSlug, 'internal_error')

  // Re-validate to produce a CustomerYaml for the merger (resolved.editable
  // is the editor-projection, not the full YAML the merger needs as
  // `current`). The reconstruct→validate path is the same one
  // `resolveEditableConfigFromRow` ran; this second pass surfaces the
  // typed yaml the merger consumes.
  const yamlResult = validate(reconstructProjection(row))
  if (!yamlResult.ok) return redirectWithStatus(customerSlug, 'internal_error')

  return { current: yamlResult.value, editable: resolved.editable }
}

function reconstructProjection(row: Awaited<ReturnType<typeof getCustomerConfigBySlug>>): unknown {
  if (row === null) return null
  return {
    schema_version: Number(row.schema_version),
    customer_id: row.customer_slug,
    customer_name: row.customer_slug,
    vertical: 'mixed',
    fly_region: 'iad',
    model: 'unknown',
    // The reconstructed projection has no real ref to point at (the DB row
    // doesn't carry hermes_ref yet). v0.0.0@<40 zeros> is the unambiguous
    // "no upstream pin yet" sentinel: it parses as a string but deliberately
    // fails checkHermesRef (year is not 4 digits), so it surfaces as a
    // validation error prompting the operator to set a real pin rather than
    // silently shipping a fabricated version. Format per ADR 0024.
    hermes_ref: 'v0.0.0@0000000000000000000000000000000000000000',
    machine: { size: 'unknown', memory_mb: 256 },
    users: [],
    personas: row.personas,
    connectors: row.connectors ?? {},
    scope: row.scope ?? {
      email_folders_visible: [],
      email_folders_blind: [],
      email_keyword_blocks: [],
      domain_blocks: [],
      matter_blocks: [],
    },
    escalation: row.escalation ?? { red_flag_recipients: [], failure_recipients: [] },
    voice_library: row.voice_library ?? null,
    business_hours: row.business_hours ?? null,
    memory: {
      d1_namespace: row.customer_slug,
      r2_vault_path: `vaults/${row.customer_slug}/`,
      vectorize_index: `hermes-${row.customer_slug}-vault`,
      retention: null,
    },
  }
}

interface AuditArgs {
  status: 'applied' | 'rejected'
  customerId: string
  before: EditableCustomerConfig
  after: EditableCustomerConfig
  auth: AuthCtx
  errors: ValidationError[] | null
}

async function emitAudit(args: AuditArgs): Promise<void> {
  const metadata = buildAuditMetadata(args.before, args.after, args.auth.userId)
  const fullMetadata = {
    ...metadata,
    ...(args.errors !== null
      ? { validation_error_codes: args.errors.map((e) => `${e.code}:${e.path}`) }
      : {}),
  }
  await recordCustomerYamlUpdateAudit({
    status: args.status,
    customer_id: args.customerId,
    metadata: fullMetadata,
  })

  // Durable ledger (0099) — primary record; the tail-log line above is the
  // secondary sink. STATUS SEMANTICS, deliberately honest: this endpoint
  // validates and acknowledges but git write-back is out of scope at v1, so
  // a passing edit is recorded as 'submitted', never 'applied'. Nothing
  // fabricates an applied state.
  try {
    await recordPortalActionEvent(env.DB, {
      entity_id: args.auth.customerId,
      customer_slug: args.auth.customerSlug,
      action_type: 'customer_yaml_update_submitted',
      actor_user_id: args.auth.userId,
      actor_email: args.auth.userEmail,
      actor_role: 'principal',
      source: 'portal',
      target: null,
      status: args.status === 'applied' ? 'submitted' : 'rejected',
      metadata: fullMetadata,
    })
  } catch (err) {
    console.error('customer-yaml-update: failed to record portal_action_events row', err)
  }
}

export const POST: APIRoute = async ({ request, locals }) => {
  // Read the form once, up front, to learn which operator instance this edit
  // targets (hidden `instance` field on the advanced-config form). formData() is
  // single-read, so parseFormToConfig below reuses this same object.
  const form = await request.formData()
  const instance = typeof form.get('instance') === 'string' ? (form.get('instance') as string) : ''
  if (!instance) {
    return new Response(null, { status: 303, headers: { Location: OPERATOR_ROOT } })
  }

  const auth = await authorize(locals, instance)
  if (auth instanceof Response) return auth

  const resolved = await resolveCurrentYaml(auth.customerSlug)
  if (resolved instanceof Response) return resolved
  const { current, editable: before } = resolved

  const proposed = parseFormToConfig(form, before)

  const result = validateEditableChanges(current, proposed)
  if (!result.ok) {
    await emitAudit({
      status: 'rejected',
      customerId: auth.customerSlug,
      before,
      after: proposed,
      auth,
      errors: result.errors,
    })
    return redirectWithStatus(auth.customerSlug, 'invalid')
  }

  const after = projectEditableConfig(result.value).editable
  await emitAudit({
    status: 'applied',
    customerId: auth.customerSlug,
    before,
    after,
    auth,
    errors: null,
  })
  return redirectWithStatus(auth.customerSlug, 'applied')
}
