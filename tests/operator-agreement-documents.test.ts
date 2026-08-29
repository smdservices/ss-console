/**
 * Executed Operator agreement documents (ss#2641).
 *
 * Two properties are worth testing and the rest is plumbing:
 *
 *   1. **Only executed paper can be recorded.** The portal renders whatever is
 *      here as the firm's operative terms, so a draft or a future-dated
 *      document must be impossible to enter.
 *   2. **A key is authorized by its ROW, not its shape.** The download
 *      endpoint serves three document families; an agreement key belonging to
 *      another firm must be refused outright rather than falling through to
 *      the engagement checks, and a caller without a governance role must be
 *      refused even for its own firm's paper.
 */

import { describe, it, expect } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { isExecutedOnValid } from '../src/lib/db/operator-agreements'
import {
  getOperatorAgreementForKey,
  listAgreementsForInstance,
  AGREEMENT_READER_ROLES,
} from '../src/lib/portal/agreement-documents'

const TODAY = new Date('2026-08-29T18:00:00Z')

const ROW = {
  id: 'doc-1',
  org_id: 'org-1',
  entity_id: 'ent-1',
  instance_slug: 'ashton-price',
  title: 'Operator Service Agreement',
  executed_on: '2026-09-08',
  storage_key: 'org-1/operator/ashton-price/agreements/ab12cd34/agreement.pdf',
  file_name: 'agreement.pdf',
  uploaded_by: 'user-admin',
  created_at: '2026-09-08T00:00:00Z',
  updated_at: '2026-09-08T00:00:00Z',
}

/** D1 fake: one document row (or none) plus a role list. */
function makeDb(opts: { row?: typeof ROW | null; roles?: string[]; rows?: (typeof ROW)[] }) {
  const db = {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            first() {
              if (sql.includes('operator_agreement_documents')) {
                return Promise.resolve(opts.row ?? null)
              }
              throw new Error(`unexpected first(): ${sql}`)
            },
            all() {
              if (sql.includes('FROM product_roles')) {
                return Promise.resolve({ results: (opts.roles ?? []).map((role) => ({ role })) })
              }
              if (sql.includes('operator_agreement_documents')) {
                return Promise.resolve({ results: opts.rows ?? [] })
              }
              throw new Error(`unexpected all(): ${sql}`)
            },
          }
        },
      }
    },
  }
  return db as unknown as D1Database
}

describe('isExecutedOnValid', () => {
  it('accepts a past or present date', () => {
    expect(isExecutedOnValid('2026-08-29', TODAY)).toBe(true)
    expect(isExecutedOnValid('2026-07-27', TODAY)).toBe(true)
  })

  it('REFUSES a future date — an agreement executed tomorrow is not executed', () => {
    expect(isExecutedOnValid('2026-08-30', TODAY)).toBe(false)
    expect(isExecutedOnValid('2027-01-01', TODAY)).toBe(false)
  })

  it('refuses a malformed or impossible date rather than rolling it over', () => {
    expect(isExecutedOnValid('', TODAY)).toBe(false)
    expect(isExecutedOnValid('08/29/2026', TODAY)).toBe(false)
    expect(isExecutedOnValid('2026-8-29', TODAY)).toBe(false)
    // Date() would silently roll this into March; the round-trip guard catches it.
    expect(isExecutedOnValid('2026-02-31', TODAY)).toBe(false)
  })
})

describe('getOperatorAgreementForKey', () => {
  const args = { userId: 'user-1', orgId: 'org-1', entityId: 'ent-1' }

  it('allows a principal to read their own firm’s executed paper', async () => {
    const db = makeDb({ row: ROW, roles: ['principal'] })
    const decision = await getOperatorAgreementForKey(db, { ...args, key: ROW.storage_key })
    expect(decision.kind).toBe('allowed')
  })

  it('allows the compliance role too — the same set the Compliance page admits', async () => {
    const db = makeDb({ row: ROW, roles: ['compliance'] })
    const decision = await getOperatorAgreementForKey(db, { ...args, key: ROW.storage_key })
    expect(decision.kind).toBe('allowed')
    expect(AGREEMENT_READER_ROLES).toEqual(['principal', 'compliance'])
  })

  it('REFUSES a role outside the governance set', async () => {
    const db = makeDb({ row: ROW, roles: ['staff'] })
    const decision = await getOperatorAgreementForKey(db, { ...args, key: ROW.storage_key })
    expect(decision.kind).toBe('forbidden')
  })

  it('REFUSES another firm’s document instead of falling through to the engagement checks', async () => {
    const db = makeDb({ row: { ...ROW, entity_id: 'ent-OTHER' }, roles: ['principal'] })
    const decision = await getOperatorAgreementForKey(db, { ...args, key: ROW.storage_key })
    expect(decision.kind).toBe('forbidden')
  })

  it('REFUSES a document from another org', async () => {
    const db = makeDb({ row: { ...ROW, org_id: 'org-OTHER' }, roles: ['principal'] })
    const decision = await getOperatorAgreementForKey(db, { ...args, key: ROW.storage_key })
    expect(decision.kind).toBe('forbidden')
  })

  it('falls through for a non-agreement key so engagement documents still serve', async () => {
    const db = makeDb({ row: null, roles: ['principal'] })
    const decision = await getOperatorAgreementForKey(db, {
      ...args,
      key: 'org-1/engagements/eng-1/docs/aa11bb22/sow.pdf',
    })
    expect(decision.kind).toBe('not_agreement')
  })
})

describe('listAgreementsForInstance', () => {
  it('renders nothing rather than promising paper that does not exist', async () => {
    const db = makeDb({ rows: [] })
    expect(await listAgreementsForInstance(db, 'ent-1', 'ashton-price')).toEqual([])
  })

  it('carries the authored title and date through to the portal row', async () => {
    const db = makeDb({ rows: [ROW] })
    const items = await listAgreementsForInstance(db, 'ent-1', 'ashton-price')
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Operator Service Agreement')
    expect(items[0].executedOn).toBe('2026-09-08')
    expect(items[0].href).toBe(`/api/portal/documents/${ROW.storage_key}`)
  })
})
