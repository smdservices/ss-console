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
import type { ReviewMiningConfig } from '../../../src/lib/generators/types.js'
import { enrichEntity } from '../../../src/lib/enrichment/index.js'
import { discoverBusinesses, fetchReviews } from './outscraper.js'
import { scoreReviews } from './qualify.js'
import { sendFailureAlert, type RunSummary } from './alert.js'
import type { DiscoveredBusiness } from './outscraper.js'

const PAIN_THRESHOLD = 7

// Per-business Outscraper cost. Reviews extraction is ~$3 per 1,000 place_ids
// queried regardless of how many reviews come back. Source:
// docs/lead-automation/specs/outscraper-queries.md ("Outscraper Pricing").
const OUTSCRAPER_USD_PER_PLACE = 0.003

// Default cap on businesses sent to Outscraper per run. Raised from 50 to 200
// per issue #592 to lift the artificial top-of-funnel constraint identified
// in the 2026-04-25 lead-gen audit. At ~$0.003/business that is ~$0.60/run,
// ~$2.40/month at the weekly cron cadence. Both this cap and PAIN_THRESHOLD
// will move into admin config under issue #595; until then they are constants
// here, with `MAX_REVIEW_CHECKS` and `OUTSCRAPER_BUDGET_USD_PER_RUN` env vars
// available as escape hatches without a code deploy.
const DEFAULT_MAX_REVIEW_CHECKS = 200

