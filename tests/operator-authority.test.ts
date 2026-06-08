/**
 * Tests for the frozen authority-posture contract
 * (src/lib/operator/authority.ts) — ADR 0041.
 *
 * This is the Layer-1 keystone both portals import: it resolves, per client
 * per domain, whether the client org may operate a domain (`client`) or only
 * SMD does (`managed`). The two invariants under test are the ones the design
 * never bends: launch-safe by construction (absent/unconfigured → managed for
 * every domain) and read-everywhere-but-cost.
 */

import { describe, it, expect } from 'vitest'
import {
  ALL_AUTHORITY_DOMAINS,
  DEFAULT_AUTHORITY_POSTURE,
  SMD_ONLY_AUTHORITY_DOMAINS,
  SWITCHABLE_AUTHORITY_DOMAINS,
  canClientRead,
  isClientOperable,
  isSwitchableDomain,
  parseAuthorityPosture,
  resolveAllDomains,
  resolveDomainAuthority,
  type AuthorityPosture,
} from '../src/lib/operator/authority'

describe('authority domains', () => {
  it('switchable and SMD-only domains are disjoint', () => {
    const overlap = SWITCHABLE_AUTHORITY_DOMAINS.filter((d) =>
      (SMD_ONLY_AUTHORITY_DOMAINS as readonly string[]).includes(d)
    )
    expect(overlap).toEqual([])
  })

  it('ALL_AUTHORITY_DOMAINS is the union of both sets', () => {
    expect(ALL_AUTHORITY_DOMAINS.length).toBe(
      SWITCHABLE_AUTHORITY_DOMAINS.length + SMD_ONLY_AUTHORITY_DOMAINS.length
    )
  })

  it('cost and provisioning are SMD-only, never switchable', () => {
    expect(isSwitchableDomain('cost')).toBe(false)
    expect(isSwitchableDomain('provisioning')).toBe(false)
    expect(isSwitchableDomain('people_access')).toBe(true)
  })
})

describe('resolveDomainAuthority', () => {
  it('a null posture resolves every switchable domain to managed (launch-safe)', () => {
    for (const domain of SWITCHABLE_AUTHORITY_DOMAINS) {
      expect(resolveDomainAuthority(null, domain)).toBe('managed')
    }
  })

  it('default managed resolves to managed with no overrides', () => {
    const posture: AuthorityPosture = { default: 'managed', overrides: {} }
    expect(resolveDomainAuthority(posture, 'connectors')).toBe('managed')
  })

  it('an override wins over the managed default', () => {
    const posture: AuthorityPosture = {
      default: 'managed',
      overrides: { people_access: 'client' },
    }
    expect(resolveDomainAuthority(posture, 'people_access')).toBe('client')
    expect(resolveDomainAuthority(posture, 'connectors')).toBe('managed')
  })

  it('default self_managed resolves switchable domains to client', () => {
    const posture: AuthorityPosture = { default: 'self_managed', overrides: {} }
    expect(resolveDomainAuthority(posture, 'connectors')).toBe('client')
  })

  it('an override pins a domain back to managed under self_managed', () => {
    const posture: AuthorityPosture = {
      default: 'self_managed',
      overrides: { connectors: 'managed' },
    }
    expect(resolveDomainAuthority(posture, 'connectors')).toBe('managed')
    expect(resolveDomainAuthority(posture, 'people_access')).toBe('client')
  })
})

describe('resolveAllDomains', () => {
  it('returns one entry per switchable domain', () => {
    const map = resolveAllDomains(DEFAULT_AUTHORITY_POSTURE)
    expect(Object.keys(map).sort()).toEqual([...SWITCHABLE_AUTHORITY_DOMAINS].sort())
  })

  it('reflects a mixed (co-managed) posture', () => {
    const posture: AuthorityPosture = {
      default: 'managed',
      overrides: { people_access: 'client', memory: 'client' },
    }
    const map = resolveAllDomains(posture)
    expect(map.people_access).toBe('client')
    expect(map.memory).toBe('client')
    expect(map.connectors).toBe('managed')
  })
})

describe('isClientOperable', () => {
  it('is false for SMD-only domains regardless of posture', () => {
    const selfManaged: AuthorityPosture = { default: 'self_managed', overrides: {} }
    expect(isClientOperable(selfManaged, 'cost')).toBe(false)
    expect(isClientOperable(selfManaged, 'provisioning')).toBe(false)
  })

  it('tracks the resolved switch for switchable domains', () => {
    const posture: AuthorityPosture = {
      default: 'managed',
      overrides: { connectors: 'client' },
    }
    expect(isClientOperable(posture, 'connectors')).toBe(true)
    expect(isClientOperable(posture, 'people_access')).toBe(false)
  })

  it('is false for every domain under a null posture', () => {
    for (const domain of ALL_AUTHORITY_DOMAINS) {
      expect(isClientOperable(null, domain)).toBe(false)
    }
  })
})

describe('canClientRead', () => {
  it('is true for every domain except cost', () => {
    for (const domain of ALL_AUTHORITY_DOMAINS) {
      expect(canClientRead(domain)).toBe(domain !== 'cost')
    }
  })
})

describe('parseAuthorityPosture (fail-safe projection parse)', () => {
  it('null/undefined/non-object resolves to the launch default', () => {
    expect(parseAuthorityPosture(null)).toEqual(DEFAULT_AUTHORITY_POSTURE)
    expect(parseAuthorityPosture(undefined)).toEqual(DEFAULT_AUTHORITY_POSTURE)
    expect(parseAuthorityPosture('managed')).toEqual(DEFAULT_AUTHORITY_POSTURE)
    expect(parseAuthorityPosture([])).toEqual(DEFAULT_AUTHORITY_POSTURE)
  })

  it('round-trips a well-formed posture', () => {
    const raw = { default: 'self_managed', overrides: { connectors: 'managed' } }
    expect(parseAuthorityPosture(raw)).toEqual({
      default: 'self_managed',
      overrides: { connectors: 'managed' },
    })
  })

  it('drops unknown override keys and values rather than throwing', () => {
    const raw = {
      default: 'managed',
      overrides: { people_access: 'client', cost: 'client', bogus: 'client', connectors: 'smd' },
    }
    const parsed = parseAuthorityPosture(raw)
    expect(parsed.overrides).toEqual({ people_access: 'client' })
  })

  it('coerces an unknown default to managed', () => {
    expect(parseAuthorityPosture({ default: 'whatever' }).default).toBe('managed')
  })
})
