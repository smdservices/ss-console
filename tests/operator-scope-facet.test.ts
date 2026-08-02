import { describe, it, expect } from 'vitest'
import { resolveOperatorScope } from '../src/lib/portal/operator/facets/scope/scope'
import type { CustomerConfigRow } from '../src/lib/portal/customer-config'

/**
 * Operator Scope facet resolver (ADR 0069; brief
 * docs/design/operator/surface-briefs/operator-scope.md; ADR 0076 Boundaries
 * chapter). Boundaries from the config projection: what it can see, who it
 * responds to (the ADR 0055 roster), what's off limits — nothing fabricated.
 */

/** Minimal config fixture — only the raw projected scope blob matters. */
function config(scope: unknown): CustomerConfigRow {
  return { scope } as unknown as CustomerConfigRow
}

const FULL_SCOPE = {
  email_folders_visible: ['Inbox', 'Sent'],
  email_folders_blind: ['Legal'],
  email_keyword_blocks: ['payroll'],
  domain_blocks: ['competitor.com'],
  matter_blocks: ['Smith v. Jones'],
  inbound_allow_from: ['scott@smd.services', '@smd.services'],
}

describe('resolveOperatorScope', () => {
  it('maps every projected scope field into its client-legible group', () => {
    const model = resolveOperatorScope(config(FULL_SCOPE))
    expect(model.scope).toEqual({
      sees: ['Inbox', 'Sent'],
      neverSees: ['Legal'],
      respondsTo: ['scott@smd.services', '@smd.services'],
      setsStandards: [],
      writesTo: [],
      blockedTopics: ['payroll'],
      blockedSenders: ['competitor.com'],
      blockedWork: ['Smith v. Jones'],
    })
  })

  it('surfaces the Operator-admin list separately from the roster (ADR 0085 §2)', () => {
    const model = resolveOperatorScope(
      config({
        ...FULL_SCOPE,
        inbound_allow_from: ['@example-firm.com'],
        admins: ['dana@example-firm.com'],
      })
    )
    // The roster is domain-wide; the admin list is one person. The two groups
    // must not collapse into each other on the page.
    expect(model.scope?.setsStandards).toEqual(['dana@example-firm.com'])
    expect(model.scope?.respondsTo).toEqual(['@example-firm.com'])
  })

  it('keeps the three block kinds separate — never mashed into one list', () => {
    const model = resolveOperatorScope(
      config({
        ...FULL_SCOPE,
        email_keyword_blocks: ['a'],
        domain_blocks: ['b'],
        matter_blocks: [],
      })
    )
    expect(model.scope?.blockedTopics).toEqual(['a'])
    expect(model.scope?.blockedSenders).toEqual(['b'])
    expect(model.scope?.blockedWork).toEqual([])
  })

  it('carries an empty roster through as [] — the fail-closed posture the viewer must state plainly', () => {
    const model = resolveOperatorScope(config({ ...FULL_SCOPE, inbound_allow_from: [] }))
    expect(model.scope?.respondsTo).toEqual([])
  })

  it('maps outbound_roster entries to plain class labels, address verbatim, note carried (ADR 0075)', () => {
    const model = resolveOperatorScope(
      config({
        ...FULL_SCOPE,
        outbound_roster: [
          { address: 'records@vendor.example', class: 'records_vendor', note: 'chase inbox' },
          { address: 'owner@client.example', class: 'client' },
        ],
      })
    )
    expect(model.scope?.writesTo).toEqual([
      { address: 'records@vendor.example', classLabel: 'Records vendor', note: 'chase inbox' },
      { address: 'owner@client.example', classLabel: 'Client', note: null },
    ])
  })

  it('drops malformed outbound entries (unknown class, missing address) — parser is lenient, never throws', () => {
    const model = resolveOperatorScope(
      config({
        ...FULL_SCOPE,
        outbound_roster: [
          { address: 'ok@client.example', class: 'client' },
          { address: 'bad@x.example', class: 'opposing_counsel' },
          { class: 'client' },
          'not-an-object',
        ],
      })
    )
    expect(model.scope?.writesTo).toEqual([
      { address: 'ok@client.example', classLabel: 'Client', note: null },
    ])
  })

  it('an absent outbound_roster renders the honest empty ([] — no standing recipients configured)', () => {
    const model = resolveOperatorScope(config(FULL_SCOPE))
    expect(model.scope?.writesTo).toEqual([])
  })

  it('is null when config is null (page-level honest empty state)', () => {
    expect(resolveOperatorScope(null).scope).toBeNull()
  })

  it('is null when the projection carries no scope blob', () => {
    expect(resolveOperatorScope(config(null)).scope).toBeNull()
    expect(resolveOperatorScope(config(undefined)).scope).toBeNull()
  })

  it('is null when the scope blob is malformed (not an object)', () => {
    expect(resolveOperatorScope(config('nonsense')).scope).toBeNull()
    expect(resolveOperatorScope(config(['a'])).scope).toBeNull()
  })

  it('tolerates missing list fields (parseScope narrows each to [])', () => {
    const model = resolveOperatorScope(config({ email_folders_visible: ['Inbox'] }))
    expect(model.scope).toEqual({
      sees: ['Inbox'],
      neverSees: [],
      respondsTo: [],
      setsStandards: [],
      writesTo: [],
      blockedTopics: [],
      blockedSenders: [],
      blockedWork: [],
    })
  })

  it('ignores unvalidated keys (trusted_sender_domains never reaches the view model)', () => {
    const model = resolveOperatorScope(
      config({ ...FULL_SCOPE, trusted_sender_domains: ['smdurgan.com'] })
    )
    expect(model.scope).not.toHaveProperty('trusted_sender_domains')
    expect(Object.values(model.scope!).flat()).not.toContain('smdurgan.com')
  })
})
