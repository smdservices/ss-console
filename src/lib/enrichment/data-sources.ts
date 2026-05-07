/**
 * Data-source enrichment module wrappers.
 * Extracted from index.ts to keep that file under the 500-line ceiling.
 * All exports here are re-exported from index.ts for backward compatibility.
 *
 * These eight wrappers are the "evidence-gathering" tier — they pull facts
 * from external APIs and public data (Google Places, websites, Outscraper,
 * AZ ACC/ROC, Anthropic-driven review pattern analysis, competitor benchmarking,
 * SerpAPI news). The synthesis-tier wrappers (deep website, review synthesis)
 * live in `synthesis.ts`.
 */

import type { Entity } from '../db/entities'
import { updateEntity } from '../db/entities'
import { appendContext, assembleEntityContext } from '../db/context'
import { lookupGooglePlaces } from './google-places'
import { analyzeWebsite } from './website-analyzer'
import { lookupOutscraper } from './outscraper'
import { lookupAcc } from './acc'
import { lookupRoc } from './roc'
import { analyzeReviewPatterns } from './review-analysis'
import { benchmarkCompetitors } from './competitors'
import { searchNews, formatNewsEvidence } from './news'
import { instrumentModule, type ModuleOutcome } from './instrument'
import type { OutscraperEnrichment } from './outscraper'
import {
  type EnrichEnv,
  type EnrichResult,
  applyOutcome,
  AUTHORITATIVE_CONTEXT_META,
  NON_AUTHORITATIVE_CONTEXT_META,
} from './types'

export async function tryPlaces(
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
      module: 'google_places',
      mode: result.mode,
      triggered_by: result.triggered_by,
    },
    async (): Promise<ModuleOutcome> => {
      if (entity.phone && entity.website)
        return { kind: 'skipped', reason: 'already_have_phone_and_website' }
      if (!env.GOOGLE_PLACES_API_KEY)
        return { kind: 'skipped', reason: 'missing_api_key:google_places' }
      const places = await lookupGooglePlaces(entity.name, entity.area, env.GOOGLE_PLACES_API_KEY)
      if (!places) return { kind: 'no_data', reason: 'no_match' }
      await updateEntity(env.DB, orgId, entity.id, {
        phone: places.phone ?? entity.phone ?? undefined,
        website: places.website ?? entity.website ?? undefined,
      })
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content: `Google Places: ${places.phone ? `Phone: ${places.phone}` : 'No phone found'}. ${places.website ? `Website: ${places.website}` : 'No website found'}. Rating: ${places.rating ?? 'N/A'} (${places.reviewCount ?? 0} reviews). Status: ${places.businessStatus ?? 'unknown'}.`,
        source: 'google_places',
        metadata: places as unknown as Record<string, unknown>,
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'google_places', outcome)
}

export async function tryWebsite(
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
      module: 'website_analysis',
      mode: result.mode,
      triggered_by: result.triggered_by,
    },
    async (): Promise<ModuleOutcome> => {
      if (!entity.website) return { kind: 'skipped', reason: 'missing_input:website' }
      if (!env.ANTHROPIC_API_KEY) return { kind: 'skipped', reason: 'missing_api_key:anthropic' }
      const analysis = await analyzeWebsite(entity.website, env.ANTHROPIC_API_KEY)
      if (!analysis) return { kind: 'no_data', reason: 'no_analysis' }
      const techTools = [
        ...analysis.tech_stack.scheduling,
        ...analysis.tech_stack.crm,
        ...analysis.tech_stack.reviews,
        ...analysis.tech_stack.payments,
        ...analysis.tech_stack.communication,
      ]
      const missingTools: string[] = []
      if (analysis.tech_stack.scheduling.length === 0) missingTools.push('No scheduling tool')
      if (analysis.tech_stack.crm.length === 0) missingTools.push('No CRM')
      if (analysis.tech_stack.reviews.length === 0) missingTools.push('No review management')

      const contentParts = [
        `Website analysis (${analysis.pages_analyzed.length} pages):`,
        analysis.owner_name ? `Owner/Founder: ${analysis.owner_name}` : null,
        analysis.team_size ? `Team size: ~${analysis.team_size} people` : null,
        analysis.founding_year ? `Founded: ${analysis.founding_year}` : null,
        analysis.contact_email ? `Email: ${analysis.contact_email}` : null,
        analysis.services.length > 0 ? `Services: ${analysis.services.join(', ')}` : null,
        `Site quality: ${analysis.quality}`,
        techTools.length > 0
          ? `Tools detected: ${techTools.join(', ')}`
          : 'No business tools detected on website',
        missingTools.length > 0 ? `Gaps: ${missingTools.join(', ')}` : null,
        `Platform: ${analysis.tech_stack.platform.join(', ') || 'Custom/unknown'}`,
      ].filter(Boolean)

      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content: contentParts.join('\n'),
        source: 'website_analysis',
        metadata: {
          owner_name: analysis.owner_name,
          team_size: analysis.team_size,
          employee_count: analysis.team_size,
          founding_year: analysis.founding_year,
          contact_email: analysis.contact_email,
          services: analysis.services,
          quality: analysis.quality,
          tech_stack: analysis.tech_stack,
          pages_analyzed: analysis.pages_analyzed,
        },
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'website_analysis', outcome)
}

