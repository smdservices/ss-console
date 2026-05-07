/**
 * New Business Detection Worker — Pipeline 3
 *
 * Pulls Arizona city permit/license records, routes business-owned records
 * through Claude qualification, and treats contractor/unknown records as
 * enrichment-only permit observations that must resolve to an operating
 * business at ingest time or be dropped.
 */

import { ORG_ID } from '../../../src/lib/constants.js'
import { findOrCreateEntity } from '../../../src/lib/db/entities.js'
import { appendContext } from '../../../src/lib/db/context.js'
import { getGeneratorConfig, recordGeneratorRun } from '../../../src/lib/db/generators.js'
import { getPipelineSettings } from '../../../src/lib/db/pipeline-settings.js'
import type { NewBusinessConfig } from '../../../src/lib/generators/types.js'
import { dispatchEnrichmentWorkflow } from '../../../src/lib/enrichment/dispatch.js'
import { fetchAllPermits, type PermitRecord } from './soda.js'
import { qualifyNewBusiness, derivePainScore } from './qualify.js'
import { sendFailureAlert, type RunSummary } from './alert.js'
import {
  buildAddressIndex,
  extractAreaFromAddress,
  recordAddressCandidate,
  type AddressCandidate,
} from './address-index.js'
import { recoverPermitEntity } from './recovery.js'

export interface Env {
  DB: D1Database
  ANTHROPIC_API_KEY: string
  RESEND_API_KEY: string
  LEAD_INGEST_API_KEY: string
  GOOGLE_PLACES_API_KEY?: string
  OUTSCRAPER_API_KEY?: string
  SERPAPI_API_KEY?: string
  PROXYCURL_API_KEY?: string
  ENRICHMENT_WORKFLOW_SERVICE?: { fetch: typeof fetch }
}

function buildSignalContent(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n\n')
}

type NewBusinessQualification = NonNullable<Awaited<ReturnType<typeof qualifyNewBusiness>>>

