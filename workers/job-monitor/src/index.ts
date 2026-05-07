/**
 * Job Monitor Worker — Pipeline 2
 *
 * Searches Arizona job postings, drops staffing-agency and syndicator noise
 * before Claude, then writes only direct-employer operating-business signals
 * to D1.
 */

import { ORG_ID } from '../../../src/lib/constants.js'
import { findOrCreateEntity } from '../../../src/lib/db/entities.js'
import { appendContext } from '../../../src/lib/db/context.js'
import { getGeneratorConfig, recordGeneratorRun } from '../../../src/lib/db/generators.js'
import { getPipelineSettings } from '../../../src/lib/db/pipeline-settings.js'
import type { JobMonitorConfig } from '../../../src/lib/generators/types.js'
import { dispatchEnrichmentWorkflow } from '../../../src/lib/enrichment/dispatch.js'
import { searchJobs } from './serpapi.js'
import { qualifyJob, derivePainScore, inferPostingActorRole } from './qualify.js'
import { sendFailureAlert, type RunSummary } from './alert.js'
import type { SerpApiJob } from './serpapi.js'

export interface Env {
  DB: D1Database
  SERPAPI_API_KEY: string
  ANTHROPIC_API_KEY: string
  RESEND_API_KEY: string
  LEAD_INGEST_API_KEY: string
  GOOGLE_PLACES_API_KEY?: string
  OUTSCRAPER_API_KEY?: string
  PROXYCURL_API_KEY?: string
  ENRICHMENT_WORKFLOW_SERVICE?: { fetch: typeof fetch }
}

async function fetchAllJobs(
  cfg: JobMonitorConfig,
  apiKey: string,
  summary: RunSummary
): Promise<Array<{ job: SerpApiJob; query: string }>> {
  const allJobs: Array<{ job: SerpApiJob; query: string }> = []
  for (const query of cfg.search_queries) {
    summary.queries++
    try {
      const jobs = await searchJobs(query, apiKey)
      for (const job of jobs) allJobs.push({ job, query })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      summary.errors++
      summary.errorDetails.push(`Query "${query}": ${msg}`)
      if (msg.includes('401')) {
        console.error('Fatal: SerpAPI 401 - aborting run')
        break
      }
    }
  }
  return allJobs
}

function buildJobContent(qualification: Awaited<ReturnType<typeof qualifyJob>>): string {
  if (!qualification?.evidence) return 'Signal from job_monitor.'
  return qualification.evidence
}

function buildJobMetadata(
  job: SerpApiJob,
  query: string,
  qualification: Awaited<ReturnType<typeof qualifyJob>>,
  painScore: number
): Record<string, unknown> {
  const firstLink = job.apply_options && job.apply_options[0] ? job.apply_options[0].link : null
  return {
    job_hash: job.job_id,
    job_url: firstLink,
    job_title: job.title,
    query_term: query,
    confidence: qualification?.confidence,
    company_size_estimate: qualification?.company_size_estimate,
    posting_actor_role: qualification?.posting_actor_role ?? 'unknown',
    ...(painScore != null ? { pain_score: painScore } : {}),
    ...(qualification?.problems_signaled ? { top_problems: qualification.problems_signaled } : {}),
    signal_source_label: 'Job posting',
    signal_subject: job.title,
    signal_location: job.location,
    signal_date: new Date().toISOString().split('T')[0],
    date_found: new Date().toISOString().split('T')[0],
  }
}

