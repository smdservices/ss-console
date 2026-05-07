import { hasOpenQuoteForEntity, listQuotes } from '../db/quotes'
import { getEntity } from '../db/entities'
import type { EntityStage } from '../db/entities'
import { listContext } from '../db/context'
import { listContacts } from '../db/contacts'
import { listMeetings } from '../db/meetings'
import { listEngagements } from '../db/engagements'
import { listInvoices } from '../db/invoices'
import { findDraftableMeeting } from '../../lib/entities/draftable-meeting'

type Database = Parameters<typeof getEntity>[0]
type EntityRecord = Exclude<Awaited<ReturnType<typeof getEntity>>, null>

export type EntityDetailTransition = {
  label: string
  stage: EntityStage
  variant: 'primary' | 'destructive'
  action?: string
}

const RE_ENRICH_STAGES: EntityStage[] = [
  'prospect',
  'meetings',
  'proposing',
  'engaged',
  'delivered',
  'ongoing',
]

export const ENTITY_DETAIL_TRANSITIONS: Record<EntityStage, EntityDetailTransition[]> = {
  signal: [
    {
      label: 'Promote',
      stage: 'prospect',
      variant: 'primary',
    },
    {
      label: 'Dismiss',
      stage: 'lost',
      variant: 'destructive',
    },
  ],
  prospect: [{ label: 'Lost', stage: 'lost', variant: 'destructive' }],
  meetings: [
    { label: 'Mark as Proposing', stage: 'proposing', variant: 'primary' },
    { label: 'Lost', stage: 'lost', variant: 'destructive' },
  ],
  proposing: [
    { label: 'Mark as Engaged', stage: 'engaged', variant: 'primary' },
    { label: 'Lost', stage: 'lost', variant: 'destructive' },
  ],
  engaged: [{ label: 'Mark as Delivered', stage: 'delivered', variant: 'primary' }],
  delivered: [
    { label: 'Mark as Ongoing', stage: 'ongoing', variant: 'primary' },
    { label: 'Re-engage', stage: 'prospect', variant: 'destructive' },
  ],
  ongoing: [
    { label: 'Re-engage', stage: 'prospect', variant: 'primary' },
    { label: 'Lost', stage: 'lost', variant: 'destructive' },
  ],
  lost: [{ label: 'Re-engage', stage: 'prospect', variant: 'primary' }],
}

