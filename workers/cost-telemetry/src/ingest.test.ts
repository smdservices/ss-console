import { describe, it, expect } from 'vitest'
import {
  ingestAnthropic,
  ingestComposio,
  runIngestForCustomer,
  type AnthropicSource,
  type AnthropicUsageRow,
  type ComposioSource,
  type ComposioUsageRow,
  type CustomerIngestContext,
  type D1HttpClient,
} from './ingest'
import {
  anthropicPricing,
  composioPricing,
  computeAnthropicCents,
  computeComposioCents,
} from './pricing'

class FakeD1 implements D1HttpClient {
  public calls: Array<{ databaseId: string; sql: string; params: unknown[] }> = []
  async execute(databaseId: string, sql: string, params: unknown[]): Promise<void> {
    this.calls.push({ databaseId, sql, params })
  }
}

class FakeAnthropic implements AnthropicSource {
  constructor(
    private rows: AnthropicUsageRow[],
    private error?: Error
  ) {}
  async fetchDailyUsage(): Promise<AnthropicUsageRow[]> {
    if (this.error) throw this.error
    return this.rows
  }
}

class FakeComposio implements ComposioSource {
  constructor(
    private rows: ComposioUsageRow[],
    private error?: Error
  ) {}
  async fetchDailyUsage(): Promise<ComposioUsageRow[]> {
    if (this.error) throw this.error
    return this.rows
  }
}

describe('pricing JSON shape', () => {
  it('anthropic pricing has expected models', () => {
    expect(anthropicPricing.models['claude-opus-4-7']).toBeDefined()
    expect(anthropicPricing.models['claude-opus-4-7'].input_per_million_cents).toBe(1500)
    expect(anthropicPricing.models['claude-opus-4-7'].output_per_million_cents).toBe(7500)
  })

  it('composio pricing has defaults', () => {
    expect(composioPricing.default_per_action_cents).toBeGreaterThanOrEqual(0)
    expect(typeof composioPricing.toolkit_overrides).toBe('object')
  })
})

describe('cents math', () => {
  it('computes anthropic cents from token counts', () => {
    const r = computeAnthropicCents('claude-opus-4-7', 2_000_000, 1_000_000)
    expect(r.inputCents).toBe(3000)
    expect(r.outputCents).toBe(7500)
    expect(r.warning).toBeNull()
  })

  it('returns zero cents and a warning for unknown anthropic model', () => {
    const r = computeAnthropicCents('mystery', 1_000_000, 1_000_000)
    expect(r.inputCents).toBe(0)
    expect(r.outputCents).toBe(0)
    expect(r.warning).toContain('mystery')
  })

  it('uses composio override over default', () => {
    expect(
      computeComposioCents('gmail', 10, {
        default_per_action_cents: 5,
        toolkit_overrides: { gmail: 2 },
      })
    ).toBe(20)
    expect(
      computeComposioCents('unknown', 10, {
        default_per_action_cents: 5,
        toolkit_overrides: { gmail: 2 },
      })
    ).toBe(50)
  })
})

describe('ingestAnthropic', () => {
  it('writes two rows when both token totals are positive', async () => {
    const d1 = new FakeD1()
    const src = new FakeAnthropic([
      { model: 'claude-opus-4-7', inputTokens: 1_000_000, outputTokens: 500_000 },
    ])
    const result = await ingestAnthropic(d1, 'db-1', src, 'k', '2026-05-22')
    expect(result.ok).toBe(true)
    expect(result.rowsWritten).toBe(2)
    expect(d1.calls).toHaveLength(2)
    expect(d1.calls[0].params[1]).toBe('claude_api_input_tokens')
    expect(d1.calls[1].params[1]).toBe('claude_api_output_tokens')
  })

  it('writes zero rows when token totals are zero', async () => {
    const d1 = new FakeD1()
    const src = new FakeAnthropic([])
    const result = await ingestAnthropic(d1, 'db-1', src, 'k', '2026-05-22')
    expect(result.ok).toBe(true)
    expect(result.rowsWritten).toBe(0)
    expect(d1.calls).toHaveLength(0)
  })

  it('returns ok=false when source throws', async () => {
    const d1 = new FakeD1()
    const src = new FakeAnthropic([], new Error('HTTP 503'))
    const result = await ingestAnthropic(d1, 'db-1', src, 'k', '2026-05-22')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('503')
    expect(d1.calls).toHaveLength(0)
  })
})

describe('ingestComposio', () => {
  it('writes one composio_actions row aggregating toolkits', async () => {
    const d1 = new FakeD1()
    const src = new FakeComposio([
      { toolkit: 'gmail', actionCount: 50 },
      { toolkit: 'github', actionCount: 25 },
    ])
    const result = await ingestComposio(d1, 'db-1', {
      source: src,
      apiKey: 'k',
      accountId: 'acct',
      day: '2026-05-22',
    })
    expect(result.ok).toBe(true)
    expect(result.rowsWritten).toBe(1)
    expect(d1.calls).toHaveLength(1)
    const params = d1.calls[0].params
    expect(params[1]).toBe('composio_actions')
    expect(params[3]).toBe(75) // total actions
  })

  it('returns ok=false when source throws', async () => {
    const d1 = new FakeD1()
    const src = new FakeComposio([], new Error('HTTP 500'))
    const result = await ingestComposio(d1, 'db-1', {
      source: src,
      apiKey: 'k',
      accountId: 'acct',
      day: '2026-05-22',
    })
    expect(result.ok).toBe(false)
    expect(d1.calls).toHaveLength(0)
  })
})

describe('runIngestForCustomer', () => {
  it('skips composio when not configured', async () => {
    const d1 = new FakeD1()
    const ctx: CustomerIngestContext = {
      customerSlug: 'acme',
      perCustomerDatabaseId: 'db-acme',
      anthropicApiKey: 'k',
    }
    const result = await runIngestForCustomer(
      ctx,
      d1,
      new FakeAnthropic([{ model: 'claude-opus-4-7', inputTokens: 100, outputTokens: 200 }]),
      new FakeComposio([{ toolkit: 'gmail', actionCount: 50 }]),
      '2026-05-22'
    )
    const sourceNames = result.sources.map((s) => s.source)
    expect(sourceNames).toContain('anthropic_billing')
    expect(sourceNames).not.toContain('composio_usage')
  })

  it('anthropic failure does not block composio', async () => {
    const d1 = new FakeD1()
    const ctx: CustomerIngestContext = {
      customerSlug: 'acme',
      perCustomerDatabaseId: 'db-acme',
      anthropicApiKey: 'k',
      composioApiKey: 'ck',
      composioAccountId: 'acct-1',
    }
    const result = await runIngestForCustomer(
      ctx,
      d1,
      new FakeAnthropic([], new Error('HTTP 503')),
      new FakeComposio([{ toolkit: 'gmail', actionCount: 100 }]),
      '2026-05-22'
    )
    const byName = Object.fromEntries(result.sources.map((s) => [s.source, s]))
    expect(byName.anthropic_billing.ok).toBe(false)
    expect(byName.composio_usage.ok).toBe(true)
    expect(byName.composio_usage.rowsWritten).toBe(1)
    expect(result.anyFailures).toBe(true)
  })
})