function oscOptional(label: string, value: string | null | undefined): string | null {
  return value ? `${label}: ${value}` : null
}

function buildOutscraperContent(osc: OutscraperEnrichment): string {
  const rating =
    osc.rating != null ? `Rating: ${osc.rating} (${osc.review_count ?? 0} reviews)` : null
  return [
    'Outscraper business profile:',
    oscOptional('Owner', osc.owner_name),
    osc.emails.length > 0 ? `Email: ${osc.emails.join(', ')}` : null,
    oscOptional('Phone', osc.phone),
    oscOptional('Hours', osc.working_hours),
    osc.verified ? 'Google listing: Verified' : 'Google listing: Unverified',
    rating,
    osc.booking_link ? 'Online booking: Yes' : 'Online booking: Not detected',
    oscOptional('Facebook', osc.facebook),
    oscOptional('Instagram', osc.instagram),
    oscOptional('LinkedIn', osc.linkedin),
    oscOptional('Platform', osc.website_generator),
    osc.has_facebook_pixel ? 'Has Facebook Pixel' : null,
    osc.has_google_tag_manager ? 'Has Google Tag Manager' : null,
    oscOptional('About', osc.about),
  ]
    .filter(Boolean)
    .join('\n')
}

export async function tryOutscraper(
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
      module: 'outscraper',
      mode: result.mode,
      triggered_by: result.triggered_by,
    },
    async (): Promise<ModuleOutcome> => {
      if (!env.OUTSCRAPER_API_KEY) return { kind: 'skipped', reason: 'missing_api_key:outscraper' }
      const osc = await lookupOutscraper(entity.name, entity.area, env.OUTSCRAPER_API_KEY)
      if (!osc) return { kind: 'no_data', reason: 'no_match' }
      await updateEntity(env.DB, orgId, entity.id, {
        phone: osc.phone ?? entity.phone ?? undefined,
        website: osc.website ?? entity.website ?? undefined,
      })
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content: buildOutscraperContent(osc),
        source: 'outscraper',
        metadata: osc as unknown as Record<string, unknown>,
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'outscraper', outcome)
}

export async function tryAcc(
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
      module: 'acc_filing',
      mode: result.mode,
      triggered_by: result.triggered_by,
    },
    async (): Promise<ModuleOutcome> => {
      const acc = await lookupAcc(entity.name)
      if (!acc) return { kind: 'no_data', reason: 'no_filing_match' }
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content: `ACC Filing: ${acc.entity_name} (${acc.entity_type ?? 'unknown type'}). Filed: ${acc.filing_date ?? 'unknown'}. Status: ${acc.status ?? 'unknown'}. Registered agent: ${acc.registered_agent ?? 'not found'}.`,
        source: 'acc_filing',
        metadata: acc as unknown as Record<string, unknown>,
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'acc_filing', outcome)
}

