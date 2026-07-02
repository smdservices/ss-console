/**
 * Cross-org isolation regression tests for the quotes and invoices DALs
 * (code review 2026-07-02 §4.6). Mirrors tests/admin/milestones.cross-org.test.ts,
 * but at the DAL layer: every org-scoped read/mutate must refuse a row that
 * belongs to another org.
 *
 * The invariant: getQuote / updateQuote / updateQuoteStatus (and the invoice
 * equivalents) take orgId and add `AND org_id = ?` to their queries. A call made
 * with org A's id against org B's row must return null and leave org B's row
 * untouched — the money-path analogue of the milestones #399 fix.
 *
 * Seeding is raw SQL (SQLite FK enforcement is off in the harness), matching the
 * proven milestones cross-org seed.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
  installWorkerdPolyfills,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import { getQuote, updateQuote, updateQuoteStatus } from '../src/lib/db/quotes'
import { getInvoice, updateInvoice, updateInvoiceStatus } from '../src/lib/db/invoices'

installWorkerdPolyfills()

const migrationsDir = resolve(process.cwd(), 'migrations')

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const QUOTE_A = 'quote-a'
const QUOTE_B = 'quote-b'
const INVOICE_A = 'invoice-a'
const INVOICE_B = 'invoice-b'

describe('quotes/invoices DAL — cross-org isolation', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })

    for (const [id, name, slug] of [
      [ORG_A, 'Org A', 'org-a'],
      [ORG_B, 'Org B', 'org-b'],
    ]) {
      await db
        .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
        .bind(id, name, slug)
        .run()
    }

    // entities + assessments are FK targets of quotes; seed one pair per org.
    for (const [orgId, suffix] of [
      [ORG_A, 'a'],
      [ORG_B, 'b'],
    ]) {
      await db
        .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
        .bind(`entity-${suffix}`, orgId, `Entity ${suffix}`, `entity-${suffix}`)
        .run()
      await db
        .prepare(
          `INSERT INTO assessments (id, org_id, entity_id, status) VALUES (?, ?, ?, 'completed')`
        )
        .bind(`assessment-${suffix}`, orgId, `entity-${suffix}`)
        .run()
    }

    // One quote per org.
    for (const [id, orgId, suffix] of [
      [QUOTE_A, ORG_A, 'a'],
      [QUOTE_B, ORG_B, 'b'],
    ]) {
      await db
        .prepare(
          `INSERT INTO quotes (id, org_id, entity_id, assessment_id, line_items, total_hours, rate, total_price, status)
           VALUES (?, ?, ?, ?, '[]', 10, 175, 1750, 'draft')`
        )
        .bind(id, orgId, `entity-${suffix}`, `assessment-${suffix}`)
        .run()
    }

    // One invoice per org (columns per createInvoice()).
    for (const [id, orgId, suffix] of [
      [INVOICE_A, ORG_A, 'a'],
      [INVOICE_B, ORG_B, 'b'],
    ]) {
      await db
        .prepare(
          `INSERT INTO invoices (id, org_id, entity_id, engagement_id, type, amount, description, status, due_date, created_at, updated_at)
           VALUES (?, ?, ?, NULL, 'deposit', 1000, 'Deposit ${suffix}', 'draft', NULL, datetime('now'), datetime('now'))`
        )
        .bind(id, orgId, `entity-${suffix}`)
        .run()
    }
  })

  // ---- quotes ------------------------------------------------------------
  it('getQuote returns the row for the owning org', async () => {
    expect(await getQuote(db, ORG_A, QUOTE_A)).not.toBeNull()
  })

  it('getQuote refuses a quote owned by another org', async () => {
    expect(await getQuote(db, ORG_A, QUOTE_B)).toBeNull()
  })

  it('updateQuote refuses a cross-org quote and leaves it untouched', async () => {
    const result = await updateQuote(db, ORG_A, QUOTE_B, { rate: 999 })
    expect(result).toBeNull()
    const row = await db
      .prepare('SELECT rate FROM quotes WHERE id = ?')
      .bind(QUOTE_B)
      .first<{ rate: number }>()
    expect(row?.rate).toBe(175)
  })

  it('updateQuoteStatus refuses a cross-org quote and leaves it untouched', async () => {
    const result = await updateQuoteStatus(db, ORG_A, QUOTE_B, 'accepted')
    expect(result).toBeNull()
    const row = await db
      .prepare('SELECT status FROM quotes WHERE id = ?')
      .bind(QUOTE_B)
      .first<{ status: string }>()
    expect(row?.status).toBe('draft')
  })

  // ---- invoices ----------------------------------------------------------
  it('getInvoice returns the row for the owning org', async () => {
    expect(await getInvoice(db, ORG_A, INVOICE_A)).not.toBeNull()
  })

  it('getInvoice refuses an invoice owned by another org', async () => {
    expect(await getInvoice(db, ORG_A, INVOICE_B)).toBeNull()
  })

  it('updateInvoice refuses a cross-org invoice and leaves it untouched', async () => {
    const result = await updateInvoice(db, ORG_A, INVOICE_B, { amount: 999 })
    expect(result).toBeNull()
    const row = await db
      .prepare('SELECT amount FROM invoices WHERE id = ?')
      .bind(INVOICE_B)
      .first<{ amount: number }>()
    expect(row?.amount).toBe(1000)
  })

  it('updateInvoiceStatus refuses a cross-org invoice and leaves it untouched', async () => {
    const result = await updateInvoiceStatus(db, ORG_A, INVOICE_B, 'sent')
    expect(result).toBeNull()
    const row = await db
      .prepare('SELECT status FROM invoices WHERE id = ?')
      .bind(INVOICE_B)
      .first<{ status: string }>()
    expect(row?.status).toBe('draft')
  })
})
