/**
 * Tests for the operator change-request team notification email
 * (src/lib/email/operator-templates.ts). The filing endpoint fires this to
 * team@ so a request never again sits unnoticed in the admin inbox (the
 * 2026-06-23 request went unseen for three weeks because filing was silent).
 */

import { describe, it, expect } from 'vitest'
import { operatorChangeRequestNotificationEmailHtml } from '../src/lib/email/operator-templates'

const input = {
  entityName: 'Ashton & Price LLP',
  customerSlug: 'ashton-price',
  domainLabel: 'Trust & autonomy',
  requestedByEmail: 'christa@ashtonprice.com',
  summary: 'Please let it send intake confirmations on its own.',
  adminInboxUrl: 'https://admin.smd.services/admin/operator/requests',
}

describe('operatorChangeRequestNotificationEmailHtml', () => {
  it('carries every fact the inbox triage needs', () => {
    const html = operatorChangeRequestNotificationEmailHtml(input)
    expect(html).toContain('Ashton &amp; Price LLP')
    expect(html).toContain('ashton-price')
    expect(html).toContain('Trust &amp; autonomy')
    expect(html).toContain('christa@ashtonprice.com')
    expect(html).toContain('Please let it send intake confirmations on its own.')
    expect(html).toContain('https://admin.smd.services/admin/operator/requests')
  })

  it('escapes client-authored request text', () => {
    const html = operatorChangeRequestNotificationEmailHtml({
      ...input,
      summary: '<script>alert(1)</script> & more',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more')
  })
})
