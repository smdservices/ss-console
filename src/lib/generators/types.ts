/**
 * Generator configuration types.
 *
 * One interface per pipeline. Workers also reference these at build time
 * (the interfaces are re-declared inline in worker source because workers
 * bundle separately).
 *
 * Every field has a documented default in DEFAULTS below. Adding a field
 * means existing config rows still parse — validators fill the missing
 * key from defaults rather than erroring.
 */

export const PIPELINE_IDS = ['job_monitor', 'review_mining'] as const

export type PipelineId = (typeof PIPELINE_IDS)[number]

// ---------------------------------------------------------------------------
// Per-pipeline config shapes
//
// Only fields a worker actually reads live here. Geography/vertical targeting
// is hardcoded in each worker's query strings today; the `geos` /
// `target_verticals` config fields were a dead admin mirage (no worker ever
// read them) and were removed. The real configurable targeting surface
// (`targets[]`) is introduced in the capture-layer phase.
// ---------------------------------------------------------------------------

export interface JobMonitorConfig {
  search_queries: string[]
}

export interface ReviewMiningConfig {
  discovery_queries: string[]
  geo_center: { lat: number; lon: number }
  geo_radius_km: number
}

export type PipelineConfig =
  | ({ pipeline: 'job_monitor' } & JobMonitorConfig)
  | ({ pipeline: 'review_mining' } & ReviewMiningConfig)

// ---------------------------------------------------------------------------
// Defaults — mirror current hardcoded worker values
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  job_monitor: {
    search_queries: [
      'office manager',
      'operations manager',
      'dispatcher',
      'scheduling coordinator',
      'customer service coordinator',
      'office administrator',
      'front desk manager',
      'service coordinator',
      'Director of Operations',
      'IT Manager',
      'Systems Administrator',
      'Technology Coordinator',
    ],
  } satisfies JobMonitorConfig,

  review_mining: {
    discovery_queries: [
      'plumber Arizona',
      'HVAC contractor Arizona',
      'electrician Arizona',
      'commercial electrical contractor Arizona',
      'machine shop Arizona',
      'managed IT services Arizona',
      'marketing agency Arizona',
      'landscaping company Arizona',
      'auto repair shop Arizona',
      'dental office Arizona',
      'accounting firm Arizona',
      'law firm Arizona',
      'cleaning service Arizona',
      'roofing contractor Arizona',
      'physical therapy Arizona',
    ],
    geo_center: { lat: 34.0, lon: -111.5 },
    geo_radius_km: 425,
  } satisfies ReviewMiningConfig,
} as const

export type ConfigByPipeline<P extends PipelineId> = P extends 'job_monitor'
  ? JobMonitorConfig
  : P extends 'review_mining'
    ? ReviewMiningConfig
    : never

export const PIPELINE_LABELS: Record<PipelineId, string> = {
  job_monitor: 'Job Posting Monitor',
  review_mining: 'Review Mining',
}
