import { describe, it, expect } from 'vitest'
import {
  buildServiceList,
  serviceListStats,
  type OperatorInput,
} from '../src/lib/admin/services-list'
import type { Engagement } from '../src/lib/db/engagements'
import type { Quote } from '../src/lib/db/quotes'

const NOW = new Date('2026-06-10T12:00:00Z')

function eng(
  partial: Partial<Engagement> & { id: string; entity_id: string; status: string }
): Engagement {
  return {
    quote_id: null,
    scope_summary: 'Ops cleanup',
    start_date: null,
    estimated_end: null,
    handoff_date: null,
    safety_net_end: null,
    ...partial,
  } as unknown as Engagement
}

describe('buildServiceList', () => {
  it('excludes completed and cancelled engagements (in-motion only)', () => {
    const rows = buildServiceList({
      engagements: [
        eng({ id: 'e1', entity_id: 'c1', status: 'completed' }),
        eng({ id: 'e2', entity_id: 'c2', status: 'cancelled' }),
        eng({ id: 'e3', entity_id: 'c3', status: 'active' }),
      ],
      entityName: () => 'Client',
      quotesById: new Map(),
      operators: [],
      now: NOW,
    })
    expect(rows.map((r) => r.title === 'Ops cleanup' && r.statusLabel)).toEqual(['Active'])
  })

  it('sorts by risk: alerting operator, then overdue handoff, then safety-net soon', () => {
    const operators: OperatorInput[] = [
      {
        entityId: 'op1',
        clientName: 'Alpha',
        configError: null,
        openAlerts: 2,
        hasRuntime: true,
        recurringPrice: null,
      },
      {
        entityId: 'op2',
        clientName: 'Bravo',
        configError: null,
        openAlerts: 0,
        hasRuntime: true,
        recurringPrice: null,
      },
    ]
    const rows = buildServiceList({
      engagements: [
        eng({ id: 'e1', entity_id: 'c1', status: 'active' }),
        eng({
          id: 'e2',
          entity_id: 'c2',
          status: 'handoff',
          handoff_date: '2026-06-05T00:00:00Z', // 5d overdue
        }),
        eng({
          id: 'e3',
          entity_id: 'c3',
          status: 'safety_net',
          safety_net_end: '2026-06-13T00:00:00Z', // 3d out
        }),
      ],
      entityName: (id) => id,
      quotesById: new Map(),
      operators,
      now: NOW,
    })
    // alerting operator first, healthy operator last
    expect(rows[0].kind).toBe('operator')
    expect(rows[0].statusLabel).toBe('Alerting')
    expect(rows[1].risk).toContain('Handoff overdue')
    expect(rows[2].risk).toContain('Safety-net ends')
    expect(rows[rows.length - 1].statusLabel).toBe('Healthy')
  })

  it('draws consulting value from the quote; operator value from the spine price', () => {
    const quote = { id: 'q1', total_price: 8400 } as unknown as Quote
    const rows = buildServiceList({
      engagements: [eng({ id: 'e1', entity_id: 'c1', status: 'active', quote_id: 'q1' })],
      entityName: () => 'Client',
      quotesById: new Map([['q1', quote]]),
      operators: [
        {
          entityId: 'op1',
          clientName: 'Op',
          configError: null,
          openAlerts: 0,
          hasRuntime: true,
          recurringPrice: 1200,
        },
      ],
      now: NOW,
    })
    const consulting = rows.find((r) => r.kind === 'consulting')!
    const operator = rows.find((r) => r.kind === 'operator')!
    expect(consulting.value).toBe('$8,400')
    expect(operator.value).toBe('$1,200/mo')
  })

  it('renders an unpriced operator value as null, never fabricated', () => {
    const rows = buildServiceList({
      engagements: [],
      entityName: () => 'Client',
      quotesById: new Map(),
      operators: [
        {
          entityId: 'op1',
          clientName: 'Op',
          configError: null,
          openAlerts: 0,
          hasRuntime: true,
          recurringPrice: null,
        },
      ],
      now: NOW,
    })
    expect(rows.find((r) => r.kind === 'operator')!.value).toBeNull()
  })
})

describe('serviceListStats', () => {
  it('counts in-motion, by kind, and at-risk', () => {
    const rows = buildServiceList({
      engagements: [
        eng({ id: 'e1', entity_id: 'c1', status: 'handoff', handoff_date: '2026-06-01T00:00:00Z' }),
        eng({ id: 'e2', entity_id: 'c2', status: 'active' }),
      ],
      entityName: () => 'C',
      quotesById: new Map(),
      operators: [
        {
          entityId: 'op1',
          clientName: 'Op',
          configError: null,
          openAlerts: 1,
          hasRuntime: true,
          recurringPrice: null,
        },
      ],
      now: NOW,
    })
    const s = serviceListStats(rows)
    expect(s.inMotion).toBe(3)
    expect(s.consulting).toBe(2)
    expect(s.operator).toBe(1)
    expect(s.atRisk).toBe(2) // overdue handoff + alerting operator
  })
})
