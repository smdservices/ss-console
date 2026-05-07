/**
 * Synthesis-tier enrichment module wrappers.
 * Extracted from index.ts to keep that file under the 500-line ceiling.
 * All exports here are re-exported from index.ts for backward compatibility.
 *
 * These wrappers run after the data-source tier — they consume the
 * accumulated context (signals + earlier enrichment rows) and produce a
 * higher-level interpretation. Deep-website re-reads the website with a
 * heavier prompt; review-synthesis stitches review patterns and signals
 * into a sentiment/themes summary.
 */

import type { Entity } from '../db/entities'
import { appendContext, assembleEntityContext } from '../db/context'
import { deepWebsiteAnalysis, formatDeepWebsite } from './deep-website'
import { synthesizeReviews } from './review-synthesis'
import { instrumentModule, fingerprint, type ModuleOutcome } from './instrument'
import {
  type EnrichEnv,
  type EnrichResult,
  applyOutcome,
  AUTHORITATIVE_CONTEXT_META,
  NON_AUTHORITATIVE_CONTEXT_META,
} from './types'

export async function tryDeepWebsite(
  env: EnrichEnv,
  orgId: string,
  entity: Entity,
  result: EnrichResult
): Promise<void> {
  const outcome = await instrumentModule(
    {
      db: env.DB,
      org_id: orgId,
      entity_id: entity.id,
      module: 'deep_website',
      mode: result.mode,
      triggered_by: result.triggered_by,
    },
    async (): Promise<ModuleOutcome> => {
      if (!entity.website) return { kind: 'skipped', reason: 'missing_input:website' }
      if (!env.ANTHROPIC_API_KEY) return { kind: 'skipped', reason: 'missing_api_key:anthropic' }
      const analysis = await deepWebsiteAnalysis(entity.website, env.ANTHROPIC_API_KEY)
      if (!analysis) return { kind: 'no_data', reason: 'no_analysis' }
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content: formatDeepWebsite(analysis),
        source: 'deep_website',
        metadata: {
          ...analysis,
          ...AUTHORITATIVE_CONTEXT_META,
        },
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'deep_website', outcome)
}

export async function tryReviewSynthesis(
  env: EnrichEnv,
  orgId: string,
  entity: Entity,
  result: EnrichResult
): Promise<void> {
  let inputFingerprint: string | null = null
  try {
    const ctx = await assembleEntityContext(env.DB, entity.id, {
      maxBytes: 20_000,
      typeFilter: ['signal', 'enrichment'],
    })
    if (ctx) inputFingerprint = await fingerprint(ctx)
  } catch {
    // Fingerprint is informational; do not block the run on failure.
  }

  const outcome = await instrumentModule(
    {
      db: env.DB,
      org_id: orgId,
      entity_id: entity.id,
      module: 'review_synthesis',
      mode: result.mode,
      triggered_by: result.triggered_by,
      input_fingerprint: inputFingerprint,
    },
    async (): Promise<ModuleOutcome> => {
      if (!env.ANTHROPIC_API_KEY) return { kind: 'skipped', reason: 'missing_api_key:anthropic' }
      const allContext = await assembleEntityContext(env.DB, entity.id, {
        maxBytes: 20_000,
        typeFilter: ['signal', 'enrichment'],
      })
      if (!allContext) return { kind: 'skipped', reason: 'no_context' }
      const synthesis = await synthesizeReviews(allContext, env.ANTHROPIC_API_KEY)
      if (!synthesis) return { kind: 'no_data', reason: 'no_synthesis' }
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content: `Review synthesis: ${synthesis.customer_sentiment} Trend: ${synthesis.sentiment_trend}. Themes: ${synthesis.top_themes.join(', ')}. Problems: ${synthesis.operational_problems.map((p) => `${p.problem} (${p.confidence})`).join(', ')}.`,
        source: 'review_synthesis',
        metadata: {
          ...synthesis,
          ...NON_AUTHORITATIVE_CONTEXT_META,
        },
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'review_synthesis', outcome)
}
