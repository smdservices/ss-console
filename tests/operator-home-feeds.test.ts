import { describe, it, expect } from 'vitest'
import { loadHomeFeeds } from '../src/lib/portal/operator/home'

describe('loadHomeFeeds', () => {
  it('returns honest empty feeds when the runtime read path is not wired', () => {
    const feeds = loadHomeFeeds({})
    expect(feeds.runtimeConfigured).toBe(false)
    expect(feeds.recentActivity).toEqual([])
    expect(feeds.escalations).toEqual([])
  })

  it('never fabricates a review queue: needsAttentionCount is 0 (ADR 0035)', () => {
    expect(loadHomeFeeds({}).needsAttentionCount).toBe(0)
    expect(
      loadHomeFeeds({ OPERATOR_RUNTIME_READ_URL: 'https://example.invalid' }).needsAttentionCount
    ).toBe(0)
  })

  it('reflects whether the runtime read path is configured', () => {
    expect(loadHomeFeeds({}).runtimeConfigured).toBe(false)
    expect(loadHomeFeeds({ OPERATOR_RUNTIME_READ_URL: '' }).runtimeConfigured).toBe(false)
    // Both the host template and the master secret are required now (ADR 0043 A).
    expect(
      loadHomeFeeds({ OPERATOR_RUNTIME_READ_URL: 'https://hermes-x.fly.dev' }).runtimeConfigured
    ).toBe(false)
    expect(
      loadHomeFeeds({
        OPERATOR_RUNTIME_READ_URL: 'https://hermes-x.fly.dev',
        OPERATOR_RUNTIME_READ_SECRET: 'm',
      }).runtimeConfigured
    ).toBe(true)
  })
})
