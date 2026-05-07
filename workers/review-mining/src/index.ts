/**
 * Review Mining Worker — Pipeline 1
 *
 * Cloudflare Worker cron job that discovers Phoenix-area businesses via
 * Google Places, fetches recent reviews via Outscraper, scores them with
 * Claude for operational pain signals, and writes high-scoring leads to D1.
 *
 * Schedule: Weekly on Monday at 8:00 AM MST (15:00 UTC)
 * Trigger: Also via POST /run with Authorization: Bearer <LEAD_INGEST_API_KEY>
 * Flow: Google Places discovery → Outscraper reviews → D1 dedup → Claude score → filter pain >= 7 → D1 write
 * Threshold: pain_score >= 7 qualifies for the Lead Inbox
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

// Per-business Outscraper cost. Reviews extraction is ~$3 per 1,000 place_ids
// queried regardless of how many reviews come back. Source:
// docs/lead-automation/specs/outscraper-queries.md ("Outscraper Pricing").
const OUTSCRAPER_USD_PER_PLACE = 0.003

// Pain threshold + per-run cap + Outscraper budget guard now read from the
// `pipeline_settings` table at the top of every run (issue #595). Defaults
// in `src/lib/db/pipeline-settings.ts` match the constants that previously
// shipped here (pain=7, cap=200, budget=$1.00) so the deploy is a no-op
// until ops explicitly tunes a value via the admin UI.

export interface Env {
  DB: D1Database
  GOOGLE_PLACES_API_KEY: string
  OUTSCRAPER_API_KEY: string
  ANTHROPIC_API_KEY: string
  RESEND_API_KEY: string
  LEAD_INGEST_API_KEY: string
  // Optional keys used by the at-ingest enrichment pipeline.
  SERPAPI_API_KEY?: string
  PROXYCURL_API_KEY?: string
  /** Service binding to ss-enrichment-workflow Worker (#631). */
  ENRICHMENT_WORKFLOW_SERVICE?: { fetch: typeof fetch }
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
      for (const b of businesses) {
        if (!seen.has(b.place_id)) {
          seen.add(b.place_id)
          all.push(b)
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
  const BATCH_SIZE = 10
  const withReviews: BusinessWithReviews[] = []
  for (let i = 0; i < businesses.length; i += BATCH_SIZE) {
    const batch = businesses.slice(i, i + BATCH_SIZE)
    const projected = summary.outscraperSpendUsd + batch.length * OUTSCRAPER_USD_PER_PLACE
    if (projected > budgetUsd) {
      summary.budgetGuardTripped = true
      console.warn(
        `Outscraper budget guard: projected $${projected.toFixed(2)} would exceed ` +
          `$${budgetUsd.toFixed(2)}. Stopping after ${summary.reviewChecksAttempted} of ` +
          `${businesses.length} businesses.`
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
  const evidenceSummary = scoring.signals.map((s) => `${s.problem_id}: "${s.quote}"`).join(' | ')
  const parts: string[] = []
  if (evidenceSummary) parts.push(evidenceSummary)
  if (scoring.outreach_angle) parts.push(`**Outreach angle:** ${scoring.outreach_angle}`)
  return parts.join('\n\n') || 'Signal from review_mining.'
}

function buildReviewMetadata(
  business: DiscoveredBusiness,
  scoring: Awaited<ReturnType<typeof scoreReviews>>
): Record<string, unknown> {
  return {
    place_id: scoring?.place_id ?? business.place_id,
    google_rating: business.rating,
    review_count: business.total_reviews,
    signals_count: scoring?.signals.length ?? 0,
    ...(scoring?.pain_score != null ? { pain_score: scoring.pain_score } : {}),
    ...(scoring?.top_problems ? { top_problems: scoring.top_problems } : {}),
    ...(scoring?.outreach_angle ? { outreach_angle: scoring.outreach_angle } : {}),
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
  if (scoring.pain_score < painThreshold) {
    summary.belowThreshold++
    return
  }

  summary.qualified++
  const { entity } = await findOrCreateEntity(env.DB, ORG_ID, {
    name: scoring.business_name,
    area: business.area,
    phone: business.phone,
    website: business.website,
    source_pipeline: 'review_mining',
  })

  await appendContext(env.DB, ORG_ID, {
    entity_id: entity.id,
    type: 'signal',
    content: buildReviewContent(scoring),
    source: 'review_mining',
    source_ref: business.place_id,
    metadata: buildReviewMetadata(business, scoring),
  })
  summary.written++

  const dispatchPromise = dispatchEnrichmentWorkflow(env, {
    entityId: entity.id,
    orgId: ORG_ID,
    mode: 'full',
    triggered_by: 'cron:review-mining',
  }).catch((err) => {
    console.error('[review_mining] enrichment dispatch failed', { entityId: entity.id, error: err })
  })
  if (ctx) ctx.waitUntil(dispatchPromise)
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
    written: 0,
    errors: 0,
    errorDetails: [],
    outscraperSpendUsd: 0,
    budgetGuardTripped: false,
  }

  // Resolve admin-tunable settings at the TOP of every run so the next cron
  // tick picks up admin changes without a worker restart (issue #595).
  const settings = await getPipelineSettings(env.DB, ORG_ID, 'review_mining')
  const painThreshold = settings.pain_threshold
  const maxReviewChecks = settings.max_review_checks
  const budgetUsd = settings.outscraper_budget_usd_per_run

  const configRow = await getGeneratorConfig(env.DB, ORG_ID, 'review_mining')
  if (!configRow.enabled) {
    console.log('review_mining: disabled by admin config — skipping run')
    await recordGeneratorRun(env.DB, ORG_ID, 'review_mining', { signalsCount: 0, error: null })
    return summary
  }
  const cfg = configRow.config as ReviewMiningConfig
  const geoBias = { center: cfg.geo_center, radiusKm: cfg.geo_radius_km }

  const allBusinesses = await discoverAllBusinesses(
    cfg.discovery_queries,
    env.GOOGLE_PLACES_API_KEY,
    geoBias,
    summary
  )
  summary.discovered = allBusinesses.length
  console.log(`Discovery: ${summary.queries} queries, ${summary.discovered} unique businesses`)

  const toCheck = allBusinesses.slice(0, maxReviewChecks)
  console.log(
    `Checking reviews for ${toCheck.length} of ${allBusinesses.length} businesses (cap=${maxReviewChecks}, budget=$${budgetUsd.toFixed(2)})`
  )
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
    `Run complete: ${summary.newBusinesses} new, ${summary.qualified} qualified (pain>=${painThreshold}), ` +
      `${summary.belowThreshold} below threshold, ${summary.written} written, ${summary.errors} errors, ` +
      `Outscraper spend ~$${summary.outscraperSpendUsd.toFixed(2)}` +
      (summary.budgetGuardTripped ? ' (budget guard tripped)' : '')
  )

  await recordGeneratorRun(env.DB, ORG_ID, 'review_mining', {
    signalsCount: summary.written,
    error: summary.errors > 0 ? summary.errorDetails.slice(0, 3).join(' · ') : null,
  })

  return summary
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
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
