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
      config([persona({ status: 'active', name: 'Quinn', title: 'AI Case Coordinator' })]),
      signal
    )
    expect(m).toEqual({ name: 'Quinn', title: 'AI Case Coordinator', aliveness: signal })
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
    expect(m).toEqual({ name: null, title: null, aliveness: signal })
  })

  it('an active persona with no title yields a null title (component falls back)', () => {
    const m = resolveOperatorHero(
      config([persona({ status: 'active', name: 'Crane', title: null })]),
      null
    )
    expect(m.name).toBe('Crane')
    expect(m.title).toBeNull()
  })
})
