import type { Entity, EntitySignalMetadata } from '../db/entities'
import type { ContextEntry } from '../db/context'
import type { Contact } from '../db/contacts'
import type { EnrichmentRun } from '../db/enrichment-runs'

type ActorRole = NonNullable<EntitySignalMetadata['actor_role']>
type ActorRoleConfidence = NonNullable<EntitySignalMetadata['actor_role_confidence']>

export type MissingForOutreachItem = {
  key: 'contact' | 'website' | 'public-web-signal'
  label: string
  reason: string
}

export interface DecisionEvidence {
  actorRole: ActorRole
  actorRoleConfidence: ActorRoleConfidence
  signalEvidence: string | null
  enrichmentSummary: string | null
  structuralFlags: string[]
  missingForOutreach: MissingForOutreachItem[]
  staleDraftWarning: {
    isStale: boolean
    reason: string | null
  }
}

export const ADR_0003_DEPLOY_DATE = '2026-05-07T00:00:00Z'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatSignalDate(raw: string | null): string | null {
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function composeSignalEvidence(
  metadata: EntitySignalMetadata | null | undefined,
  entityName?: string
): string | null {
  if (!metadata) return null
  const subject = metadata.signal_subject?.trim()
  const normalizedEntityName = entityName?.trim().toLowerCase()
  const normalizedSubject = subject?.toLowerCase()
  const subjectPart =
    normalizedEntityName && normalizedSubject === normalizedEntityName ? null : (subject ?? null)

  const parts = [
    metadata.signal_source_label,
    subjectPart,
    metadata.signal_location,
    formatSignalDate(metadata.signal_date),
  ].filter((part): part is string => !!part)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function resolveActorRole(metadata: EntitySignalMetadata | null | undefined): {
  role: ActorRole
  confidence: ActorRoleConfidence
} {
  return {
    role: metadata?.actor_role ?? 'unknown',
    confidence: metadata?.actor_role_confidence ?? 'low',
  }
}

function composeStructuralFlags(
  entity: Entity,
  metadata: EntitySignalMetadata | null | undefined
): string[] {
  const flags = new Set<string>()
  const address = metadata?.signal_address ?? ''
  if (/\b(ste|suite|unit)\b/i.test(address)) {
    flags.add('Single-tenant suite')
  }

  const geographyText = [address, metadata?.signal_location, entity.area].filter(Boolean).join(' ')
  if (/\b(arizona|az)\b/i.test(geographyText)) {
    flags.add('Arizona')
  }

  return [...flags]
}

function firstSentence(text: string | null | undefined): string | null {
  if (!text) return null
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^##\s+/.test(line))

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[-*]\s+/, '')
    const match = line.match(/.+?[.!?](?=\s|$)/)
    if (match) return match[0].trim()
    if (line.length > 0) return line
  }

  return null
}

