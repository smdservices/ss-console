/**
 * Contact promotion — the seam fix (Phase 0, ADR 0058).
 *
 * Three enrichment modules scrape a contact email into append-only `context`
 * rows (deep_website -> metadata.contact_info.email, website_analysis ->
 * metadata.contact_email, outscraper -> metadata.emails[]). But the send path
 * (`getFirstContactWithEmailForEntities`) reads the structured `contacts`
 * table, which only the booking form ever wrote to. So scraped emails never
 * became reachable addresses — the "most prospects have no email" gap.
 *
 * This module bridges that: it picks the best email from an entity's
 * enrichment context and promotes it into `contacts`, with provenance
 * (email_source) and confidence (individual vs generic role mailbox).
 *
 * Safeguards (from the plan critique):
 *  - Source priority deep_website > website_analysis > outscraper, and an
 *    individual mailbox always beats a generic one.
 *  - Generic/role mailboxes (info@, contact@, ...) are NOT auto-promoted —
 *    they are reported for manual review rather than silently becoming the
 *    send target. Only individual mailboxes are promoted.
 *  - The DB is the dedup arbiter: INSERT ... ON CONFLICT(entity_id, email)
 *    DO NOTHING (unique index from migration 0079), no check-then-insert race.
 *  - The contact name is the real business name (`entity.name`) — never a
 *    fabricated "Business Owner" (P0 no-fabricated-content rule).
 */

import { listContext, type ContextEntry } from '../db/context.js'

/** Local-parts that indicate a shared/role inbox, not an individual person. */
const GENERIC_LOCAL_PARTS = new Set([
  'info',
  'contact',
  'contactus',
  'hello',
  'hi',
  'admin',
  'sales',
  'support',
  'help',
  'helpdesk',
  'office',
  'team',
  'mail',
  'email',
  'service',
  'services',
  'customerservice',
  'customercare',
  'care',
  'enquiries',
  'enquiry',
  'inquiries',
  'inquiry',
  'general',
  'marketing',
  'billing',
  'accounts',
  'accounting',
  'accountspayable',
  'ap',
  'ar',
  'hr',
  'jobs',
  'careers',
  'noreply',
  'no-reply',
  'donotreply',
  'webmaster',
  'postmaster',
  'abuse',
  'privacy',
  'legal',
  'orders',
  'booking',
  'bookings',
  'reservations',
  'frontdesk',
  'reception',
])

/** Source modules that carry a contact email, in promotion-priority order. */
const SOURCE_PRIORITY = ['deep_website', 'website_analysis', 'outscraper'] as const

export type EmailConfidence = 'individual' | 'generic'

export interface PickedEmail {
  email: string
  source: string
  confidence: EmailConfidence
}

export type PromoteReason =
  | 'promoted'
  | 'already_present'
  | 'no_email_in_enrichment'
  | 'only_generic_mailbox'

export interface PromoteResult {
  promoted: boolean
  reason: PromoteReason
  email?: string
  source?: string
  confidence?: EmailConfidence
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Classify an email as an individual person vs a generic/role inbox. */
export function classifyEmail(email: string): EmailConfidence {
  const local = email.split('@')[0]?.toLowerCase().trim() ?? ''
  // Strip a trailing separator+digits suffix (e.g. "sales2", "info-1").
  const base = local.replace(/[._-]?\d+$/, '')
  if (GENERIC_LOCAL_PARTS.has(local) || GENERIC_LOCAL_PARTS.has(base)) return 'generic'
  return 'individual'
}

/** Pull candidate emails from one enrichment context row's metadata. */
function emailsFromRow(row: ContextEntry): string[] {
  if (!row.metadata) return []
  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(row.metadata) as Record<string, unknown>
  } catch {
    return []
  }
  const out: string[] = []
  const push = (v: unknown) => {
    if (typeof v === 'string' && EMAIL_RE.test(v.trim())) out.push(v.trim())
  }

  // deep_website: metadata.contact_info.email
  const ci = meta.contact_info
  if (ci && typeof ci === 'object') push((ci as Record<string, unknown>).email)

  // website_analysis: metadata.contact_email (also tolerate metadata.email)
  push(meta.contact_email)
  push(meta.email)

  // outscraper: metadata.emails[] and/or email_1 / email_2 / email_3
  if (Array.isArray(meta.emails)) for (const e of meta.emails) push(e)
  push(meta.email_1)
  push(meta.email_2)
  push(meta.email_3)

  return out
}

/**
 * Choose the single best email for an entity from its enrichment context.
 * Individual mailboxes win over generic ones; ties break by source priority.
 * Returns null when no valid email exists anywhere.
 */
export function pickBestEmail(rows: ContextEntry[]): PickedEmail | null {
  const bySource = new Map<string, string[]>()
  for (const row of rows) {
    if (row.type !== 'enrichment') continue
    if (!SOURCE_PRIORITY.includes(row.source as (typeof SOURCE_PRIORITY)[number])) continue
    const emails = emailsFromRow(row)
    if (emails.length === 0) continue
    const existing = bySource.get(row.source) ?? []
    bySource.set(row.source, [...existing, ...emails])
  }

  let best: PickedEmail | null = null
  const rank = (c: EmailConfidence) => (c === 'individual' ? 0 : 1)
  for (const source of SOURCE_PRIORITY) {
    for (const email of bySource.get(source) ?? []) {
      const confidence = classifyEmail(email)
      const candidate: PickedEmail = { email, source, confidence }
      if (!best) {
        best = candidate
        continue
      }
      // Prefer individual over generic; otherwise keep the higher-priority
      // source (SOURCE_PRIORITY is iterated in order, so first-seen wins ties).
      if (rank(confidence) < rank(best.confidence)) best = candidate
    }
  }
  return best
}

/**
 * Promote the best individual email for an entity into the `contacts` table.
 * No-op (with a structured reason) when there is no email or only a generic
 * mailbox. Idempotent via the unique index on (entity_id, email).
 */
export async function promoteContactFromEnrichment(
  db: D1Database,
  orgId: string,
  entity: { id: string; name: string }
): Promise<PromoteResult> {
  const rows = await listContext(db, entity.id, { type: 'enrichment' })
  const picked = pickBestEmail(rows)

  if (!picked) return { promoted: false, reason: 'no_email_in_enrichment' }
  if (picked.confidence === 'generic') {
    return {
      promoted: false,
      reason: 'only_generic_mailbox',
      email: picked.email,
      source: picked.source,
      confidence: 'generic',
    }
  }

  const res = await db
    .prepare(
      `INSERT INTO contacts (id, org_id, entity_id, name, email, email_source, email_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id, email) DO NOTHING`
    )
    .bind(
      crypto.randomUUID(),
      orgId,
      entity.id,
      entity.name,
      picked.email,
      picked.source,
      picked.confidence
    )
    .run()

  const inserted = (res.meta?.changes ?? 0) > 0
  return {
    promoted: inserted,
    reason: inserted ? 'promoted' : 'already_present',
    email: picked.email,
    source: picked.source,
    confidence: 'individual',
  }
}