export function contextTypeBadge(_type?: string): string {
  return 'bg-border-subtle text-text-secondary'
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function isOverdue(iso: string | null): boolean {
  if (!iso) return false
  return new Date(iso).getTime() < Date.now()
}

export function parseMetadata(json: string | null): Record<string, unknown> | null {
  if (!json) return null
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderSimpleMarkdown(md: string): string {
  let html = escapeHtml(md)

  html = html.replace(
    /^## (.+)$/gm,
    (_match, title) =>
      `<h4 class="font-semibold text-sm text-[color:var(--ss-color-text-primary)] mt-4 mb-1">${title}</h4>`
  )
  html = html.replace(/\*\*(.+?)\*\*/g, (_match, value) => `<strong>${value}</strong>`)
  html = html.replace(
    /^- (.+)$/gm,
    (_match, value) =>
      `<li class="ml-4 list-disc text-sm text-[color:var(--ss-color-text-primary)]">${value}</li>`
  )
  html = html.replace(
    /^\d+\. (.+)$/gm,
    (_match, value) =>
      `<li class="ml-4 list-decimal text-sm text-[color:var(--ss-color-text-primary)]">${value}</li>`
  )
  html = html.replace(
    /((?:<li class="ml-4 list-disc[^>]*>[^<]*<\/li>\n?)+)/g,
    (_match, value) => `<ul class="mb-2">${value}</ul>`
  )
  html = html.replace(
    /((?:<li class="ml-4 list-decimal[^>]*>[^<]*<\/li>\n?)+)/g,
    (_match, value) => `<ol class="mb-2">${value}</ol>`
  )
  html = html.replace(
    /^(?!<[hulo])(.+)$/gm,
    (_match, value) =>
      `<p class="text-sm text-[color:var(--ss-color-text-primary)] mb-2">${value}</p>`
  )
  html = html.replace(
    /<p class="text-sm text-\[color:var\(--color-text-primary\)\] mb-2"><\/p>/g,
    ''
  )

  return html
}

export function sentimentColor(trend: string): string {
  if (trend === 'improving') return 'text-text-primary bg-surface'
  if (trend === 'declining') return 'text-error bg-surface'
  return 'text-text-secondary bg-background'
}

export function confidenceColor(confidence?: string): string {
  if (confidence === 'high') return 'bg-surface text-text-primary border border-border'
  if (confidence === 'medium') return 'bg-background text-text-secondary border border-border'
  return 'bg-border-subtle text-text-secondary'
}

type ContextEntry = Awaited<ReturnType<typeof listContext>>[number]
type Contact = Awaited<ReturnType<typeof listContacts>>[number]
type Quote = Awaited<ReturnType<typeof listQuotes>>[number]

export interface EntityDetailPageResult {
  entity: EntityRecord
  contextEntries: ContextEntry[]
  contacts: Contact[]
  meetings: Awaited<ReturnType<typeof listMeetings>>
  engagements: Awaited<ReturnType<typeof listEngagements>>
  quotes: Quote[]
  invoices: Awaited<ReturnType<typeof listInvoices>>
  mostRecentDraftableMeeting: ReturnType<typeof findDraftableMeeting>
  hasOutreach: boolean
  filteredEntries: ContextEntry[]
  typeFilter: string
  typeCounts: Record<string, number>
  currentLostReason: { code: string; detail: string | null } | null
  promoted: string | null
  noteAdded: string | null
  replyLogged: string | null
  stageUpdated: string | null
  dossierGenerated: string | null
  contactAdded: string | null
  contactUpdated: string | null
  contactDeleted: string | null
  error: string | null
  showReEnrichButton: boolean
  showNewQuoteButton: boolean
  supersedeCandidates: Quote[]
  transitions: EntityDetailTransition[]
  dossierBrief: ContextEntry | undefined
  outreachEntry: ContextEntry | undefined
  outreachContact: Contact | null
  outreachMailto: string | null
  outreachFromDossier: unknown
  hasDossier: boolean
  lastEnrichmentAt: string | null
  latestSentQuoteAt: string | null
  reviewMeta: {
    unified_rating?: number | null
    total_reviews_across_platforms?: number
    sentiment_trend?: string
    top_themes?: string[]
    operational_problems?: Array<{ problem: string; confidence: string; evidence: string }>
  } | null
  websiteMeta: { digital_maturity?: { score: number; reasoning: string } } | null
  competitorMeta: { entity_rank_by_rating?: number | null; total_competitors?: number } | null
}

function extractUrlParams(url: URL): {
  typeFilter: string
  promoted: string | null
  noteAdded: string | null
  replyLogged: string | null
  stageUpdated: string | null
  dossierGenerated: string | null
  contactAdded: string | null
  contactUpdated: string | null
  contactDeleted: string | null
  error: string | null
} {
  const sp = url.searchParams
  return {
    typeFilter: sp.get('type') ?? '',
    promoted: sp.get('promoted'),
    noteAdded: sp.get('note_added'),
    replyLogged: sp.get('reply_logged'),
    stageUpdated: sp.get('stage_updated'),
    dossierGenerated: sp.get('dossier'),
    contactAdded: sp.get('contact_added'),
    contactUpdated: sp.get('contact_updated'),
    contactDeleted: sp.get('contact_deleted'),
    error: sp.get('error'),
  }
}

function resolveLostReason(
  entity: EntityRecord,
  contextEntries: ContextEntry[]
): { code: string; detail: string | null } | null {
  if (entity.stage !== 'lost') return null
  for (const entry of [...contextEntries].reverse().filter((e) => e.type === 'stage_change')) {
    if (!entry.metadata) continue
    try {
      const meta = JSON.parse(entry.metadata) as Record<string, unknown>
      if (meta.to === 'lost' && typeof meta.lost_reason === 'string') {
        return {
          code: meta.lost_reason,
          detail: typeof meta.lost_detail === 'string' ? meta.lost_detail : null,
        }
      }
    } catch {
      continue
    }
  }
  return null
}

function resolveOutreachMailto(
  outreachEntry: ContextEntry | undefined,
  outreachContact: Contact | null,
  entityName: string
): string | null {
  if (!outreachEntry || !outreachContact?.email) return null
  return (
    `mailto:${encodeURIComponent(outreachContact.email)}` +
    `?subject=${encodeURIComponent(`Reaching out - ${entityName}`)}` +
    `&body=${encodeURIComponent(outreachEntry.content)}`
  )
}

function resolveQuoteFlags(
  entity: EntityRecord,
  quotes: Quote[],
  meetings: Awaited<ReturnType<typeof listMeetings>>,
  hasOpenQuote: boolean
): { showNewQuoteButton: boolean; supersedeCandidates: Quote[]; latestSentQuoteAt: string | null } {
  const showNewQuoteButton =
    ['signal', 'prospect', 'meetings', 'proposing'].includes(entity.stage) &&
    !hasOpenQuote &&
    meetings.length > 0
  const supersedeCandidates = showNewQuoteButton
    ? quotes.filter((q) => q.status === 'declined' || q.status === 'expired')
    : []
  const latestSentQuote = quotes
    .filter((q) => q.sent_at)
    .sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? ''))[0]
  return {
    showNewQuoteButton,
    supersedeCandidates,
    latestSentQuoteAt: latestSentQuote?.sent_at ?? null,
  }
}

function resolveContextDerivedFields(
  contextEntries: ContextEntry[],
  typeFilter: string
): {
  filteredEntries: ContextEntry[]
  typeCounts: Record<string, number>
  dossierBrief: ContextEntry | undefined
  outreachEntry: ContextEntry | undefined
  reviewSynthEntry: ContextEntry | undefined
  deepWebsiteEntry: ContextEntry | undefined
  competitorEntry: ContextEntry | undefined
  lastEnrichmentAt: string | null
} {
  const timelineEntries = [...contextEntries].reverse()
  const filteredEntries = typeFilter
    ? timelineEntries.filter((e) => e.type === typeFilter)
    : timelineEntries
  const typeCounts: Record<string, number> = {}
  for (const entry of contextEntries) typeCounts[entry.type] = (typeCounts[entry.type] ?? 0) + 1
  return {
    filteredEntries,
    typeCounts,
    dossierBrief: contextEntries.filter((e) => e.source === 'intelligence_brief').pop(),
    outreachEntry: contextEntries.filter((e) => e.type === 'outreach_draft').pop(),
    reviewSynthEntry: contextEntries.filter((e) => e.source === 'review_synthesis').pop(),
    deepWebsiteEntry: contextEntries.filter((e) => e.source === 'deep_website').pop(),
    competitorEntry: contextEntries.filter((e) => e.source === 'competitors').pop(),
    lastEnrichmentAt:
      contextEntries
        .filter((e) => e.type === 'enrichment')
        .map((e) => e.created_at)
        .sort()
        .pop() ?? null,
  }
}

export async function loadEntityDetailPage(params: {
  db: Database
  orgId: string
  entityId: string
  url: URL
}): Promise<EntityDetailPageResult> {
  const entity = await getEntity(params.db, params.orgId, params.entityId)
  if (!entity) return null as never

  const [contextEntries, contacts, meetings, engagements, quotes, invoices] = await Promise.all([
    listContext(params.db, params.entityId),
    listContacts(params.db, params.orgId, params.entityId),
    listMeetings(params.db, params.orgId, params.entityId),
    listEngagements(params.db, params.orgId, params.entityId),
    listQuotes(params.db, params.orgId, params.entityId),
    listInvoices(params.db, params.orgId, { entityId: params.entityId }),
  ])

  const urlParams = extractUrlParams(params.url)
  const ctx = resolveContextDerivedFields(contextEntries, urlParams.typeFilter)

  const currentLostReason = resolveLostReason(entity, contextEntries)
  const outreachMeta = parseMetadata(ctx.outreachEntry?.metadata ?? null)
  const outreachContact = contacts.find((c) => c.email && c.email.trim().length > 0) ?? null
  const outreachMailto = resolveOutreachMailto(ctx.outreachEntry, outreachContact, entity.name)

  const hasOpenQuote = await hasOpenQuoteForEntity(params.db, params.orgId, params.entityId)
  const quoteFlags = resolveQuoteFlags(entity, quotes, meetings, hasOpenQuote)
  const showReEnrichButton = RE_ENRICH_STAGES.includes(entity.stage)
  const reviewMeta = parseMetadata(
    ctx.reviewSynthEntry?.metadata ?? null
  ) as EntityDetailPageResult['reviewMeta']
  const websiteMeta = parseMetadata(
    ctx.deepWebsiteEntry?.metadata ?? null
  ) as EntityDetailPageResult['websiteMeta']
  const competitorMeta = parseMetadata(
    ctx.competitorEntry?.metadata ?? null
  ) as EntityDetailPageResult['competitorMeta']
  const transitions = ENTITY_DETAIL_TRANSITIONS[entity.stage].map((t) => ({
    ...t,
    action: t.action ?? `/api/admin/entities/${entity.id}/stage`,
  }))

  return {
    entity,
    contextEntries,
    contacts,
    meetings,
    engagements,
    quotes,
    invoices,
    mostRecentDraftableMeeting: findDraftableMeeting(meetings, quotes),
    hasOutreach: contextEntries.some((e) => e.type === 'outreach_draft'),
    filteredEntries: ctx.filteredEntries,
    typeCounts: ctx.typeCounts,
    currentLostReason,
    ...urlParams,
    showReEnrichButton,
    showNewQuoteButton: quoteFlags.showNewQuoteButton,
    supersedeCandidates: quoteFlags.supersedeCandidates,
    transitions,
    dossierBrief: ctx.dossierBrief,
    outreachEntry: ctx.outreachEntry,
    outreachContact,
    outreachMailto,
    outreachFromDossier: outreachMeta?.trigger === 'dossier',
    hasDossier: !!ctx.dossierBrief,
    lastEnrichmentAt: ctx.lastEnrichmentAt,
    latestSentQuoteAt: quoteFlags.latestSentQuoteAt,
    reviewMeta,
    websiteMeta,
    competitorMeta,
  }
}
