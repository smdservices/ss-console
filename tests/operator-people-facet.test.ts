import { describe, it, expect } from 'vitest'
import { resolveOperatorPeople } from '../src/lib/portal/operator/facets/people/people'
import type { CustomerConfigRow } from '../src/lib/portal/customer-config'

/**
 * Operator People facet resolver (console blueprint §5 — chapter 4). Composes
 * the scope resolver's rosters/blocks with the escalation parse; team members
 * are page-loaded (DB read) and not part of this pure model. Nothing
 * fabricated: empty inputs stay empty, a missing scope blob is a page-level
 * empty state.
 */

function config(scope: unknown, escalation: unknown = null): CustomerConfigRow {
  return { scope, escalation } as unknown as CustomerConfigRow
}

const SCOPE = {
  email_folders_visible: ['Inbox'],
  inbound_allow_from: ['@firm.example', 'owner@firm.example'],
  outbound_roster: [{ address: 'records@vendor.example', class: 'records_vendor' }],
  email_keyword_blocks: ['payroll'],
  domain_blocks: [],
  matter_blocks: [],
}

describe('resolveOperatorPeople', () => {
  it('composes rosters, escalation, and blocks from the shared readers', () => {
    const model = resolveOperatorPeople(
      config(SCOPE, {
        red_flag_recipients: ['owner@firm.example'],
        failure_recipients: ['team@smd.services'],
      })
    )
    expect(model.people).not.toBeNull()
    expect(model.people?.respondsTo).toEqual(['@firm.example', 'owner@firm.example'])
    expect(model.people?.writesTo).toEqual([
      { address: 'records@vendor.example', classLabel: 'Records vendor', note: null },
    ])
    expect(model.people?.escalation.redFlagRecipients).toEqual(['owner@firm.example'])
    expect(model.people?.escalation.failureRecipients).toEqual(['team@smd.services'])
    expect(model.people?.blockedTopics).toEqual(['payroll'])
    expect(model.people?.blockedSenders).toEqual([])
    expect(model.people?.blockedWork).toEqual([])
  })

  it('empty escalation renders empty lists, never fabricated contacts', () => {
    const model = resolveOperatorPeople(config(SCOPE, null))
    expect(model.people?.escalation.redFlagRecipients).toEqual([])
    expect(model.people?.escalation.failureRecipients).toEqual([])
  })

  it('is null when the projection carries no scope blob (page-level honest empty)', () => {
    expect(resolveOperatorPeople(config(null)).people).toBeNull()
    expect(resolveOperatorPeople(null).people).toBeNull()
  })
})
