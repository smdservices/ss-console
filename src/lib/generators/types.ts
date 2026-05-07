/**
 * Generator configuration types.
 *
 * One interface per pipeline. Workers also reference these at build time
 * (the interfaces are re-declared inline in worker source because workers
 * bundle separately — see Phase 2 plan).
 *
 * Every field has a documented default in DEFAULTS below. Adding a field
 * means existing config rows still parse — validators fill the missing
 * key from defaults rather than erroring.
 */

export const PIPELINE_IDS = [
  'new_business',
  'job_monitor',
  'review_mining',
  'social_listening',
] as const

export type PipelineId = (typeof PIPELINE_IDS)[number]

// ---------------------------------------------------------------------------
// Common fields
// ---------------------------------------------------------------------------

// Canonical verticals (mirror of extraction-schema.VERTICALS).
export const VERTICALS = [
  'home_services',
  'professional_services',
  'contractor_trades',
  'retail_salon',
  'restaurant_food',
  'healthcare',
  'technology',
  'manufacturing',
  'other',
] as const

export type Vertical = (typeof VERTICALS)[number]

// ---------------------------------------------------------------------------
// Per-pipeline config shapes
// ---------------------------------------------------------------------------

export type SodaCity = 'phoenix' | 'scottsdale_licenses' | 'scottsdale_permits' | 'mesa' | 'tempe'

export interface SodaSource {
  city: SodaCity
  enabled: boolean
}

export interface NewBusinessConfig {
  target_verticals: string[]
  geos: string[]
  soda_sources: SodaSource[]
}

export interface JobMonitorConfig {
  target_verticals: string[]
  geos: string[]
  search_queries: string[]
}

export interface ReviewMiningConfig {
  target_verticals: string[]
  geos: string[]
  discovery_queries: string[]
  geo_center: { lat: number; lon: number }
  geo_radius_km: number
}

export interface SocialListeningConfig {
  target_verticals: string[]
  geos: string[]
  search_queries: string[]
}

export type PipelineConfig =
  | ({ pipeline: 'new_business' } & NewBusinessConfig)
  | ({ pipeline: 'job_monitor' } & JobMonitorConfig)
  | ({ pipeline: 'review_mining' } & ReviewMiningConfig)
  | ({ pipeline: 'social_listening' } & SocialListeningConfig)

// ---------------------------------------------------------------------------
// Defaults — mirror current hardcoded worker values
// ---------------------------------------------------------------------------

export const DEFAULT_VERTICALS: string[] = [
  'home_services',
  'professional_services',
  'contractor_trades',
  'healthcare',
  'technology',
  'manufacturing',
  'retail_salon',
  'restaurant_food',
]

export const DEFAULT_GEOS: string[] = ['Arizona']

export const DEFAULTS = {
  new_business: {
    target_verticals: DEFAULT_VERTICALS,
    geos: DEFAULT_GEOS,
    soda_sources: [
      { city: 'phoenix', enabled: true },
      { city: 'scottsdale_licenses', enabled: true },
      { city: 'scottsdale_permits', enabled: true },
      { city: 'mesa', enabled: true },
      { city: 'tempe', enabled: true },
    ] as SodaSource[],
  } satisfies NewBusinessConfig,

  job_monitor: {
    target_verticals: DEFAULT_VERTICALS,
    geos: DEFAULT_GEOS,
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
    target_verticals: DEFAULT_VERTICALS,
    geos: DEFAULT_GEOS,
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

  social_listening: {
    target_verticals: DEFAULT_VERTICALS,
    geos: DEFAULT_GEOS,
    search_queries: [
      'Arizona small business operations',
      'business owner overwhelmed scheduling',
      'CRM recommendation small business',
      'hiring office manager Arizona',
      'small business spreadsheet chaos',
    ],
  } satisfies SocialListeningConfig,
} as const

export type ConfigByPipeline<P extends PipelineId> = P extends 'new_business'
  ? NewBusinessConfig
  : P extends 'job_monitor'
    ? JobMonitorConfig
    : P extends 'review_mining'
      ? ReviewMiningConfig
      : P extends 'social_listening'
        ? SocialListeningConfig
        : never

export const PIPELINE_LABELS: Record<PipelineId, string> = {
  new_business: 'New Business Detection',
  job_monitor: 'Job Posting Monitor',
  review_mining: 'Review Mining',
  social_listening: 'Social Listening',
}
