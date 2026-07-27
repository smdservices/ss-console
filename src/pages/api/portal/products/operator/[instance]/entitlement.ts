import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveOperatorAccess } from '../../../../../../lib/portal/operator-access'
import { getCustomerConfigBySlug } from '../../../../../../lib/portal/customer-config'
import { clientRolePermits } from '../../../../../../lib/portal/operator/client-rbac'
import { resolveDomainSurfaceMode } from '../../../../../../lib/portal/operator/domain-surface'
import { readConfigFile } from '../../../../../../lib/operator/config-pr'
import type { LiveExposure } from '../../../../../../lib/operator/entitlement-compiler'
import {
  customerYamlPath,
  submitTierChange,
} from '../../../../../../lib/portal/operator/entitlement-change'

/**
 * POST /api/portal/products/operator/[instance]/entitlement — the entitlement
 * control (#2003, A&P diligence reply Q7).
 *
 * Form fields: routine, targetTier, reason (all required).
 *
 * Q7 commits ACCESS + AUDIT ("the portal gives authorized users access to...
 * the entitlement settings... every change is logged with who made it and
 * when"), NOT instant self-serve — that is Q6's kill-switch promise alone.
 * So a submitted change opens a reviewable pull request against the seat's
 * customer.yaml; merging re-projects it and the Machine adopts it at its next
 * reprovision. Every status string this route returns says "submitted",
 * never "applied".
 *
 * Enforcement chain:
 *  1. resolveOperatorAccess — Clerk session, entity binding, live
 *     subscription, role ∈ {principal}
 *  2. `trust` authority domain must be client-operable AND the role matrix
 *     must permit; unauthored authority = managed = refused (fail-closed)
 *  3. compileTierChange — letter ceiling + vertical floor, both non-raisable
 *  4. PR first, governance row second (never record an unopened change)
 */

const OPERATOR_LANDING = '/portal/products/operator'

function redirectWithStatus(instance: string, status: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${OPERATOR_LANDING}/${instance}/settings?status=${encodeURIComponent(status)}`,
    },
  })
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  const instance = typeof params.instance === 'string' ? params.instance : ''
  if (instance === '') return new Response('Not found', { status: 404 })

  const access = await resolveOperatorAccess(env.DB, locals, {
    allowedRoles: ['principal'],
    customerSlug: instance,
  })
  if (access.kind === 'redirect') return new Response('Forbidden', { status: 403 })

  const config = await getCustomerConfigBySlug(env.DB, instance)
  const mode = resolveDomainSurfaceMode(
    config?.authority ?? null,
    'trust',
    clientRolePermits(access.roles, 'trust')
  )
  if (mode !== 'operable') return redirectWithStatus(instance, 'entitlement_not_operable')

  const formData = await request.formData()
  const field = (name: string): string => {
    const v = formData.get(name)
    return typeof v === 'string' ? v.trim() : ''
  }
  const routine = field('routine')
  const targetTier = field('targetTier')
  const reason = field('reason')
  if (routine === '' || targetTier === '') {
    return redirectWithStatus(instance, 'entitlement_invalid_request')
  }
  if (reason === '') return redirectWithStatus(instance, 'entitlement_reason_required')

  // A Worker has no filesystem: the grid and the live exposure come from the
  // D1 projection, and the authored TEXT comes from git at the base branch
  // (the same bytes the PR is based on — no bundled-copy drift).
  const resolved = resolveGridAndExposure(config)
  if (!resolved) return redirectWithStatus(instance, 'entitlement_config_unreadable')

  // Narrow the Worker env to exactly the transport's credential surface.
  const prEnv = { OPERATOR_CONFIG_PR_TOKEN: env.OPERATOR_CONFIG_PR_TOKEN }

  const outcome = await submitTierChange(
    env.DB,
    prEnv,
    {
      grid: resolved.grid,
      live: resolved.live,
      readYaml: () => readConfigFile(prEnv, customerYamlPath(instance)),
      nonce: crypto.randomUUID().slice(0, 8),
    },
    {
      entityId: access.client.id,
      customerSlug: instance,
      routine,
      targetTier,
      reason,
      vertical: config?.vertical ?? null,
      actor: { userId: access.user.id, email: access.user.email, role: 'principal' },
      source: 'portal',
    }
  )

  return redirectWithStatus(instance, statusFor(outcome))
}

/**
 * Grid + live persona exposure from the projection, or null when either is
 * absent (a seat whose grid has never been projected cannot be configured
 * from here — refuse rather than guess).
 */
function resolveGridAndExposure(
  config: Awaited<ReturnType<typeof getCustomerConfigBySlug>>
): { grid: NonNullable<NonNullable<typeof config>['routine_grid']>; live: LiveExposure } | null {
  const grid = config?.routine_grid ?? null
  if (!grid) return null
  const persona = config?.personas.find((p) => p.slug === grid.persona)
  if (!persona) return null
  return {
    grid,
    live: {
      personaSlug: persona.slug,
      exposure: persona.entitlements.exposure,
    },
  }
}

/** Outcome → status slug the settings page renders as client copy. */
function statusFor(outcome: Awaited<ReturnType<typeof submitTierChange>>): string {
  switch (outcome.kind) {
    case 'submitted':
      return 'entitlement_submitted'
    case 'noop':
      return 'entitlement_no_change'
    case 'rejected':
      return `entitlement_rejected_${outcome.rejections[0].code}`
    default:
      return 'entitlement_failed'
  }
}
