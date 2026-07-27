/**
 * Entitlement tier change — orchestration + governance ledger (#2003 slice 2).
 *
 * One governed path from a client's click to the source of truth:
 *
 *   compile (ceilings + floors)  →  surgical customer.yaml edit
 *                                →  reviewable pull request
 *                                →  governance row
 *
 * Ordering is remote-first, record-second — the same rule the pause control
 * follows: a change whose PR did not open is never recorded as submitted.
 *
 * What a submitted change IS and IS NOT: the PR carries the one-line diff to
 * `customer.yaml`; merging it re-projects config; the running Machine adopts
 * it at its next reprovision. Nothing here changes a live runtime, and no
 * surface may say it did (letter 10 Q7 commits access + audit, not instant
 * self-serve — that is Q6's kill-switch promise, and only that).
 */

import type { D1Database } from '@cloudflare/workers-types'
import {
  compileTierChange,
  type LiveExposure,
  type Rejection,
  type TierChangeDelta,
} from '../../operator/entitlement-compiler'
import type { RoutineGrid } from '../../operator/routine-grid'
import { setExposureKey } from '../../operator/exposure-yaml-edit'
import { openConfigPr, type ConfigPrEnv } from '../../operator/config-pr'

export interface TierChangeActor {
  userId: string
  email: string
  role: string
}

export interface TierChangeInput {
  entityId: string
  customerSlug: string
  routine: string
  targetTier: string
  reason: string
  vertical: string | null
  actor: TierChangeActor
  source: 'portal' | 'admin'
}

export type TierChangeOutcome =
  | { kind: 'submitted'; prUrl: string; prNumber: number; delta: TierChangeDelta }
  | { kind: 'noop'; delta: TierChangeDelta }
  | { kind: 'rejected'; rejections: readonly Rejection[] }
  | { kind: 'failed'; error: string }

/** Repo path of a seat's authored config. */
export function customerYamlPath(slug: string): string {
  return `operator/customers/${slug}/customer.yaml`
}

/**
 * Branch name for one submission. Deterministic in its inputs except for the
 * caller-supplied `nonce` (a request id / timestamp the caller owns) — this
 * module never reads the clock, so it stays pure enough to test.
 */
export function changeBranchName(slug: string, routine: string, nonce: string): string {
  const slugified = routine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `operator-entitlement/${slug}/${slugified}-${nonce}`
}

function prBody(input: TierChangeInput, delta: TierChangeDelta): string {
  const changes = delta.exposureChanges
    .map(
      (c) =>
        `- \`${c.actionClass}\`: ${c.from ?? '(unauthored)'} → ${c.to ?? '(unauthored — fail-closed)'} (${c.direction})`
    )
    .join('\n')
  return [
    `Entitlement tier change submitted from the ${input.source === 'portal' ? 'client portal' : 'admin console'}.`,
    '',
    `**Routine:** ${delta.routine}`,
    `**Tier:** ${delta.fromTier} → ${delta.toTier}`,
    `**Skills affected:** ${delta.skills.join(', ')}`,
    '',
    '**Compiled exposure delta**',
    changes,
    '',
    `**Requested by:** ${input.actor.email} (${input.actor.role})`,
    `**Reason given:** ${input.reason}`,
    '',
    'Compiled by `src/lib/operator/entitlement-compiler.ts`: the target is at or below',
    "this routine's committed letter ceiling and clears every vertical floor.",
    'Merging re-projects the config; the running Machine adopts it at its next reprovision.',
  ].join('\n')
}

/**
 * Execute one tier change end to end. `readYaml` supplies the current file
 * text (injected so this is testable without git); `nonce` makes the branch
 * unique.
 */
export async function submitTierChange(
  db: D1Database,
  env: ConfigPrEnv,
  deps: { grid: RoutineGrid; live: LiveExposure; readYaml: () => Promise<string>; nonce: string },
  input: TierChangeInput
): Promise<TierChangeOutcome> {
  const compiled = compileTierChange(deps.grid, deps.live, {
    routine: input.routine,
    targetTier: input.targetTier,
    vertical: input.vertical,
  })
  if (!compiled.ok) return { kind: 'rejected', rejections: compiled.rejections }
  const delta = compiled.delta
  if (delta.noop) return { kind: 'noop', delta }

  let nextYaml: string
  try {
    let text = await deps.readYaml()
    for (const change of delta.exposureChanges) {
      const edited = setExposureKey(text, change.personaSlug, change.actionClass, change.to)
      if (!edited.ok) return { kind: 'failed', error: edited.error }
      text = edited.text
    }
    nextYaml = text
  } catch (err) {
    return { kind: 'failed', error: err instanceof Error ? err.message : 'config read failed' }
  }

  const branch = changeBranchName(input.customerSlug, delta.routine, deps.nonce)
  const title = `config(${input.customerSlug}): ${delta.routine} → ${delta.toTier}`

  let pr
  try {
    pr = await openConfigPr(env, {
      path: customerYamlPath(input.customerSlug),
      content: nextYaml,
      branch,
      title,
      body: prBody(input, delta),
    })
  } catch (err) {
    return { kind: 'failed', error: err instanceof Error ? err.message : 'pull request failed' }
  }

  await db
    .prepare(
      'INSERT INTO operator_entitlement_changes ' +
        '(id, entity_id, customer_slug, routine, from_tier, to_tier, delta_json, actor_user_id, ' +
        'actor_email, actor_role, source, reason, status, pr_url, pr_number) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      crypto.randomUUID(),
      input.entityId,
      input.customerSlug,
      delta.routine,
      delta.fromTier,
      delta.toTier,
      JSON.stringify(delta.exposureChanges),
      input.actor.userId,
      input.actor.email,
      input.actor.role,
      input.source,
      input.reason,
      'submitted',
      pr.url,
      pr.number
    )
    .run()

  return { kind: 'submitted', prUrl: pr.url, prNumber: pr.number, delta }
}

export interface EntitlementChangeRow {
  id: string
  routine: string
  from_tier: string
  to_tier: string
  actor_email: string
  actor_role: string
  source: string
  reason: string
  status: string
  pr_url: string | null
  created_at: string
}

/** Submitted changes for one customer, newest first (audit + portal surface). */
export async function listEntitlementChanges(
  db: D1Database,
  customerSlug: string,
  limit = 50
): Promise<EntitlementChangeRow[]> {
  const res = await db
    .prepare(
      'SELECT id, routine, from_tier, to_tier, actor_email, actor_role, source, reason, ' +
        'status, pr_url, created_at FROM operator_entitlement_changes ' +
        'WHERE customer_slug = ? ORDER BY created_at DESC LIMIT ?'
    )
    .bind(customerSlug, limit)
    .all<EntitlementChangeRow>()
  return res.results ?? []
}
