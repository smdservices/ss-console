import { afterEach, describe, expect, it, vi } from 'vitest'
import { deepWebsiteAnalysis } from '../src/lib/enrichment/deep-website'

const VALID_ANALYSIS = {
  owner_profile: { name: 'Dana Owner', title: 'Founder', background: null },
  team: {
    size_estimate: null,
    named_employees: [{ name: 'Dana Owner', role: 'Founder' }],
    departments_visible: [],
  },
  business_profile: {
    founding_year: 2018,
    services: ['Consulting'],
    service_areas: ['Phoenix'],
    certifications: [],
    awards: [],
    partnerships: [],
  },
  customer_signals: {
    testimonials_count: 2,
    case_studies_visible: false,
    portfolio_visible: true,
    pricing_visible: false,
  },
  digital_maturity: {
    score: 6,
    reasoning: 'The site has SSL and a portfolio but no online booking.',
    online_booking: false,
    chat_widget: false,
    blog_active: false,
    ssl: true,
    mobile_friendly: true,
  },
  contact_info: {
    email: 'hello@example.com',
    phone: '555-0100',
    address: null,
    social_media: { facebook: null, instagram: null, linkedin: null },
  },
}

function installFetchMock(llmPayload: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api.anthropic.com')) {
        return new Response(
          JSON.stringify({
            content: [{ type: 'text', text: JSON.stringify(llmPayload) }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }

      if (url === 'https://example.com') {
        return new Response('<html><body>' + 'Business website '.repeat(80) + '</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }

      return new Response('not found', { status: 404 })
    })
  )
}

describe('deepWebsiteAnalysis', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns parsed analysis with analyzed page URLs for valid LLM JSON', async () => {
    installFetchMock(VALID_ANALYSIS)

    const result = await deepWebsiteAnalysis('example.com', 'anthropic-test-key')

    expect(result?.owner_profile.name).toBe('Dana Owner')
    expect(result?.pages_analyzed).toEqual(['https://example.com'])
  })

  it('rejects malformed LLM JSON before returning analysis', async () => {
    installFetchMock({
      ...VALID_ANALYSIS,
      digital_maturity: { ...VALID_ANALYSIS.digital_maturity, score: 99 },
    })

    await expect(deepWebsiteAnalysis('example.com', 'anthropic-test-key')).rejects.toThrow()
  })
})
