/**
 * Review Mining Worker — Pipeline 1
 *
 * Discovers Arizona businesses via Google Places, filters out closed
 * businesses and likely chains, scores recent reviews for operational pain,
 * and writes factual review signals to D1.
 */

import { ORG_ID } from '../../../src/lib/constants.js'
import { findOrCreateEntity } from '../../../src/lib/db/entities.js'
import { appendContext } from '../../../src/lib/db/context.js'
import { getGeneratorConfig, recordGeneratorRun } from '../../../src/lib/db/generators.js'
import { getPipelineSettings } from '../../../src/lib/db/pipeline-settings.js'
import type { ReviewMiningConfig } from '../../../src/lib/generators/types.js'
import { dispatchEnrichmentWorkflow } from '../../../src/lib/enrichment/dispatch.js'
import { discoverBusinesses, fetchReviews } from './outscraper.js'
import { scoreReviews } from './qualify.js'
import { sendFailureAlert, type RunSummary } from './alert.js'
import type { DiscoveredBusiness, BusinessWithReviews, GeoBias } from './outscraper.js'

const OUTSCRAPER_USD_PER_PLACE = 0.003

export interface Env {
  DB: D1Database
  GOOGLE_PLACES_API_KEY: string
  OUTSCRAPER_API_KEY: string
  ANTHROPIC_API_KEY: string
  RESEND_API_KEY: string
  LEAD_INGEST_API_KEY: string
  SERPAPI_API_KEY?: string
  PROXYCURL_API_KEY?: string
  ENRICHMENT_WORKFLOW_SERVICE?: { fetch: typeof fetch }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function queueEnrichment(
  env: Pick<Env, 'DB' | 'ENRICHMENT_WORKFLOW_SERVICE'>,
  ctx: ExecutionContext | undefined,
  entityId: string
): void {
  if (!ctx) return
  ctx.waitUntil(
    dispatchEnrichmentWorkflow(env, {
      entityId,
      orgId: ORG_ID,
      mode: 'full',
      triggered_by: 'cron:review-mining',
    }).catch((error: unknown) => {
      console.error('[review_mining] enrichment dispatch failed', {
        entityId,
        error: toErrorMessage(error),
      })
    })
  )
}

async function discoverAllBusinesses(
  queries: string[],
  apiKey: string,
  geoBias: GeoBias,
  summary: RunSummary
): Promise<DiscoveredBusiness[]> {
  const all: DiscoveredBusiness[] = []
  const seen = new Set<string>()
  for (const query of queries) {
    summary.queries++
    try {
      const businesses = await discoverBusinesses(query, apiKey, geoBias)
      for (const business of businesses) {
        if (!seen.has(business.place_id)) {
          seen.add(business.place_id)
          all.push(business)
        }
      }
    } catch (err) {
      summary.errors++
      summary.errorDetails.push(
        `Discovery "${query}": ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  return all
}

async function fetchAllReviews(
  businesses: DiscoveredBusiness[],
  apiKey: string,
  budgetUsd: number,
  summary: RunSummary
): Promise<BusinessWithReviews[]> {
  const batchSize = 10
  const withReviews: BusinessWithReviews[] = []
  for (let i = 0; i < businesses.length; i += batchSize) {
    const batch = businesses.slice(i, i + batchSize)
    const projected = summary.outscraperSpendUsd + batch.length * OUTSCRAPER_USD_PER_PLACE
    if (projected > budgetUsd) {
      summary.budgetGuardTripped = true
      console.warn(
        `Outscraper budget guard: projected $${projected.toFixed(2)} would exceed $${budgetUsd.toFixed(2)}.`
      )
      break
    }

    summary.reviewChecksAttempted += batch.length
    summary.outscraperSpendUsd += batch.length * OUTSCRAPER_USD_PER_PLACE
    try {
      const results = await fetchReviews(batch, apiKey)
      withReviews.push(...results)
    } catch (err) {
      summary.errors++
      summary.errorDetails.push(
        `Outscraper batch ${i}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  return withReviews
}

function buildReviewContent(scoring: Awaited<ReturnType<typeof scoreReviews>>): string {
  if (!scoring) return 'Signal from review_mining.'
  const evidenceSummary = scoring.signals
    .map((signal) => `${signal.problem_id}: "${signal.quote}"`)
    .join(' | ')
  return evidenceSummary || 'Signal from review_mining.'
}

function buildReviewMetadata(
  business: BusinessWithReviews,
  scoring: Awaited<ReturnType<typeof scoreReviews>>
): Record<string, unknown> {
  return {
    place_id: scoring?.place_id ?? business.place_id,
    google_rating: business.rating,
    review_count: business.total_reviews,
    signals_count: scoring?.signals.length ?? 0,
    ...(scoring?.pain_score != null ? { pain_score: scoring.pain_score } : {}),
    ...(scoring?.top_problems ? { top_problems: scoring.top_problems } : {}),
    chain_status: scoring?.chain_status ?? null,
    business_status: business.business_status,
    place_types: business.place_types,
    signal_source_label: 'Google reviews',
    signal_subject: business.name,
    signal_location: business.area,
    signal_date: new Date().toISOString().split('T')[0],
    date_found: new Date().toISOString().split('T')[0],
  }
}

async function processOneBusiness(
  business: BusinessWithReviews,
  env: Env,
  ctx: ExecutionContext | undefined,
  summary: RunSummary,
  painThreshold: number
): Promise<void> {
  const alreadyProcessed = await env.DB.prepare(
    `SELECT 1 FROM context WHERE org_id = ? AND source = 'review_mining' AND source_ref = ?`
  )
    .bind(ORG_ID, business.place_id)
    .first()
  if (alreadyProcessed) return

  summary.newBusinesses++
  const scoring = await scoreReviews(business, env.ANTHROPIC_API_KEY)
  if (!scoring) {
    summary.errors++
    summary.errorDetails.push(`Claude failed for "${business.name}"`)
    return
  }
  if (scoring.chain_status === 'likely_chain') {
    summary.droppedLikelyChain++
    return
  }
  if (scoring.pain_score < painThreshold) {
    summary.belowThreshold++
    return
  }

  summary.qualified++
  const result = await findOrCreateEntity(env.DB, ORG_ID, {
    name: scoring.business_name,
    area: business.area,
    phone: business.phone,
    website: business.website,
    source_pipeline: 'review_mining',
  })

  await appendContext(env.DB, ORG_ID, {
    entity_id: result.entity.id,
    type: 'signal',
    content: buildReviewContent(scoring),
    source: 'review_mining',
    source_ref: business.place_id,
    metadata: buildReviewMetadata(business, scoring),
  })
  summary.written++

  queueEnrichment(env, ctx, result.entity.id)
}

async function run(env: Env, ctx?: ExecutionContext): Promise<RunSummary> {
  const summary: RunSummary = {
    queries: 0,
    discovered: 0,
    reviewChecksAttempted: 0,
    withReviews: 0,
    newBusinesses: 0,
    qualified: 0,
    belowThreshold: 0,
    droppedClosed: 0,
    droppedLikelyChain: 0,
    written: 0,
    errors: 0,
    errorDetails: [],
    outscraperSpendUsd: 0,
    budgetGuardTripped: false,
  }

  const settings = await getPipelineSettings(env.DB, ORG_ID, 'review_mining')
  const painThreshold = settings.pain_threshold
  const maxReviewChecks = settings.max_review_checks
  const budgetUsd = settings.outscraper_budget_usd_per_run

  const configRow = await getGeneratorConfig(env.DB, ORG_ID, 'review_mining')
  if (!configRow.enabled) {
    console.log('review_mining: disabled by admin config - skipping run')
    await recordGeneratorRun(env.DB, ORG_ID, 'review_mining', { signalsCount: 0, error: null })
    return summary
  }
  const cfg = configRow.config as ReviewMiningConfig
  const geoBias = { center: cfg.geo_center, radiusKm: cfg.geo_radius_km }

  const discovered = await discoverAllBusinesses(
    cfg.discovery_queries,
    env.GOOGLE_PLACES_API_KEY,
    geoBias,
    summary
  )

  const openBusinesses = discovered.filter((business) => {
    if (business.business_status === 'OPERATIONAL') return true
    summary.droppedClosed++
    return false
  })

  summary.discovered = openBusinesses.length
  console.log(`Discovery: ${summary.queries} queries, ${summary.discovered} open businesses`)

  const toCheck = openBusinesses.slice(0, maxReviewChecks)
  const businessesWithReviews = await fetchAllReviews(
    toCheck,
    env.OUTSCRAPER_API_KEY,
    budgetUsd,
    summary
  )
  summary.withReviews = businessesWithReviews.length
  console.log(`Reviews: ${summary.withReviews} businesses with recent reviews`)

  for (const business of businessesWithReviews) {
    try {
      await processOneBusiness(business, env, ctx, summary, painThreshold)
    } catch (err) {
      summary.errors++
      summary.errorDetails.push(
        `Score "${business.name}": ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  console.log(
    `Run complete: ${summary.qualified} qualified, ${summary.droppedClosed} closed dropped, ` +
      `${summary.droppedLikelyChain} chain dropped, ${summary.written} written, ${summary.errors} errors`
  )

  await recordGeneratorRun(env.DB, ORG_ID, 'review_mining', {
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
