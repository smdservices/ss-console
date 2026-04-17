/**
 * Invoice send-gate behavior test (#398).
 *
 * Mirrors the quote send-gate: a draft invoice cannot transition to sent
 * without at least one authored line item. The gate defends against the
 * 2026-04-17 audit finding where invoice portal pages would fabricate
 * 'Engagement work' or borrow engagement.scope_summary when line items
 * were missing. The portal now renders nothing when line items are absent;
 * the send-gate prevents that state from ever reaching a client.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { createInvoice, updateInvoiceStatus } from '../src/lib/db/invoices'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'

const migrationsDir = resolve(process.cwd(), 'migrations')

const ORG = 'org-a'
const ENTITY = 'entity-a'

describe('invoice send-gate — authored line items required (#398)', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })

    await db
      .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind(ORG, 'Org A', 'org-a')
      .run()

    await db
      .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
      .bind(ENTITY, ORG, 'Entity A', 'entity-a')
      .run()
  })

  it('throws when transitioning draft -> sent without any line items', async () => {
    const invoice = await createInvoice(db, ORG, {
      entity_id: ENTITY,
      type: 'deposit',
      amount: 500,
      description: 'Deposit for Phase 1',
    })

    await expect(updateInvoiceStatus(db, ORG, invoice.id, 'sent')).rejects.toThrow(
      /missing authored line items/
    )

    // Status must remain draft.
    const after = await db
      .prepare('SELECT status FROM invoices WHERE id = ?')
      .bind(invoice.id)
      .first<{ status: string }>()
    expect(after?.status).toBe('draft')
  })

  it('allows transition to sent once a line item is authored', async () => {
    const invoice = await createInvoice(db, ORG, {
      entity_id: ENTITY,
      type: 'deposit',
      amount: 500,
      description: 'Deposit for Phase 1',
    })

    await db
      .prepare(
        `INSERT INTO invoice_line_items (id, invoice_id, description, amount_cents, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind('li-1', invoice.id, 'Solution Design — Phase 1', 50_000, 0)
      .run()

    const sent = await updateInvoiceStatus(db, ORG, invoice.id, 'sent')
    expect(sent?.status).toBe('sent')
    expect(sent?.sent_at).not.toBeNull()
  })
})
