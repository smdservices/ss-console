import { describe, expect, it } from 'vitest'
import { extractEmailDomain, domainAllowed } from '../src/lib/operator/mcp/jit-grant'

describe('extractEmailDomain', () => {
  it('returns the lowercased host after a single @', () => {
    expect(extractEmailDomain('Bob@Firm.com')).toBe('firm.com')
    expect(extractEmailDomain('a.b+tag@partners.firm.com')).toBe('partners.firm.com')
  })

  it('fails closed on malformed addresses', () => {
    expect(extractEmailDomain('no-at-sign')).toBeNull()
    expect(extractEmailDomain('@firm.com')).toBeNull() // empty local part
    expect(extractEmailDomain('a@b@firm.com')).toBeNull() // more than one @
    expect(extractEmailDomain('bob@')).toBeNull() // empty domain
  })
})

describe('domainAllowed (exact host, no implicit subdomain)', () => {
  const allowed = ['firm.com', 'partners.firm.com']

  it('admits an exact firm-domain match', () => {
    expect(domainAllowed('bob@firm.com', allowed)).toBe(true)
    expect(domainAllowed('BOB@Firm.com', allowed)).toBe(true)
    expect(domainAllowed('p@partners.firm.com', allowed)).toBe(true)
  })

  it('rejects look-alikes, unauthored subdomains, and malformed addresses', () => {
    expect(domainAllowed('evil@notfirm.com', allowed)).toBe(false)
    expect(domainAllowed('evil@firm.com.attacker.net', allowed)).toBe(false)
    expect(domainAllowed('x@mail.firm.com', allowed)).toBe(false) // subdomain not authored
    expect(domainAllowed('x@a@firm.com', allowed)).toBe(false) // double @
    expect(domainAllowed('junk', allowed)).toBe(false)
  })
})
