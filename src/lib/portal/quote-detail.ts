/**
 * Portal quote detail reader.
 *
 * Moves quote-detail D1 lookups out of the Astro frontmatter and keeps every
 * related read scoped by the signed-in portal client entity and org.
 */

import { getQuoteForEntity, type Quote } from '../db/quotes'
import { getSOWStateForQuote, type SOWState } from '../sow/service'

export interface PortalQuoteEngagement {
  id: string
  consultant_name: string | null
  consultant_phone: string | null
  next_touchpoint_label: string | null
}

export interface PortalSupersedingQuote {
  id: string
}

export interface PortalQuoteDetail {
  quote: Quote
  sowState: SOWState
  engagement: PortalQuoteEngagement | null
  superseding: PortalSupersedingQuote | null
}

export async function loadPortalQuoteDetail(
  db: D1Database,
  orgId: string,
  entityId: string,
  quoteId: string
): Promise<PortalQuoteDetail | null> {
  const quote = await getQuoteForEntity(db, orgId, entityId, quoteId)
  if (!quote) return null

  const [sowState, engagement, superseding] = await Promise.all([
    getSOWStateForQuote(db, orgId, quote.id),
    loadQuoteEngagement(db, orgId, quote.id),
    loadSupersedingQuote(db, orgId, entityId, quote),
  ])

  return { quote, sowState, engagement, superseding }
}

async function loadQuoteEngagement(
  db: D1Database,
  orgId: string,
  quoteId: string
): Promise<PortalQuoteEngagement | null> {
  const row = await db
    .prepare(
      `SELECT id, consultant_name, consultant_phone, next_touchpoint_label
       FROM engagements
       WHERE quote_id = ? AND org_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(quoteId, orgId)
    .first<PortalQuoteEngagement>()

  return row ?? null
}

async function loadSupersedingQuote(
  db: D1Database,
  orgId: string,
  entityId: string,
  quote: Pick<Quote, 'id' | 'assessment_id' | 'version'>
): Promise<PortalSupersedingQuote | null> {
  const row = await db
    .prepare(
      `SELECT id FROM quotes
       WHERE (parent_quote_id = ? OR (assessment_id = ? AND version > ? AND status IN ('sent', 'accepted')))
         AND entity_id = ?
         AND org_id = ?
       ORDER BY version DESC
       LIMIT 1`
    )
    .bind(quote.id, quote.assessment_id, quote.version, entityId, orgId)
    .first<PortalSupersedingQuote>()

  return row ?? null
}
