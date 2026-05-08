import { beforeEach, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer as AstroContainer } from 'astro/container'

vi.mock('cloudflare:workers', () => ({
  env: { DB: {} },
}))

vi.mock('../src/lib/admin/entity-detail-page', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/admin/entity-detail-page')>(
    '../src/lib/admin/entity-detail-page'
  )
  return {
    ...actual,
    loadEntityDetailPage: vi.fn(),
  }
})

import { loadEntityDetailPage } from '../src/lib/admin/entity-detail-page'

const mockedLoadEntityDetailPage = vi.mocked(loadEntityDetailPage)

const DRAFT_TEXT =
  'Phoenix area practice with a pre-dossier draft that claims you built something solid from day one.'
const BRIEF_TEXT = `Newly licensed dental practice operating from Suite 225 in Scottsdale.

## Engagement Hypotheses
- Setup support

## Outreach Hooks
- you built something solid from day one`

function createMockPageData(stage: 'signal' | 'prospect' = 'signal') {
  const now = '2026-05-07T19:00:00.000Z'
  const signalEntry = {
    id: 'ctx-signal',
    entity_id: 'entity-1',
    org_id: 'org_1',
    type: 'signal',
    content: 'Signal from scottsdale_license.',
    source: 'scottsdale_license',
    source_ref: null,
    content_size: 24,
    metadata: JSON.stringify({
      vertical: 'healthcare',
      outreach_timing: 'immediate',
    }),
    engagement_id: null,
    created_at: now,
  }
  const enrichmentEntry = {
    id: 'ctx-enrichment',
    entity_id: 'entity-1',
    org_id: 'org_1',
    type: 'enrichment',
    content: 'Enrichment pipeline finished.',
    source: 'enrichment_orchestrator',
    source_ref: null,
    content_size: 29,
    metadata: JSON.stringify({
      succeeded: 4,
      no_data: 6,
      skipped: 3,
    }),
    engagement_id: null,
    created_at: now,
  }
  const briefEntry = {
    id: 'ctx-brief',
    entity_id: 'entity-1',
    org_id: 'org_1',
    type: 'enrichment',
    content: BRIEF_TEXT,
    source: 'intelligence_brief',
    source_ref: null,
    content_size: BRIEF_TEXT.length,
    metadata: null,
    engagement_id: null,
    created_at: now,
  }
  const outreachEntry = {
    id: 'ctx-draft',
    entity_id: 'entity-1',
    org_id: 'org_1',
    type: 'outreach_draft',
    content: DRAFT_TEXT,
    source: 'outreach_draft',
    source_ref: null,
    content_size: DRAFT_TEXT.length,
    metadata: JSON.stringify({ trigger: 'dossier' }),
    engagement_id: null,
    created_at: '2026-05-06T18:00:00.000Z',
  }

  const transitions =
    stage === 'signal'
      ? [
          {
            label: 'Promote',
            stage: 'prospect',
            variant: 'primary' as const,
            action: '/api/admin/entities/entity-1/stage',
          },
          {
            label: 'Dismiss',
            stage: 'lost',
            variant: 'destructive' as const,
            action: '/api/admin/entities/entity-1/stage',
          },
        ]
      : [
          {
            label: 'Mark as Proposing',
            stage: 'proposing',
            variant: 'primary' as const,
            action: '/api/admin/entities/entity-1/stage',
          },
          {
            label: 'Lost',
            stage: 'lost',
            variant: 'destructive' as const,
            action: '/api/admin/entities/entity-1/stage',
          },
        ]

  return {
    entity: {
      id: 'entity-1',
      org_id: 'org_1',
      name: 'Scottsdale Icon Dental',
      slug: 'scottsdale-icon-dental',
      phone: null,
      website: null,
      stage,
      stage_changed_at: '2026-05-07T18:00:00.000Z',
      pain_score: null,
      vertical: 'healthcare',
      area: 'Scottsdale, AZ',
      employee_count: null,
      tier: null,
      summary: null,
      next_action: null,
      next_action_at: null,
      source_pipeline: 'new_business',
      created_at: '2026-05-07T18:00:00.000Z',
      updated_at: '2026-05-07T19:00:00.000Z',
    },
    signalMetadata: {
      entity_id: 'entity-1',
      top_problems: null,
      signal_source_label: 'scottsdale_license',
      signal_subject: 'Scottsdale Icon Dental',
      signal_location: 'Suite 225, Scottsdale AZ',
      signal_date: '2026-05-07T18:00:00.000Z',
      signal_address: 'Suite 225, Scottsdale AZ',
      actor_role: 'business',
      actor_role_confidence: 'high',
      enrichment_summary: null,
      last_activity_at: null,
    },
    contextEntries: [signalEntry, enrichmentEntry, briefEntry, outreachEntry],
    contacts: [],
    meetings: [],
    engagements: [],
    quotes: [],
    invoices: [],
    enrichmentRuns: new Map([
      [
        'google_places',
        {
          id: 'run-1',
          entity_id: 'entity-1',
          module: 'google_places',
          status: 'no_data',
          reason: 'no_match',
          error_message: null,
          started_at: now,
          completed_at: now,
          triggered_by: 'cron:test',
        },
      ],
      [
        'review_synthesis',
        {
          id: 'run-2',
          entity_id: 'entity-1',
          module: 'review_synthesis',
          status: 'succeeded',
          reason: null,
          error_message: null,
          started_at: now,
          completed_at: now,
          triggered_by: 'cron:test',
        },
      ],
    ]),
    mostRecentDraftableMeeting: null,
    hasOutreach: true,
    filteredEntries: [enrichmentEntry, signalEntry],
    deduplicatedTimeline: [enrichmentEntry, signalEntry],
    typeFilter: '',
    typeCounts: {
      signal: 1,
      enrichment: 2,
      outreach_draft: 1,
    },
    currentLostReason: null,
    promoted: null,
    noteAdded: null,
    replyLogged: null,
    stageUpdated: null,
    dossierGenerated: null,
    contactAdded: null,
    contactUpdated: null,
    contactDeleted: null,
    error: null,
    showReEnrichButton: false,
    showNewQuoteButton: false,
    supersedeCandidates: [],
    transitions,
    decisionEvidence: {
      actorRole: 'business',
      actorRoleConfidence: 'high',
      signalEvidence: 'Scottsdale business license | 2026-05-07 | Suite 225, Scottsdale AZ',
      enrichmentSummary:
        'Newly licensed dental practice operating from Suite 225 in a Scottsdale professional building.',
      structuralFlags: ['Single-tenant suite', 'Arizona'],
      missingForOutreach: [
        {
          key: 'contact',
          label: 'Contact email',
          reason: 'none on file. Promote will trigger contact discovery.',
        },
      ],
      staleDraftWarning: {
        isStale: true,
        reason: 'Generated May 6, 2026 - pre-statewide pivot. References "Phoenix area".',
      },
    },
    mergeCandidates: [
      {
        id: 'merge-1',
        targetId: 'entity-dup',
        candidateName: 'Scottsdale Icon Dental PLLC',
        candidateAddress: 'Suite 225, Scottsdale AZ',
        score: 0.93,
        reason: 'slug_fuzzy_match',
        sourcePipeline: 'new_business',
        createdAt: now,
      },
    ],
    dossierBrief: briefEntry,
    outreachEntry,
    outreachContact: null,
    outreachMailto: null,
    outreachFromDossier: true,
    hasDossier: true,
    lastEnrichmentAt: now,
    latestSentQuoteAt: null,
    reviewMeta: null,
    websiteMeta: null,
    competitorMeta: null,
  }
}