async function processOneJob(
  entry: { job: SerpApiJob; query: string },
  env: Env,
  ctx: ExecutionContext | undefined,
  summary: RunSummary,
  painThreshold: number
): Promise<void> {
  const { job, query } = entry
  const alreadyProcessed = await env.DB.prepare(
    `SELECT 1 FROM context WHERE org_id = ? AND source = 'job_monitor' AND source_ref = ?`
  )
    .bind(ORG_ID, job.job_id)
    .first()
  if (alreadyProcessed) {
    summary.existingAppended++
    return
  }

  summary.newJobs++

  const postingActorRole = inferPostingActorRole(job)
  if (postingActorRole !== 'direct') {
    summary.disqualified++
    summary.droppedByActorRole++
    return
  }

  const qualification = await qualifyJob(job, env.ANTHROPIC_API_KEY, postingActorRole)
  if (!qualification) {
    summary.errors++
    summary.errorDetails.push(`Claude failed for "${job.company_name}" - "${job.title}"`)
    return
  }
  if (qualification.posting_actor_role !== 'direct') {
    summary.disqualified++
    summary.droppedByActorRole++
    return
  }
  if (!qualification.qualified) {
    summary.disqualified++
    return
  }

  const painScore = derivePainScore(qualification)
  if (painScore < painThreshold) {
    summary.belowThreshold++
    return
  }

  summary.qualified++
  const result = await findOrCreateEntity(env.DB, ORG_ID, {
    name: qualification.company,
    area: job.location,
    website: job.company_url ?? null,
    source_pipeline: 'job_monitor',
  })

  await appendContext(env.DB, ORG_ID, {
    entity_id: result.entity.id,
    type: 'signal',
    content: buildJobContent(qualification),
    source: 'job_monitor',
    source_ref: job.job_id,
    metadata: buildJobMetadata(job, query, qualification, painScore),
  })
  summary.written++

  if (ctx) {
    ctx.waitUntil(
      dispatchEnrichmentWorkflow(env, {
        entityId: result.entity.id,
        orgId: ORG_ID,
        mode: 'full',
        triggered_by: 'cron:job-monitor',
      }).catch((err) => {
        console.error('[job_monitor] enrichment dispatch failed for', result.entity.id, err)
      })
    )
  }
}

async function run(env: Env, ctx?: ExecutionContext): Promise<RunSummary> {
  const summary: RunSummary = {
    queries: 0,
    totalResults: 0,
    newJobs: 0,
    qualified: 0,
    disqualified: 0,
    droppedByActorRole: 0,
    belowThreshold: 0,
    written: 0,
    errors: 0,
    errorDetails: [],
    existingAppended: 0,
  }

  const settings = await getPipelineSettings(env.DB, ORG_ID, 'job_monitor')
  const painThreshold = settings.pain_threshold

  const configRow = await getGeneratorConfig(env.DB, ORG_ID, 'job_monitor')
  if (!configRow.enabled) {
    console.log('job_monitor: disabled by admin config - skipping run')
    await recordGeneratorRun(env.DB, ORG_ID, 'job_monitor', { signalsCount: 0, error: null })
    return summary
  }
  const cfg = configRow.config as JobMonitorConfig

  const allJobs = await fetchAllJobs(cfg, env.SERPAPI_API_KEY, summary)
  summary.totalResults = allJobs.length
  console.log(`SerpAPI: ${summary.queries} queries, ${summary.totalResults} total results`)

  const seen = new Set<string>()
  const uniqueJobs: typeof allJobs = []
  for (const entry of allJobs) {
    if (!seen.has(entry.job.job_id)) {
      seen.add(entry.job.job_id)
      uniqueJobs.push(entry)
    }
  }

  for (const entry of uniqueJobs) {
    try {
      await processOneJob(entry, env, ctx, summary, painThreshold)
    } catch (err) {
      summary.errors++
      const msg = err instanceof Error ? err.message : String(err)
      summary.errorDetails.push(`Job "${entry.job.company_name}": ${msg}`)
    }
  }

  console.log(
    `Run complete: ${summary.newJobs} new, ${summary.existingAppended} existing, ` +
      `${summary.qualified} qualified, ${summary.disqualified} disqualified, ` +
      `${summary.droppedByActorRole} dropped by actor role, ${summary.written} written, ${summary.errors} errors`
  )

  await recordGeneratorRun(env.DB, ORG_ID, 'job_monitor', {
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
