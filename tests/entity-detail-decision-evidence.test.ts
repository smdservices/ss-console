import { describe, expect, it } from 'vitest'
import {
  ADR_0003_DEPLOY_DATE,
  composeDeduplicatedTimeline,
  composeEnrichmentSummary,
  composeMissingForOutreach,
  detectStaleDraft,
  resolveActorRole,
} from '../src/lib/admin/entity-detail-decision-evidence'
import type { Entity } from '../src/lib/db/entities'
import type { ContextEntry } from '../src/lib/db/context'
import type { Contact } from '../src/lib/db/contacts'
import type { EnrichmentRun } from '../src/lib/db/enrichment-runs'

const baseEntity: Entity = {
  id: 'entity-1',
  org_id: 'org-1',
  name: 'Scottsdale Icon Dental',
  slug: 'scottsdale-icon-dental-scottsdale',
  phone: null,
  website: null,
  stage: 'signal',
  stage_changed_at: '2026-05-07T12:00:00Z',
  pain_score: null,
  vertical: 'professional_services',
  area: 'Scottsdale, AZ',
  employee_count: null,
  tier: null,
  summary: null,
  next_action: null,
  next_action_at: null,
  source_pipeline: 'new_business',
  created_at: '2026-05-07T12:00:00Z',
  updated_at: '2026-05-07T12:00:00Z',
}

function makeContextEntry(
  overrides: Partial<ContextEntry> &
    Pick<ContextEntry, 'id' | 'type' | 'content' | 'source' | 'created_at'>
): ContextEntry {
  return {
    entity_id: 'entity-1',
    org_id: 'org-1',
    source_ref: null,
    content_size: null,
    metadata: null,
    engagement_id: null,
    ...overrides,
  }
}

function makeRun(module: string, reason: string | null): EnrichmentRun {
  return {
    id: `${module}-run`,
    org_id: 'org-1',
    entity_id: 'entity-1',
    module: module as EnrichmentRun['module'],
    status: reason ? 'no_data' : 'succeeded',
    reason,
    error_message: null,
    input_fingerprint: null,
    started_at: '2026-05-07T09:00:00Z',
    completed_at: '2026-05-07T09:01:00Z',
    duration_ms: 1000,
    triggered_by: 'test',
    mode: 'full',
    context_entry_id: null,
  }
}