// Hard ceiling on how much a single run may spend on Outscraper. The cap above
// is the primary constraint; this is a belt-and-suspenders guard so a future
// change to discovery queries, geo radius, or batch logic can't blow through
// the budget unobserved. At default settings (200 places, $0.003/place) a run
// spends ~$0.60, comfortably under the $1.00 default. Override per environment
// via the `OUTSCRAPER_BUDGET_USD_PER_RUN` env var.
const DEFAULT_OUTSCRAPER_BUDGET_USD_PER_RUN = 1.0

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
  // Optional overrides for the per-run cap and budget guard. Both are strings
  // because Wrangler vars are strings; parsed at run start with sane fallbacks.
  // Will be replaced by admin-config in issue #595.
  MAX_REVIEW_CHECKS?: string
  OUTSCRAPER_BUDGET_USD_PER_RUN?: string
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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

  // Resolve the per-run cap and budget guard. Env vars are escape hatches so
  // we can tune live without a code deploy; defaults are the values that
  // shipped with #592. Both move into admin config under #595.
  const maxReviewChecks = parsePositiveInt(env.MAX_REVIEW_CHECKS, DEFAULT_MAX_REVIEW_CHECKS)
  const budgetUsd = parsePositiveFloat(
    env.OUTSCRAPER_BUDGET_USD_PER_RUN,
    DEFAULT_OUTSCRAPER_BUDGET_USD_PER_RUN
  )

  const configRow = await getGeneratorConfig(env.DB, ORG_ID, 'review_mining')
  if (!configRow.enabled) {
    console.log('review_mining: disabled by admin config — skipping run')
    await recordGeneratorRun(env.DB, ORG_ID, 'review_mining', {
      signalsCount: 0,
      error: null,
    })
    return summary
  }
  const cfg = configRow.config as ReviewMiningConfig
  const geoBias = {
    center: cfg.geo_center,
    radiusKm: cfg.geo_radius_km,
  }

  // Phase 1: Discover businesses via Google Places
  const allBusinesses: DiscoveredBusiness[] = []
  const seenPlaceIds = new Set<string>()

  for (const query of cfg.discovery_queries) {
    summary.queries++
    try {
      const businesses = await discoverBusinesses(query, env.GOOGLE_PLACES_API_KEY, geoBias)
      for (const b of businesses) {
        if (!seenPlaceIds.has(b.place_id)) {
          seenPlaceIds.add(b.place_id)
          allBusinesses.push(b)
        }
      }
    } catch (err) {
      summary.errors++
      summary.errorDetails.push(
        `Discovery "${query}": ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  summary.discovered = allBusinesses.length
  console.log(`Discovery: ${summary.queries} queries, ${summary.discovered} unique businesses`)

  // Phase 2: Fetch reviews (one Outscraper call per business).
  // Cap at maxReviewChecks businesses per run AND stop early if the running
  // estimated Outscraper spend exceeds budgetUsd. Outscraper is the only
  // metered call in this loop — Google Places and Anthropic are accounted for
  // outside the budget guard.
  const BATCH_SIZE = 10
  const businessesToCheck = allBusinesses.slice(0, maxReviewChecks)
  const businessesWithReviews = []

  console.log(
    `Checking reviews for ${businessesToCheck.length} of ${allBusinesses.length} businesses ` +
      `(cap=${maxReviewChecks}, budget=$${budgetUsd.toFixed(2)})`
  )

  for (let i = 0; i < businessesToCheck.length; i += BATCH_SIZE) {
    const batch = businessesToCheck.slice(i, i + BATCH_SIZE)
    const projectedSpend = summary.outscraperSpendUsd + batch.length * OUTSCRAPER_USD_PER_PLACE
    if (projectedSpend > budgetUsd) {
      summary.budgetGuardTripped = true
      console.warn(
        `Outscraper budget guard: projected $${projectedSpend.toFixed(2)} would exceed ` +
          `$${budgetUsd.toFixed(2)}. Stopping after ${summary.reviewChecksAttempted} of ` +
          `${businessesToCheck.length} businesses.`
      )
      break
    }
    summary.reviewChecksAttempted += batch.length
    summary.outscraperSpendUsd += batch.length * OUTSCRAPER_USD_PER_PLACE
    try {
      const results = await fetchReviews(batch, env.OUTSCRAPER_API_KEY)
      businessesWithReviews.push(...results)
    } catch (err) {
      summary.errors++
      summary.errorDetails.push(
        `Outscraper batch ${i}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  summary.withReviews = businessesWithReviews.length
  console.log(`Reviews: ${summary.withReviews} businesses with recent reviews`)

  // Phase 3: Score each business
  for (const business of businessesWithReviews) {
    try {
      // Dedup on source_ref (place_id) — skip if we already have this exact signal
      const alreadyProcessed = await env.DB.prepare(
        `SELECT 1 FROM context WHERE org_id = ? AND source = 'review_mining' AND source_ref = ?`
      )
        .bind(ORG_ID, business.place_id)
        .first()

      if (alreadyProcessed) continue

      summary.newBusinesses++

      const scoring = await scoreReviews(business, env.ANTHROPIC_API_KEY)
      if (!scoring) {
        summary.errors++
        summary.errorDetails.push(`Claude failed for "${business.name}"`)
        continue
      }

      if (scoring.pain_score < PAIN_THRESHOLD) {
        summary.belowThreshold++
        continue
      }

      summary.qualified++

      // Find or create entity
      const { entity } = await findOrCreateEntity(env.DB, ORG_ID, {
        name: scoring.business_name,
        area: business.area,
        phone: business.phone,
        website: business.website,
        source_pipeline: 'review_mining',
      })

      // Build context content
      const evidenceSummary = scoring.signals
        .map((s) => `${s.problem_id}: "${s.quote}"`)
        .join(' | ')
      const contentParts: string[] = []
      if (evidenceSummary) contentParts.push(evidenceSummary)
      if (scoring.outreach_angle) {
        contentParts.push(`**Outreach angle:** ${scoring.outreach_angle}`)
      }
      const content = contentParts.join('\n\n') || 'Signal from review_mining.'

      // Build metadata
      const dateFound = new Date().toISOString().split('T')[0]
      const metadata: Record<string, unknown> = {
        place_id: scoring.place_id,
        google_rating: business.rating,
        review_count: business.total_reviews,
        signals_count: scoring.signals.length,
        ...(scoring.pain_score != null ? { pain_score: scoring.pain_score } : {}),
        ...(scoring.top_problems ? { top_problems: scoring.top_problems } : {}),
        ...(scoring.outreach_angle ? { outreach_angle: scoring.outreach_angle } : {}),
        date_found: dateFound,
      }

      // Append context (source_ref = place_id for dedup across runs)
      await appendContext(env.DB, ORG_ID, {
        entity_id: entity.id,
        type: 'signal',
        content,
        source: 'review_mining',
        source_ref: business.place_id,
        metadata,
      })

      summary.written++

      // At-ingest enrichment (issue #471). Detached — the review-mining run
      // already pays for Outscraper per business, and enrichment adds the
      // Claude-powered dossier so the admin has something to act on without
      // a second button click. Idempotent on re-runs.
      const enrichPromise = enrichEntity(env, ORG_ID, entity.id, {
        mode: 'full',
        triggered_by: 'cron:review-mining',
      }).catch((err) => {
        console.error('[review_mining] enrichment failed', { entityId: entity.id, error: err })
      })
      if (ctx) {
        ctx.waitUntil(enrichPromise)
      }
    } catch (err) {
      summary.errors++
      const msg = err instanceof Error ? err.message : String(err)
      summary.errorDetails.push(`Score "${business.name}": ${msg}`)
    }
  }

  console.log(
    `Run complete: ${summary.newBusinesses} new, ${summary.qualified} qualified (pain>=${PAIN_THRESHOLD}), ` +
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
