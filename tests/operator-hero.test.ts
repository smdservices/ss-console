import { describe, it, expect } from 'vitest'
import { resolveOperatorHero } from '../src/lib/portal/operator/facets/identity/hero'
import type { CustomerConfigRow, PersonaConfig } from '../src/lib/portal/customer-config'
import type { AlivenessSignal } from '../src/lib/portal/operator/aliveness'

/** Minimal persona fixture — only the fields the hero reads matter. */
function persona(p: Partial<PersonaConfig>): PersonaConfig {
  return {
    slug: 'p',
    status: 'active',
    name: 'X',
    title: null,
    signature_html: null,
    tone: [],
    send_as: null,
    entitlements: {} as PersonaConfig['entitlements'],
    skills: [],
    channel_bindings: [],
    ...p,
  }
}

function config(personas: PersonaConfig[]): CustomerConfigRow {
  return { personas } as unknown as CustomerConfigRow
}

const signal: AlivenessSignal = {
  level: 'idle',
  lastActionAt: '2026-07-07T00:00:00Z',
  currentSkill: null,
  stickyStopReason: null,
}

describe('resolveOperatorHero (ADR 0069 Slice 2 — identity + status)', () => {
  it('surfaces the active persona name + title, passing the signal through', () => {
    const m = resolveOperatorHero(
      config([persona({ status: 'active', name: 'Avery', title: 'AI Case Coordinator' })]),
      signal
    )
    expect(m).toEqual({
      name: 'Avery',
      title: 'AI Case Coordinator',
      tone: [],
      sendAs: null,
      alsoOperatesAs: [],
      aliveness: signal,
    })
  })

  it('ignores archived personas — no fabricated identity', () => {
    const m = resolveOperatorHero(
      config([persona({ status: 'archived', name: 'Old', title: 'stale' })]),
      null
    )
    expect(m.name).toBeNull()
    expect(m.title).toBeNull()
  })

  it('null config yields null identity but still carries the signal (honest empty)', () => {
    const m = resolveOperatorHero(null, signal)
    expect(m).toEqual({
      name: null,
      title: null,
      tone: [],
      sendAs: null,
      alsoOperatesAs: [],
      aliveness: signal,
    })
  })

  it('an active persona with no title yields a null title (component falls back)', () => {
    const m = resolveOperatorHero(
      config([persona({ status: 'active', name: 'Crane', title: null })]),
      null
    )
    expect(m.name).toBe('Crane')
    expect(m.title).toBeNull()
  })

  it('humanizes authored tone descriptors for display (dashes to spaces, order kept)', () => {
    const m = resolveOperatorHero(
      config([persona({ tone: ['plainspoken', 'warm-but-professional', 'concise'] })]),
      null
    )
    expect(m.tone).toEqual(['plainspoken', 'warm but professional', 'concise'])
  })

  it('carries the authored send-as identity verbatim, null when unauthored', () => {
    const withSendAs = resolveOperatorHero(
      config([persona({ send_as: { agentmail_identity: 'ops@firm.example' } })]),
      null
    )
    expect(withSendAs.sendAs).toBe('ops@firm.example')
    expect(resolveOperatorHero(config([persona({})]), null).sendAs).toBeNull()
  })

  it('lists OTHER active personas as also-operates-as (ADR 0011); archived never appear', () => {
    const m = resolveOperatorHero(
      config([
        persona({ slug: 'a', name: 'Crane', title: 'Coordinator' }),
        persona({ slug: 'b', name: 'Ledger', title: 'Bookkeeper' }),
        persona({ slug: 'c', status: 'archived', name: 'Old' }),
      ]),
      null
    )
    expect(m.name).toBe('Crane')
    expect(m.alsoOperatesAs).toEqual([{ name: 'Ledger', title: 'Bookkeeper' }])
  })

  it('single-persona seats have an empty also-operates-as (the line never renders)', () => {
    const m = resolveOperatorHero(config([persona({ name: 'Crane' })]), null)
    expect(m.alsoOperatesAs).toEqual([])
  })
})
