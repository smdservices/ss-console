import { describe, expect, it } from 'vitest'
import { classifyEmail, pickBestEmail } from '../src/lib/enrichment/promote-contacts'
import type { ContextEntry } from '../src/lib/db/context'

function row(source: string, metadata: Record<string, unknown> | null): ContextEntry {
  return {
    id: crypto.randomUUID(),
    entity_id: 'e1',
    org_id: 'o1',
    type: 'enrichment',
    content: '',
    source,
    source_ref: null,
    content_size: null,
    metadata: metadata === null ? null : JSON.stringify(metadata),
    engagement_id: null,
    created_at: '2026-07-01T00:00:00.000Z',
  }
}

describe('classifyEmail', () => {
  it('flags role/shared mailboxes as generic', () => {
    for (const e of [
      'info@acme.com',
      'contact@acme.com',
      'sales@acme.com',
      'customerservice@acme.com',
      'office@acme.com',
      'no-reply@acme.com',
      'billing@acme.com',
      'info2@acme.com',
      'sales-1@acme.com',
    ]) {
      expect(classifyEmail(e)).toBe('generic')
    }
  })

  it('treats personal local-parts as individual', () => {
    for (const e of [
      'cheryl@acme.com',
      'j.smith@acme.com',
      'mrodriguez@acme.com',
      'dan@acme.com',
    ]) {
      expect(classifyEmail(e)).toBe('individual')
    }
  })
})

describe('pickBestEmail', () => {
  it('returns null when no enrichment row carries an email', () => {
    expect(pickBestEmail([row('deep_website', { contact_info: { phone: '555' } })])).toBeNull()
    expect(pickBestEmail([])).toBeNull()
  })

  it('extracts deep_website email from contact_info.email', () => {
    const picked = pickBestEmail([row('deep_website', { contact_info: { email: 'dan@acme.com' } })])
    expect(picked).toEqual({
      email: 'dan@acme.com',
      source: 'deep_website',
      confidence: 'individual',
    })
  })

  it('extracts website_analysis contact_email and outscraper emails[]', () => {
    expect(pickBestEmail([row('website_analysis', { contact_email: 'kim@acme.com' })])?.email).toBe(
      'kim@acme.com'
    )
    expect(pickBestEmail([row('outscraper', { emails: ['pat@acme.com'] })])?.email).toBe(
      'pat@acme.com'
    )
  })

  it('prefers an individual mailbox over a generic one, even from a lower-priority source', () => {
    const picked = pickBestEmail([
      row('deep_website', { contact_info: { email: 'info@acme.com' } }),
      row('outscraper', { emails: ['maria@acme.com'] }),
    ])
    expect(picked).toEqual({
      email: 'maria@acme.com',
      source: 'outscraper',
      confidence: 'individual',
    })
  })

  it('breaks ties by source priority when confidence is equal', () => {
    const picked = pickBestEmail([
      row('outscraper', { emails: ['a@acme.com'] }),
      row('deep_website', { contact_info: { email: 'b@acme.com' } }),
      row('website_analysis', { contact_email: 'c@acme.com' }),
    ])
    // all individual -> highest-priority source (deep_website) wins
    expect(picked).toEqual({
      email: 'b@acme.com',
      source: 'deep_website',
      confidence: 'individual',
    })
  })

  it('falls back to a generic mailbox only when no individual exists', () => {
    const picked = pickBestEmail([
      row('deep_website', { contact_info: { email: 'info@acme.com' } }),
    ])
    expect(picked).toEqual({
      email: 'info@acme.com',
      source: 'deep_website',
      confidence: 'generic',
    })
  })

  it('ignores emails from non-contact sources like news_search', () => {
    expect(pickBestEmail([row('news_search', { email: 'author@nytimes.com' })])).toBeNull()
  })

  it('tolerates malformed metadata JSON without throwing', () => {
    const bad: ContextEntry = { ...row('deep_website', null), metadata: '{not json' }
    expect(pickBestEmail([bad])).toBeNull()
  })
})
