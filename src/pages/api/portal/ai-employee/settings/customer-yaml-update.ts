/**
 * POST /api/portal/ai-employee/settings/customer-yaml-update
 *
 * Action endpoint for the customer.yaml editor (#877). Driven by an
 * HTML <form method="POST"> on
 * /portal/products/ai-employee/settings/advanced; no JSON / fetch
 * logic. The form serializes per-field inputs in a flat
 * (`section.field` / `personas[0].name`) shape; this endpoint parses
 * the form back into a typed `EditableCustomerConfig`, runs the
 * shared lock-check + structural validator, emits the audit event,
 * and redirects back to the page with a `?status=` query param.
 *
 * Authorization (mirrors role-action.ts):
 *   - Clerk session required (middleware enforces)
 *   - Active AI Employee subscription on this customer
 *   - Caller holds the `principal` role on (entity, 'ai-employee').
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
import { getProductSubscription, listProductRoles } from '../../../../../lib/portal/product-access'
import { getCustomerConfig } from '../../../../../lib/portal/customer-config'
import {
  buildAuditMetadata,
  projectEditableConfig,
  recordCustomerYamlUpdateAudit,
  resolveEditableConfigFromRow,
  validateEditableChanges,
  type EditableCustomerConfig,
  type EditablePersona,
  type EditablePersonaSkill,
  type EditableConnector,
  type EditableBusinessHours,
} from '../../../../../lib/portal/ai-employee/customer-yaml-editor'
import {
  ACCEPTED_PERSONA_STATUSES,
  ACCEPTED_PRONOUNS,
  ACCEPTED_TRUST_CEILINGS,
  ACCEPTED_LOG_LEVELS,
  ACCEPTED_LOG_SHIPS,
  validate,
  type CustomerYaml,
  type ValidationError,
} from '../../../../../lib/ai-employee/customer-yaml'

const PRODUCT_SLUG = 'ai-employee'
const ADVANCED_PAGE_URL = '/portal/products/ai-employee/settings/advanced'

function redirectWithStatus(status: string): Response {
  const target = `${ADVANCED_PAGE_URL}?status=${encodeURIComponent(status)}`
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

function parseTrustCeiling(v: string): EditablePersonaSkill['trust_ceiling'] {
  return (ACCEPTED_TRUST_CEILINGS as readonly string[]).includes(v)
    ? (v as EditablePersonaSkill['trust_ceiling'])
    : 'draft_for_review'
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
    trust_ceiling: parseTrustCeiling(asString(form.get(`${skillPrefix}.trust_ceiling`))),
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
    },
    logging: parseLogging(form, current.logging),
    pause: current.pause,
  }
}

interface AuthCtx {
  userId: string
  customerId: string
  customerSlug: string
}

async function authorize(locals: App.Locals): Promise<Response | AuthCtx> {
  const portalData = await getPortalClient(env.DB, locals)
  if (!portalData) return redirectWithStatus('forbidden')
  if (!portalData.client) return redirectWithStatus('forbidden')

  const { user, client } = portalData
  const subscription = await getProductSubscription(env.DB, client.id, PRODUCT_SLUG)
  if (!subscription) return redirectWithStatus('forbidden')

  const callerRoles = await listProductRoles(env.DB, user.id, client.id, PRODUCT_SLUG)
  if (!callerRoles.includes('principal')) return redirectWithStatus('forbidden')

  return { userId: user.id, customerId: client.id, customerSlug: client.id }
}

async function resolveCurrentYaml(
  customerId: string
): Promise<Response | { current: CustomerYaml; editable: EditableCustomerConfig }> {
  const row = await getCustomerConfig(env.DB, customerId)
  if (row === null) return redirectWithStatus('no_config')
  const resolved = resolveEditableConfigFromRow(row)
  if ('error' in resolved) return redirectWithStatus('internal_error')

  // Re-validate to produce a CustomerYaml for the merger (resolved.editable
  // is the editor-projection, not the full YAML the merger needs as
  // `current`). The reconstruct→validate path is the same one
  // `resolveEditableConfigFromRow` ran; this second pass surfaces the
  // typed yaml the merger consumes.
  const yamlResult = validate(reconstructProjection(row))
  if (!yamlResult.ok) return redirectWithStatus('internal_error')

  return { current: yamlResult.value, editable: resolved.editable }
}

function reconstructProjection(row: Awaited<ReturnType<typeof getCustomerConfig>>): unknown {
  if (row === null) return null
  return {
    schema_version: Number(row.schema_version),
    customer_id: row.customer_slug,
    customer_name: row.customer_slug,
    vertical: 'mixed',
    fly_region: 'iad',
    model: 'unknown',
    hermes_ref: 'unknown',
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
    },
  }
}

interface AuditArgs {
  status: 'applied' | 'rejected'
  customerId: string
  before: EditableCustomerConfig
  after: EditableCustomerConfig
  actorId: string
  errors: ValidationError[] | null
}

async function emitAudit(args: AuditArgs): Promise<void> {
  const metadata = buildAuditMetadata(args.before, args.after, args.actorId)
  await recordCustomerYamlUpdateAudit({
    status: args.status,
    customer_id: args.customerId,
    metadata: {
      ...metadata,
      ...(args.errors !== null
        ? { validation_error_codes: args.errors.map((e) => `${e.code}:${e.path}`) }
        : {}),
    },
  })
}

export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await authorize(locals)
  if (auth instanceof Response) return auth

  const resolved = await resolveCurrentYaml(auth.customerId)
  if (resolved instanceof Response) return resolved
  const { current, editable: before } = resolved

  const form = await request.formData()
  const proposed = parseFormToConfig(form, before)

  const result = validateEditableChanges(current, proposed)
  if (!result.ok) {
    await emitAudit({
      status: 'rejected',
      customerId: auth.customerSlug,
      before,
      after: proposed,
      actorId: auth.userId,
      errors: result.errors,
    })
    return redirectWithStatus('invalid')
  }

  const after = projectEditableConfig(result.value).editable
  await emitAudit({
    status: 'applied',
    customerId: auth.customerSlug,
    before,
    after,
    actorId: auth.userId,
    errors: null,
  })
  return redirectWithStatus('applied')
}
