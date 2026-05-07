/**
 * Shared types, constants, and utilities for enrichment modules.
 * Imported by both index.ts and enrichment-advanced.ts to avoid circular deps.
 */

import type { InstrumentResult } from './instrument'
import type { ModuleId } from './modules'

export type EnrichMode = 'full' | 'reviews-and-news'

export interface EnrichResult {
  entityId: string
  mode: EnrichMode
  /** Provenance — same value passed in EnrichOptions.triggered_by. */
  triggered_by: string
  /** Module source names that completed successfully in this run. */
  completed: string[]
  /** Module source names that were skipped (missing API key, wrong vertical, already enriched). */
  skipped: string[]
  /** Module source names that threw — logged but non-blocking. */
  errors: string[]
  /** True if the run did nothing because a prior full enrichment exists. */
  alreadyEnriched: boolean
}

export type EnrichEnv = {
  DB: D1Database
  ANTHROPIC_API_KEY?: string
  GOOGLE_PLACES_API_KEY?: string
  OUTSCRAPER_API_KEY?: string
  PROXYCURL_API_KEY?: string
  SERPAPI_API_KEY?: string
}

export const AUTHORITATIVE_CONTEXT_META = {
  context_authority: 'authoritative' as const,
  evidence_mode: 'extractive',
}

export const NON_AUTHORITATIVE_CONTEXT_META = {
  context_authority: 'non_authoritative' as const,
  evidence_mode: 'model_summary',
}

export function createEnrichResult(
  entityId: string,
  mode: EnrichMode,
  triggered_by: string
): EnrichResult {
  return {
    entityId,
    mode,
    triggered_by,
    completed: [],
    skipped: [],
    errors: [],
    alreadyEnriched: false,
  }
}

export function applyOutcome(
  result: EnrichResult,
  module: ModuleId,
  outcome: InstrumentResult
): void {
  switch (outcome.status) {
    case 'succeeded':
      result.completed.push(module)
      return
    case 'no_data':
    case 'skipped':
      result.skipped.push(module)
      return
    case 'failed':
      result.errors.push(module)
      return
    case 'running':
      return
  }
}
