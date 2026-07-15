/**
 * Operator landing OVERVIEW — the one-pager view model (console blueprint §5).
 *
 * The landing reads as a document, not a hall of doors: the whole operator
 * summarized top to bottom, each block flowing into its chapter for depth. This
 * resolver derives every summary from the SAME shared facet resolvers the
 * chapters render (work, scope, connections) plus the projection's own currency
 * fields — so the landing and its chapters can never disagree.
 *
 * Every rendered fact traces to authored/projected data or a pure derivation of
 * it (the blueprint explicitly blesses derived counts: "19 duties across 8
 * stages" is arithmetic over authored tiers, not invented copy). Blocks whose
 * data is absent are absent — the empty-chapter rule extends to summary blocks.
 */

import type { CustomerConfigRow } from '../../../customer-config'
import { resolveOperatorWork, type WorkAuthorityRow } from '../work/work'
import { resolveOperatorScope } from '../scope/scope'
import { connectorRowsFromCustomerYaml } from '../../settings'

/** Derived job-in-numbers: grid seats get tier counts, gridless a skills count. */
export type JobSummary =
  | {
      kind: 'grid'
      duties: number
      stages: number
      /** Counts by start tier (today's setting), in fixed display order. */
      handles: number
      prepares: number
      surfaces: number
    }
  | { kind: 'skills'; count: number }

export interface OperatorOverviewModel {
  /**
   * The currency stamp: "Configuration as published <date>" (blueprint §5).
   * Derived from the projection's synced_at — it states when the rendered
   * configuration was published, never the live seat's runtime state. Null when
   * the timestamp is missing/unparseable (the line simply doesn't render).
   */
  publishedOn: string | null
  job: JobSummary
  /** The same authority rows the work surface renders (shared derivation). */
  authority: WorkAuthorityRow[]
  /** Connected system display names, from the connectors map keys. */
  systems: string[]
  /** The inbound roster (who it responds to), from the scope projection. */
  respondsTo: string[]
  /** Standing outbound recipients count (who it writes to for the firm). */
  writesToCount: number
}

/**
 * The job-in-numbers lines (pure derivation over authored tiers — blueprint §5
 * blesses derived counts). Null when there is nothing to summarize (the block
 * is absent, per the empty-chapter rule).
 */
export function jobLines(job: JobSummary): { headline: string; detail: string | null } | null {
  if (job.kind === 'skills') {
    if (job.count === 0) return null
    return {
      headline: `${job.count} ${job.count === 1 ? 'duty' : 'duties'} configured.`,
      detail: null,
    }
  }
  if (job.duties === 0) return null
  const fragments: string[] = []
  if (job.handles > 0) fragments.push(`${job.handles} handled on its own`)
  if (job.prepares > 0) fragments.push(`${job.prepares} prepared for a person`)
  if (job.surfaces > 0) fragments.push(`${job.surfaces} surfaced for you`)
  return {
    headline: `${job.duties} ${job.duties === 1 ? 'duty' : 'duties'} across ${job.stages} ${
      job.stages === 1 ? 'stage' : 'stages'
    } of your work.`,
    detail: fragments.length > 0 ? fragments.join(' · ') : null,
  }
}

/** 'PracticeManagement' → 'Practice management' (display only). */
function humanizeCapabilityName(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

/** ISO timestamp → "July 14, 2026" (UTC date part; null when unparseable). */
export function formatPublishedDate(syncedAt: string | null | undefined): string | null {
  if (!syncedAt) return null
  const d = new Date(syncedAt)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

/**
 * Compose the landing overview from the config projection, reusing the shared
 * facet resolvers so every number and list matches its chapter exactly.
 */
export function resolveOperatorOverview(config: CustomerConfigRow | null): OperatorOverviewModel {
  const work = resolveOperatorWork(config)

  let job: JobSummary
  if (work.mode === 'grid') {
    const rows = work.sections.flatMap((s) => s.routines)
    job = {
      kind: 'grid',
      duties: rows.length,
      stages: work.sections.length,
      handles: rows.filter((r) => r.todaySentence === 'Handles it').length,
      prepares: rows.filter((r) => r.todaySentence === 'Prepares it for you').length,
      surfaces: rows.filter((r) => r.todaySentence === 'Surfaces it').length,
    }
  } else {
    job = { kind: 'skills', count: work.skills.length }
  }

  const scope = resolveOperatorScope(config).scope

  return {
    publishedOn: formatPublishedDate(config?.synced_at),
    job,
    authority: work.authority,
    systems: connectorRowsFromCustomerYaml(config?.connectors ?? null).map((r) =>
      humanizeCapabilityName(r.capabilityName)
    ),
    respondsTo: scope?.respondsTo ?? [],
    writesToCount: scope?.writesTo.length ?? 0,
  }
}
