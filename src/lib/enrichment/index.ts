/**
 * Per-module enrichment wrappers + admin retry runner.
 *
 * Orchestration moved to `src/lib/enrichment/workflow.ts` (issue #631) — the
 * legacy `enrichEntity()` + `runReviewsAndNews()` orchestrators were deleted
 * because their `ctx.waitUntil`-detached invocation shape was being killed
 * by Cloudflare Workers' post-response CPU budget on lead-gen ingest
 * batches. The 30-day measurement on 2026-04-30 found 86% of created
 * entities had no enrichment activity at all — the orchestrator promises
 * never got CPU time before the Worker isolate was killed.
 *
 * Cloudflare Workflows replaces that orchestration: each `try*` module
 * wrapper is invoked from a discrete `step.do(...)` call in the
 * `EnrichmentWorkflow` class, with per-step durability, retries, and
 * dashboard observability. The wrappers themselves are unchanged from the
 * legacy implementation — `instrumentModule` writes the `enrichment_runs`
 * row, `applyOutcome` accumulates the in-memory result. The workflow
 * uses a fresh per-step `EnrichResult` since the database is the source
 * of truth.
 *
 * The `runSingleModule` admin retry path (per-module Retry button) keeps
 * its own thin orchestrator below — it's a synchronous admin-triggered
 * single-module run, not subject to the cron-loop CPU budget that motivated
 * the workflow refactor.
 *
 * File layout (issue #724):
 *   - `data-sources.ts`  — 8 evidence-gathering wrappers (Places, Website,
 *                          Outscraper, ACC, ROC, Review Analysis, Competitors,
 *                          News).
 *   - `synthesis.ts`     — 2 synthesis-tier wrappers (Deep Website, Review
 *                          Synthesis).
 *   - `enrichment-advanced.ts` — 3 advanced wrappers (LinkedIn, Intelligence
 *                                Brief, Outreach).
 *   - `index.ts` (this file)   — public barrel + `runSingleModule` admin
 *                                retry runner. Public import surface
 *                                (`from '@/lib/enrichment'`) is unchanged.
 */

import type { Entity } from '../db/entities'
import { getEntity } from '../db/entities'
import {
  tryPlaces,
  tryWebsite,
  tryOutscraper,
  tryAcc,
  tryRoc,
  tryReviewAnalysis,
  tryCompetitors,
  tryNews,
} from './data-sources'
import { tryDeepWebsite, tryReviewSynthesis } from './synthesis'
import { tryLinkedIn, tryIntelligenceBrief, tryOutreach } from './enrichment-advanced'
import type { ModuleId } from './modules'
import { type EnrichMode, type EnrichResult, type EnrichEnv, createEnrichResult } from './types'

export type { EnrichMode, EnrichResult, EnrichEnv }
export { createEnrichResult }

/** Type alias for a try-module function signature. */
export type TryModuleFn = (
  env: EnrichEnv,
  orgId: string,
  entity: Entity,
  result: EnrichResult
) => Promise<void>

export {
  tryPlaces,
  tryWebsite,
  tryOutscraper,
  tryAcc,
  tryRoc,
  tryReviewAnalysis,
  tryCompetitors,
  tryNews,
} from './data-sources'

export { tryDeepWebsite, tryReviewSynthesis } from './synthesis'

export { tryLinkedIn, tryIntelligenceBrief, tryOutreach } from './enrichment-advanced'

// ---------------------------------------------------------------------------
// Single-module runner — used by the admin "Retry" button per module.
// ---------------------------------------------------------------------------

// prettier-ignore
const SINGLE_RUNNERS: Record<ModuleId, TryModuleFn> = {
  google_places: tryPlaces, website_analysis: tryWebsite, outscraper: tryOutscraper,
  acc_filing: tryAcc, roc_license: tryRoc, review_analysis: tryReviewAnalysis,
  competitors: tryCompetitors, news_search: tryNews, deep_website: tryDeepWebsite,
  review_synthesis: tryReviewSynthesis, linkedin: tryLinkedIn,
  intelligence_brief: tryIntelligenceBrief, outreach_draft: tryOutreach,
}

export async function runSingleModule(
  env: EnrichEnv,
  orgId: string,
  entityId: string,
  module: ModuleId,
  options: { triggered_by: string } = { triggered_by: 'admin:retry' }
): Promise<EnrichResult> {
  const result = createEnrichResult(entityId, 'reviews-and-news', options.triggered_by)
  const entity = await getEntity(env.DB, orgId, entityId)
  if (!entity) {
    result.errors.push('entity_not_found')
    return result
  }
  const runner = SINGLE_RUNNERS[module]
  if (!runner) {
    result.errors.push('unknown_module')
    return result
  }
  await runner(env, orgId, entity, result)
  return result
}