async function renderEntityPage(stage: 'signal' | 'prospect' = 'signal'): Promise<string> {
  mockedLoadEntityDetailPage.mockResolvedValue(createMockPageData(stage) as never)
  const { default: EntityPage } = await import('../src/pages/admin/entities/[id].astro')
  const container = await AstroContainer.create()
  return container.renderToString(EntityPage, {
    request: new Request('https://admin.localhost:4321/admin/entities/entity-1'),
    params: { id: 'entity-1' },
    locals: {
      session: { orgId: 'org_1', role: 'admin', email: 'ops@example.com' },
    } as App.Locals,
    partial: false,
  })
}

function removeDiagnostics(html: string): string {
  return html.replace(/<details[^>]*data-diagnostics[\s\S]*?<\/details>/, '')
}

function actionCount(railHtml: string): number {
  return (railHtml.match(/data-rail-action="/g) ?? []).length
}

function railHtml(html: string): string {
  const match = html.match(/<aside[^>]*data-test="decision-rail"[\s\S]*?<\/aside>/)
  return match?.[0] ?? ''
}

describe('entity detail page render', () => {
  beforeEach(() => {
    mockedLoadEntityDetailPage.mockReset()
  })

  it('keeps outreach draft and intelligence brief content inside diagnostics only', async () => {
    const html = await renderEntityPage('signal')
    const bodyWithoutDiagnostics = removeDiagnostics(html)

    expect(bodyWithoutDiagnostics).not.toContain(DRAFT_TEXT)
    expect(bodyWithoutDiagnostics).not.toContain('Outreach Hooks')
    expect(html).toContain('Raw outreach draft')
    expect(html).toContain('Raw intelligence brief')
  })

  it('renders the actor role chip and the three signal-stage rail actions', async () => {
    const html = await renderEntityPage('signal')
    const rail = railHtml(html)

    expect(html).toContain('data-test="identity-strip"')
    expect(html).toContain('Business')
    expect(actionCount(rail)).toBe(3)
    expect(rail).toContain('data-rail-action="promote"')
    expect(rail).toContain('data-rail-action="dismiss"')
    expect(rail).toContain('data-rail-action="merge"')
  })

  it('renders the new structural dismiss reasons and the pain empty state', async () => {
    const html = await renderEntityPage('signal')
    const normalizedHtml = html.replace(/\s+/g, ' ')

    expect(html).toContain('Wrong actor')
    expect(html).toContain('Outside buy box')
    expect(html).toContain('Outside Arizona')
    expect(html).toContain('Insufficient signal')
    expect(html).toContain('Duplicate')
    expect(normalizedHtml).toContain(
      'No public review or job-post signal yet. License filed today; nothing has been written about this practice externally. Expect this to fill in over 30-60 days as the practice opens.'
    )
  })

  it('disables merge outside the signal stage', async () => {
    const html = await renderEntityPage('prospect')
    const rail = railHtml(html)

    expect(rail).toContain('data-rail-action="merge"')
    expect(rail).toContain('disabled')
    expect(rail).toContain(
      'Merge available at Signal stage only - extending mergeEntities is a follow-on.'
    )
  })
})