function firstParagraphFromBrief(content: string | null | undefined): string | null {
  if (!content) return null

  const lines = content.split('\n')
  const paragraph: string[] = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      if (paragraph.length > 0) break
      continue
    }
    if (/^##\s+(Engagement Hypotheses|Outreach Hooks)\b/i.test(line)) break
    if (/^##\s+/.test(line)) continue
    if (/^[-*]\s+/.test(line)) {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(line)
  }

  const value = paragraph.join(' ').trim()
  return value || null
}

export function composeEnrichmentSummary(
  reviewSynthEntry: ContextEntry | undefined,
  deepWebsiteEntry: ContextEntry | undefined,
  intelligenceBriefEntry: ContextEntry | undefined
): string | null {
  return (
    firstSentence(reviewSynthEntry?.content) ??
    firstSentence(deepWebsiteEntry?.content) ??
    firstParagraphFromBrief(intelligenceBriefEntry?.content)
  )
}

function buildWebsiteMissingReason(
  entity: Entity,
  enrichmentRuns: Map<string, EnrichmentRun>
): string {
  const reasons: string[] = []
  const placesReason = enrichmentRuns.get('google_places')?.reason
  if (placesReason) reasons.push(`Google Places ${placesReason}`)

  const outscraperReason = enrichmentRuns.get('outscraper')?.reason
  if (!placesReason && outscraperReason === 'no_match') {
    reasons.push('Outscraper no_match')
  }

  if (reasons.length === 0) return 'not resolved.'
  return `not resolved (${reasons.join('; ')})`
}

export function composeMissingForOutreach(
  entity: Entity,
  contextEntries: ContextEntry[],
  contacts: Contact[],
  enrichmentRuns: Map<string, EnrichmentRun>
): MissingForOutreachItem[] {
  const missing: MissingForOutreachItem[] = []
  const hasEmailContact = contacts.some((contact) => !!contact.email?.trim())
  if (!hasEmailContact) {
    missing.push({
      key: 'contact',
      label: 'Contact email',
      reason: 'none on file. Promote will trigger contact discovery.',
    })
  }

  if (!entity.website?.trim()) {
    missing.push({
      key: 'website',
      label: 'Website',
      reason: buildWebsiteMissingReason(entity, enrichmentRuns),
    })
  }

  const hasPublicWebSignal = contextEntries.some(
    (entry) => entry.source === 'review_analysis' || entry.source === 'job_monitor'
  )
  if (!hasPublicWebSignal) {
    const reviewReason = enrichmentRuns.get('review_analysis')?.reason
    missing.push({
      key: 'public-web-signal',
      label: 'Public-web signal',
      reason: reviewReason
        ? `no public review or job-post signal yet (${reviewReason}).`
        : 'no public review or job-post signal yet.',
    })
  }

  return missing
}

export function detectStaleDraft(outreachEntry: ContextEntry | undefined): {
  isStale: boolean
  reason: string | null
} {
  if (!outreachEntry) return { isStale: false, reason: null }

  const reasons: string[] = []
  if (new Date(outreachEntry.created_at).getTime() < Date.parse(ADR_0003_DEPLOY_DATE)) {
    reasons.push(`Generated ${formatDate(outreachEntry.created_at)} - pre-statewide pivot`)
  }

  const phoenixPhrase = outreachEntry.content.match(/Phoenix\s+(area|metro)/i)?.[0]
  if (phoenixPhrase) {
    reasons.push(`References "${phoenixPhrase}"`)
  }

  return {
    isStale: reasons.length > 0,
    reason: reasons.length > 0 ? `${reasons.join('. ')}.` : null,
  }
}

export function composeDeduplicatedTimeline(contextEntries: ContextEntry[]): ContextEntry[] {
  const out: ContextEntry[] = []
  const latestBySource = new Set<string>()

  for (const entry of [...contextEntries].reverse()) {
    if (entry.type === 'outreach_draft') continue
    if (entry.source === 'intelligence_brief') continue
    if (entry.source === 'review_synthesis' || entry.source === 'review_analysis') {
      if (latestBySource.has(entry.source)) continue
      latestBySource.add(entry.source)
    }
    out.push(entry)
  }

  return out
}

export function buildDecisionEvidence(args: {
  entity: Entity
  signalMetadata: EntitySignalMetadata | null
  contextEntries: ContextEntry[]
  contacts: Contact[]
  reviewSynthEntry: ContextEntry | undefined
  deepWebsiteEntry: ContextEntry | undefined
  intelligenceBriefEntry: ContextEntry | undefined
  outreachEntry: ContextEntry | undefined
  enrichmentRuns: Map<string, EnrichmentRun>
}): DecisionEvidence {
  const actorRole = resolveActorRole(args.signalMetadata)
  return {
    actorRole: actorRole.role,
    actorRoleConfidence: actorRole.confidence,
    signalEvidence: composeSignalEvidence(args.signalMetadata, args.entity.name),
    enrichmentSummary: composeEnrichmentSummary(
      args.reviewSynthEntry,
      args.deepWebsiteEntry,
      args.intelligenceBriefEntry
    ),
    structuralFlags: composeStructuralFlags(args.entity, args.signalMetadata),
    missingForOutreach: composeMissingForOutreach(
      args.entity,
      args.contextEntries,
      args.contacts,
      args.enrichmentRuns
    ),
    staleDraftWarning: detectStaleDraft(args.outreachEntry),
  }
}