describe('entity detail decision evidence helpers', () => {
  it('composeDeduplicatedTimeline strips duplicate AI artifacts and keeps operator events', () => {
    const timeline = composeDeduplicatedTimeline([
      makeContextEntry({
        id: '1',
        type: 'note',
        source: 'admin',
        content: 'Older note',
        created_at: '2026-05-07T08:00:00Z',
      }),
      makeContextEntry({
        id: '2',
        type: 'enrichment',
        source: 'review_synthesis',
        content: 'Older synthesis',
        created_at: '2026-05-07T09:00:00Z',
      }),
      makeContextEntry({
        id: '3',
        type: 'outreach_draft',
        source: 'outreach_draft',
        content: 'Draft body',
        created_at: '2026-05-07T09:30:00Z',
      }),
      makeContextEntry({
        id: '4',
        type: 'enrichment',
        source: 'review_analysis',
        content: 'Older analysis',
        created_at: '2026-05-07T10:00:00Z',
      }),
      makeContextEntry({
        id: '5',
        type: 'enrichment',
        source: 'review_analysis',
        content: 'Latest analysis',
        created_at: '2026-05-07T11:00:00Z',
      }),
      makeContextEntry({
        id: '6',
        type: 'enrichment',
        source: 'review_synthesis',
        content: 'Latest synthesis',
        created_at: '2026-05-07T12:00:00Z',
      }),
      makeContextEntry({
        id: '7',
        type: 'enrichment',
        source: 'intelligence_brief',
        content: 'Brief body',
        created_at: '2026-05-07T13:00:00Z',
      }),
      makeContextEntry({
        id: '8',
        type: 'stage_change',
        source: 'admin',
        content: 'Promoted',
        created_at: '2026-05-07T14:00:00Z',
      }),
    ])

    expect(timeline.map((entry) => entry.id)).toEqual(['8', '6', '5', '1'])
  })

  it('composeMissingForOutreach cites missing contact, website, and public web signal', () => {
    const missing = composeMissingForOutreach(
      baseEntity,
      [
        makeContextEntry({
          id: 'signal',
          type: 'signal',
          source: 'new_business',
          content: 'License signal',
          created_at: '2026-05-07T08:00:00Z',
        }),
      ],
      [] as Contact[],
      new Map<string, EnrichmentRun>([['google_places', makeRun('google_places', 'no_match')]])
    )

    expect(missing.map((item) => item.key)).toEqual(['contact', 'website', 'public-web-signal'])
    expect(missing.find((item) => item.key === 'website')?.reason).toContain(
      'Google Places no_match'
    )
  })

  it('detectStaleDraft flags drafts before ADR 0003 and Phoenix-area copy', () => {
    const beforePivot = detectStaleDraft(
      makeContextEntry({
        id: 'draft-1',
        type: 'outreach_draft',
        source: 'outreach_draft',
        content: 'Hi there.',
        created_at: '2026-05-06T23:59:59Z',
      })
    )
    expect(beforePivot.isStale).toBe(true)
    expect(beforePivot.reason).toContain('pre-statewide pivot')

    const phoenixDraft = detectStaleDraft(
      makeContextEntry({
        id: 'draft-2',
        type: 'outreach_draft',
        source: 'outreach_draft',
        content: 'We work with Phoenix area businesses.',
        created_at: ADR_0003_DEPLOY_DATE,
      })
    )
    expect(phoenixDraft.isStale).toBe(true)
    expect(phoenixDraft.reason).toContain('Phoenix area')

    const fresh = detectStaleDraft(
      makeContextEntry({
        id: 'draft-3',
        type: 'outreach_draft',
        source: 'outreach_draft',
        content: 'We should talk.',
        created_at: '2026-05-08T08:00:00Z',
      })
    )
    expect(fresh).toEqual({ isStale: false, reason: null })
  })

  it('resolveActorRole falls back to unknown/low when metadata is absent', () => {
    expect(resolveActorRole(null)).toEqual({ role: 'unknown', confidence: 'low' })
  })

  it('composeEnrichmentSummary prioritizes review synthesis, then deep website, then brief', () => {
    const reviewSummary = composeEnrichmentSummary(
      makeContextEntry({
        id: 'review',
        type: 'enrichment',
        source: 'review_synthesis',
        content: 'Newest review summary. Another sentence.',
        created_at: '2026-05-07T12:00:00Z',
      }),
      makeContextEntry({
        id: 'website',
        type: 'enrichment',
        source: 'deep_website',
        content: 'Deep website fallback.',
        created_at: '2026-05-07T11:00:00Z',
      }),
      makeContextEntry({
        id: 'brief',
        type: 'enrichment',
        source: 'intelligence_brief',
        content: 'Brief fallback paragraph.\n\n## Outreach Hooks\n- Should not appear',
        created_at: '2026-05-07T10:00:00Z',
      })
    )
    expect(reviewSummary).toBe('Newest review summary.')

    const websiteSummary = composeEnrichmentSummary(
      undefined,
      makeContextEntry({
        id: 'website-only',
        type: 'enrichment',
        source: 'deep_website',
        content: 'Website fallback sentence. Another one.',
        created_at: '2026-05-07T11:00:00Z',
      }),
      undefined
    )
    expect(websiteSummary).toBe('Website fallback sentence.')

    const briefSummary = composeEnrichmentSummary(
      undefined,
      undefined,
      makeContextEntry({
        id: 'brief-only',
        type: 'enrichment',
        source: 'intelligence_brief',
        content:
          'Newly licensed dental practice operating from Suite 225 in Scottsdale.\n\n## Engagement Hypotheses\n- Ignore this',
        created_at: '2026-05-07T10:00:00Z',
      })
    )
    expect(briefSummary).toBe(
      'Newly licensed dental practice operating from Suite 225 in Scottsdale.'
    )
  })
})
