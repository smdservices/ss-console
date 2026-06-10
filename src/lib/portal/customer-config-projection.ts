/**
 * Forward projection: validated `customer.yaml` → the `customer_configs` D1 row.
 *
 * This is the **canonical mapper** for the ADR 0012 projection (git source of
 * truth → portal D1 read replica). The future CI sync pipeline (out of scope
 * here; tracked on #1308) MUST import this function rather than author a second
 * mapping — the read side (`projectRow` in ./customer-config.ts) and this write
 * side must stay exact inverses.
 *
 * Kept pure and env-free (no `cloudflare:workers`) so it is unit-testable and
 * importable from both a Node script (scripts/project-customer-config.ts) and a
 * future Worker/CI context.
 *
 * Critical correctness invariant (see the #1308 critique): the portal reads
 * `personas_json` with `parseJsonRequired`, which THROWS on a shape mismatch —
 * a subtly-wrong row turns a safe "being configured" empty state into a 500 on
 * the live client portal. Two defenses live here:
 *   1. `personas_json` is narrowed to the exact read-side `PersonaConfig` shape
 *      (skills reduced to `{name, trust_ceiling}`).
 *   2. Every nullable field is normalized to `null` (never left `undefined`),
 *      so `JSON.stringify` cannot silently DROP a key the reader expects.
 */

import type { CustomerYaml, Persona } from '../operator/customer-yaml/types'
import type { CustomerConfigDbRow, PersonaConfig } from './customer-config'

export interface ProjectionContext {
  /** The local entities.id this customer maps to (customer_configs PK). */
  entityId: string
  /** Owning organizations.id. */
  orgId: string
  /** Commit SHA of the customer.yaml the projection was built from (ADR 0012). */
  gitSha: string
  /** ISO-8601 timestamp the projection ran. */
  syncedAt: string
}

/**
 * Narrow a full schema `Persona` to the read-side `PersonaConfig`. Drops the
 * fields the portal projection does not surface (version, action_ceilings,
 * enabled, cost_estimate, scope, bundles, cron, avatar, pronouns, overrides)
 * and reduces each skill to `{name, trust_ceiling}`. Nullable scalars are
 * coerced to `null` so the serialized JSON always carries the key.
 */
function toPersonaConfig(p: Persona): PersonaConfig {
  return {
    slug: p.slug,
    status: p.status,
    name: p.name,
    title: p.title ?? null,
    signature_html: p.signature_html ?? null,
    tone: p.tone ?? [],
    send_as: p.send_as ?? null,
    skills: (p.skills ?? []).map((s) => ({ name: s.name, trust_ceiling: s.trust_ceiling })),
    channel_bindings: (p.channel_bindings ?? []).map((c) => ({
      integration: c.integration,
      channels: c.channels ?? [],
    })),
  }
}

/**
 * Project a validated `CustomerYaml` into the `customer_configs` DB row shape
 * (`CustomerConfigDbRow`) — JSON columns serialized, `compliance_enabled` as
 * 0/1, nullable columns as `null` when the source field is absent.
 *
 * The output is exactly what `projectRow` consumes on read, so a round-trip
 * `projectRow(projectCustomerYamlToConfigRow(yaml, ctx))` must never throw.
 */