export async function tryRoc(
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
      module: 'roc_license',
      mode: result.mode,
      triggered_by: result.triggered_by,
    },
    async (): Promise<ModuleOutcome> => {
      if (entity.vertical !== 'home_services' && entity.vertical !== 'contractor_trades') {
        return { kind: 'skipped', reason: 'wrong_vertical' }
      }
      const roc = await lookupRoc(entity.name)
      if (!roc) return { kind: 'no_data', reason: 'no_license_match' }
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content: `ROC License: ${roc.license_number ?? 'N/A'} (${roc.classification ?? 'unknown classification'}). Status: ${roc.status ?? 'unknown'}. Complaints: ${roc.complaint_count ?? 'N/A'}.`,
        source: 'roc_license',
        metadata: roc as unknown as Record<string, unknown>,
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'roc_license', outcome)
}

export async function tryReviewAnalysis(
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
      module: 'review_analysis',
      mode: result.mode,
      triggered_by: result.triggered_by,
    },
    async (): Promise<ModuleOutcome> => {
      if (!env.ANTHROPIC_API_KEY) return { kind: 'skipped', reason: 'missing_api_key:anthropic' }
      const signalContext = await assembleEntityContext(env.DB, entity.id, {
        maxBytes: 8_000,
        typeFilter: ['signal'],
      })
      if (!signalContext) return { kind: 'skipped', reason: 'no_signal_context' }
      const reviewAnalysis = await analyzeReviewPatterns(signalContext, env.ANTHROPIC_API_KEY)
      if (!reviewAnalysis) return { kind: 'no_data', reason: 'no_analysis' }
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content:
          `Review response signals: ${reviewAnalysis.response_pattern} response pattern, ${reviewAnalysis.engagement_level} engagement.` +
          `${reviewAnalysis.owner_accessible ? ' Owner appears reachable through public review responses.' : ''}` +
          ` Evidence: ${reviewAnalysis.evidence_summary}`,
        source: 'review_analysis',
        metadata: {
          ...reviewAnalysis,
          ...NON_AUTHORITATIVE_CONTEXT_META,
        },
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'review_analysis', outcome)
}

export async function tryCompetitors(
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
      module: 'competitors',
      mode: result.mode,
      triggered_by: result.triggered_by,
    },
    async (): Promise<ModuleOutcome> => {
      if (!env.GOOGLE_PLACES_API_KEY)
        return { kind: 'skipped', reason: 'missing_api_key:google_places' }
      const benchmark = await benchmarkCompetitors(
        {
          entityName: entity.name,
          vertical: entity.vertical,
          area: entity.area,
          entityRating: entity.pain_score,
          entityReviewCount: null,
        },
        env.GOOGLE_PLACES_API_KEY
      )
      if (!benchmark) return { kind: 'no_data', reason: 'no_benchmark' }
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content: `Competitor benchmarking: ${benchmark.summary} Top competitors: ${benchmark.competitors.map((c) => `${c.name} (${c.rating}★, ${c.review_count} reviews)`).join(', ')}.`,
        source: 'competitors',
        metadata: benchmark as unknown as Record<string, unknown>,
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'competitors', outcome)
}

export async function tryNews(
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
      module: 'news_search',
      mode: result.mode,
      triggered_by: result.triggered_by,
    },
    async (): Promise<ModuleOutcome> => {
      if (!env.SERPAPI_API_KEY) return { kind: 'skipped', reason: 'missing_api_key:serpapi' }
      if (!env.ANTHROPIC_API_KEY) return { kind: 'skipped', reason: 'missing_api_key:anthropic' }
      const news = await searchNews(
        entity.name,
        entity.area,
        env.SERPAPI_API_KEY,
        env.ANTHROPIC_API_KEY
      )
      if (!news) return { kind: 'no_data', reason: 'no_results' }
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content: formatNewsEvidence(news),
        source: 'news_search',
        metadata: {
          mentions: news.mentions,
          summary: news.summary,
          ...AUTHORITATIVE_CONTEXT_META,
        },
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'news_search', outcome)
}