function buildBusinessSignalMetadata(
  permit: PermitRecord,
  painScore: number,
  qualification: NewBusinessQualification
): Record<string, unknown> {
  const sourceLabel =
    permit.source === 'scottsdale_license' ? 'New business license' : 'Commercial permit'
  return {
    permit_number: permit.permit_number ?? null,
    permit_type: permit.permit_type ?? null,
    entity_type: qualification?.entity_type ?? permit.entity_type,
    filing_date: permit.filing_date,
    source: qualification?.source ?? permit.source,
    vertical_match: qualification?.vertical_match ?? 'unknown',
    size_estimate: qualification?.size_estimate ?? 'unknown',
    outreach_timing: qualification?.outreach_timing ?? null,
    pain_score: painScore,
    actor_role: permit.actor_role,
    owner_name: permit.owner_name ?? null,
    signal_source_label: sourceLabel,
    signal_subject: permit.business_name,
    signal_location: extractAreaFromAddress(permit.address),
    signal_date: permit.filing_date,
    signal_address: permit.address,
    date_found: new Date().toISOString().split('T')[0],
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function queueEnrichment(
  env: Pick<Env, 'DB' | 'ENRICHMENT_WORKFLOW_SERVICE'>,
  ctx: ExecutionContext | undefined,
  entityId: string,
  triggeredBy: string
): void {
  if (!ctx) return
  ctx.waitUntil(
    dispatchEnrichmentWorkflow(env, {
      entityId,
      orgId: ORG_ID,
      mode: 'full',
      triggered_by: triggeredBy,
    }).catch((error: unknown) => {
      console.error('[new_business] enrichment dispatch failed', {
        entityId,
        error: toErrorMessage(error),
      })
    })
  )
}

async function signalAlreadyProcessed(db: D1Database, sourceRef?: string): Promise<boolean> {
  if (!sourceRef) return false
  const existing = await db
    .prepare(
      `SELECT 1 FROM context WHERE org_id = ? AND source = 'new_business' AND source_ref = ?`
    )
    .bind(ORG_ID, sourceRef)
    .first()
  return Boolean(existing)
}

interface ProcessPermitContext {
  env: Env
  ctx?: ExecutionContext
  summary: RunSummary
  painThreshold: number
  addressIndex: Map<string, AddressCandidate[]>
  weeklyBudgetUsd: number
}

async function processOnePermit(
  permit: PermitRecord,
  context: ProcessPermitContext
): Promise<void> {
  const { env, ctx, summary, painThreshold, addressIndex, weeklyBudgetUsd } = context
  if (await signalAlreadyProcessed(env.DB, permit.permit_number)) return

  summary.newPermits++

  if (permit.actor_role !== 'business') {
    summary.droppedByRole++
    await recoverPermitEntity(permit, {
      env,
      ctx,
      summary,
      addressIndex,
      weeklyBudgetUsd,
    })
    return
  }

  const qualification = await qualifyNewBusiness(permit, env.ANTHROPIC_API_KEY)
  if (!qualification) {
    summary.errors++
    summary.errorDetails.push(`Claude failed for "${permit.business_name}"`)
    return
  }

  const painScore = derivePainScore(qualification)
  if (painScore < painThreshold) {
    if (qualification.outreach_timing === 'not_recommended') {
      summary.disqualified++
    } else {
      summary.belowThreshold++
    }
    return
  }

  summary.qualified++
  const result = await findOrCreateEntity(env.DB, ORG_ID, {
    name: qualification.business_name,
    area: qualification.area,
    source_pipeline: 'new_business',
  })

  const content = buildSignalContent([
    `${qualification.entity_type} · ${qualification.source}`,
    qualification.notes,
  ])

  await appendContext(env.DB, ORG_ID, {
    entity_id: result.entity.id,
    type: 'signal',
    content: content || 'Signal from new_business.',
    source: 'new_business',
    source_ref: permit.permit_number,
    metadata: buildBusinessSignalMetadata(permit, painScore, qualification),
  })
  summary.written++
  recordAddressCandidate(addressIndex, permit.address, result.entity)
  queueEnrichment(env, ctx, result.entity.id, 'cron:new-business')
}

async function run(env: Env, ctx?: ExecutionContext): Promise<RunSummary> {
  const summary: RunSummary = {
    sources: 0,
    totalPermits: 0,
    newPermits: 0,
    qualified: 0,
    disqualified: 0,
    belowThreshold: 0,
    written: 0,
    droppedByRole: 0,
    droppedOrphan: 0,
    recoveredTier1: 0,
    recoveredTier3: 0,
    budgetSkipped: 0,
    errors: 0,
    errorDetails: [],
  }

  const settings = await getPipelineSettings(env.DB, ORG_ID, 'new_business')
  const painThreshold = settings.pain_threshold
  const weeklyBudgetUsd = settings.weekly_places_budget_usd

  const configRow = await getGeneratorConfig(env.DB, ORG_ID, 'new_business')
  if (!configRow.enabled) {
    console.log('new_business: disabled by admin config - skipping run')
    await recordGeneratorRun(env.DB, ORG_ID, 'new_business', { signalsCount: 0, error: null })
    return summary
  }

  const cfg = configRow.config as NewBusinessConfig
  const enabledCities = cfg.soda_sources
    .filter((source) => source.enabled)
    .map((source) => source.city)
  summary.sources = enabledCities.length
  const addressIndex = await buildAddressIndex(env.DB)

  const permits = await fetchAllPermits(enabledCities)
  summary.totalPermits = permits.length
  console.log(
    `SODA: ${summary.totalPermits} total permits from ${enabledCities.length} enabled sources`
  )

  for (const permit of permits) {
    try {
      await processOnePermit(permit, {
        env,
        ctx,
        summary,
        painThreshold,
        addressIndex,
        weeklyBudgetUsd,
      })
    } catch (err) {
      summary.errors++
      const msg = err instanceof Error ? err.message : String(err)
      summary.errorDetails.push(`Permit "${permit.business_name}": ${msg}`)
    }
  }

  console.log(
    `Run complete: ${summary.newPermits} new, ${summary.qualified} qualified, ` +
      `${summary.droppedByRole} diverted by actor role, ${summary.droppedOrphan} dropped orphan, ` +
      `${summary.recoveredTier1} tier1 recovered, ${summary.recoveredTier3} tier3 recovered, ` +
      `${summary.written} written, ${summary.errors} errors`
  )

  await recordGeneratorRun(env.DB, ORG_ID, 'new_business', {
    signalsCount: summary.written,
    error: summary.errors > 0 ? summary.errorDetails.slice(0, 3).join(' | ') : null,
  })

  return summary
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const summary = await run(env, ctx)
    if (summary.written === 0 && summary.errors > 0 && env.RESEND_API_KEY) {
      ctx.waitUntil(sendFailureAlert(summary, env.RESEND_API_KEY))
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const auth = request.headers.get('Authorization')
    if (auth !== `Bearer ${env.LEAD_INGEST_API_KEY}`) {
      return new Response('Unauthorized', { status: 401 })
    }
    const summary = await run(env, ctx)
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
} satisfies ExportedHandler<Env>