export function projectCustomerYamlToConfigRow(
  yaml: CustomerYaml,
  ctx: ProjectionContext
): CustomerConfigDbRow {
  const personas: PersonaConfig[] = yaml.personas.map(toPersonaConfig)

  return {
    entity_id: ctx.entityId,
    org_id: ctx.orgId,
    customer_slug: yaml.customer_id,
    schema_version: String(yaml.schema_version),
    // Required, throwing column — narrowed to the exact read-side shape.
    personas_json: JSON.stringify(personas),
    // Nullable opaque columns: serialize when present, else explicit null.
    voice_library_json: yaml.voice_library ? JSON.stringify(yaml.voice_library) : null,
    escalation_json: yaml.escalation ? JSON.stringify(yaml.escalation) : null,
    business_hours_json: yaml.business_hours ? JSON.stringify(yaml.business_hours) : null,
    connectors_json: yaml.connectors ? JSON.stringify(yaml.connectors) : null,
    scope_json: yaml.scope ? JSON.stringify(yaml.scope) : null,
    // Absent compliance_enabled MUST become 0, never NaN.
    compliance_enabled: yaml.compliance_enabled === true ? 1 : 0,
    vertical: yaml.vertical ?? null,
    // authority is always non-null on a validated CustomerYaml; guard anyway.
    authority_json: yaml.authority ? JSON.stringify(yaml.authority) : null,
    credential_custody_default: yaml.credential_custody_default ?? null,
    git_sha: ctx.gitSha,
    synced_at: ctx.syncedAt,
  }
}

/**
 * Escape a string into a SQLite single-quoted literal (doubling embedded
 * single-quotes), or `NULL`. The projected JSON columns carry arbitrary
 * authored content (HTML in `signature_html`, apostrophes in names, free-form
 * tone strings), so values MUST be applied via `wrangler d1 execute --file`
 * with literals escaped this way — never interpolated into a `--command`
 * string, where a stray quote corrupts the row or the statement.
 */
export function escapeSqlLiteral(v: string | null): string {
  if (v === null) return 'NULL'
  return `'${v.replace(/'/g, "''")}'`
}

const CONFIG_COLUMNS = [
  'entity_id',
  'org_id',
  'customer_slug',
  'schema_version',
  'personas_json',
  'voice_library_json',
  'escalation_json',
  'business_hours_json',
  'connectors_json',
  'scope_json',
  'compliance_enabled',
  'vertical',
  'authority_json',
  'credential_custody_default',
  'git_sha',
  'synced_at',
] as const

/**
 * Build the idempotent `.sql` text for a projected row: an UPSERT into
 * `customer_configs` (re-projection overwrites every column but the PK) plus a
 * `customer_config_history` event that mirrors `recordCustomerConfigSync` —
 * `prev_git_sha` = the slug's latest recorded sha, and the insert is skipped
 * when this exact sha is already recorded (the no-op guard). `synced_by` is
 * `'manual'` because a human runs this under Captain approval.
 */
export function buildProjectionSql(row: CustomerConfigDbRow, actor: string): string {
  const e = escapeSqlLiteral
  const values: string[] = [
    e(row.entity_id),
    e(row.org_id),
    e(row.customer_slug),
    e(row.schema_version),
    e(row.personas_json),
    e(row.voice_library_json),
    e(row.escalation_json),
    e(row.business_hours_json),
    e(row.connectors_json),
    e(row.scope_json),
    String(row.compliance_enabled),
    e(row.vertical),
    e(row.authority_json),
    e(row.credential_custody_default),
    e(row.git_sha),
    e(row.synced_at),
  ]
  const updates = CONFIG_COLUMNS.filter((c) => c !== 'entity_id')
    .map((c) => `  ${c} = excluded.${c}`)
    .join(',\n')
  const slug = e(row.customer_slug)
  const sha = e(row.git_sha)

  return `-- Generated by scripts/project-customer-config.ts — do not hand-edit.
-- customer.yaml projection for customer_slug=${row.customer_slug} (git_sha ${row.git_sha}).

INSERT INTO customer_configs (${CONFIG_COLUMNS.join(', ')})
VALUES (${values.join(', ')})
ON CONFLICT(entity_id) DO UPDATE SET
${updates};

INSERT INTO customer_config_history
  (customer_slug, git_sha, synced_at, synced_by, actor, prev_git_sha, r2_shadow_key)
SELECT ${slug}, ${sha}, ${e(row.synced_at)}, 'manual', ${e(actor)},
  (SELECT git_sha FROM customer_config_history WHERE customer_slug = ${slug} ORDER BY id DESC LIMIT 1),
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM customer_config_history WHERE customer_slug = ${slug} AND git_sha = ${sha}
);
`
}
