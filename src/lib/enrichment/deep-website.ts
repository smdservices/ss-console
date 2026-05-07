/**
 * Deep website analysis using Claude Sonnet for extractive website facts.
 * Fetches homepage + discoverable subpages, extracts observable business data.
 */

import { ModuleError } from './instrument'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 2048

const DEEP_ANALYSIS_PROMPT = `You are extracting observable facts from a small business website. Use only information explicitly supported by the supplied pages. Do not infer owner personality, company trajectory, internal capacity, hidden tooling, or unstated operational problems. Use null, false, or [] when the site does not support a field. Return ONLY valid JSON:

{
  "owner_profile": {
    "name": "string or null",
    "title": "string or null",
    "background": "string or null — only if bio, education, or career history is explicitly stated"
  },
  "team": {
    "size_estimate": "number or null — only when the site explicitly states a headcount or shows a complete named team",
    "named_employees": ["array of {name, role} objects"],
    "departments_visible": ["array of department names"]
  },
  "business_profile": {
    "founding_year": "number or null",
    "services": ["array of services"],
    "service_areas": ["array of geographic areas served"],
    "certifications": ["array of certifications/licenses mentioned"],
    "awards": ["array of awards/recognition"],
    "partnerships": ["array of partner/affiliate mentions"]
  },
  "customer_signals": {
    "testimonials_count": "number",
    "case_studies_visible": "boolean",
    "portfolio_visible": "boolean",
    "pricing_visible": "boolean"
  },
  "digital_maturity": {
    "score": "1-10 integer based only on visible website features",
    "reasoning": "1 sentence citing the visible website features behind the score",
    "online_booking": "boolean",
    "chat_widget": "boolean",
    "blog_active": "boolean — true if blog has posts within last 6 months",
    "ssl": "boolean",
    "mobile_friendly": "boolean"
  },
  "contact_info": {
    "email": "string or null",
    "phone": "string or null",
    "address": "string or null",
    "social_media": {"facebook": "url or null", "instagram": "url or null", "linkedin": "url or null"}
  }
}`

export interface DeepWebsiteAnalysis {
  owner_profile: { name: string | null; title: string | null; background: string | null }
  team: {
    size_estimate: number | null
    named_employees: Array<{ name: string; role: string }>
    departments_visible: string[]
  }
  business_profile: {
    founding_year: number | null
    services: string[]
    service_areas: string[]
    certifications: string[]
    awards: string[]
    partnerships: string[]
  }
  customer_signals: {
    testimonials_count: number
    case_studies_visible: boolean
    portfolio_visible: boolean
    pricing_visible: boolean
  }
  digital_maturity: {
    score: number
    reasoning: string
    online_booking: boolean
    chat_widget: boolean
    blog_active: boolean
    ssl: boolean
    mobile_friendly: boolean
  }
  contact_info: {
    email: string | null
    phone: string | null
    address: string | null
    social_media: { facebook: string | null; instagram: string | null; linkedin: string | null }
  }
  pages_analyzed: string[]
}

export async function deepWebsiteAnalysis(
  websiteUrl: string,
  anthropicKey: string
): Promise<DeepWebsiteAnalysis | null> {
  const baseUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  const pages: { url: string; html: string }[] = []

  // Fetch homepage first
  const homepage = await safeFetch(baseUrl)
  if (!homepage) return null
  pages.push({ url: baseUrl, html: homepage })

  // Discover and fetch subpages
  const subpaths = [
    '/about',
    '/about-us',
    '/our-team',
    '/team',
    '/staff',
    '/services',
    '/contact',
    '/contact-us',
    '/careers',
    '/jobs',
    '/testimonials',
    '/reviews',
    '/blog',
    '/portfolio',
    '/gallery',
  ]

  for (const path of subpaths) {
    if (pages.length >= 8) break // Cap at 8 pages to manage tokens
    const html = await safeFetch(`${baseUrl}${path}`)
    if (html && html.length > 500) {
      pages.push({ url: `${baseUrl}${path}`, html })
    }
  }

  // Clean and combine
  const combined = pages.map((p) => `=== ${p.url} ===\n${cleanHtml(p.html)}`).join('\n\n')
  const truncated = combined.slice(0, 50_000) // Larger budget for Sonnet

  // No outer try/catch: errors propagate to the instrumentation wrapper in
  // src/lib/enrichment/index.ts which classifies them (parse_error,
  // fetch_failed, etc.) and persists a failure row in enrichment_runs.
  // Returning null here means "API ran cleanly but had no useful data"
  // (recorded as `no_data`); throws mean "something broke" (recorded as
  // `failed` with classified kind).
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: DEEP_ANALYSIS_PROMPT,
      messages: [{ role: 'user', content: `Analyze this business website:\n\n${truncated}` }],
    }),
  })

  if (!response.ok) {
    // Issue #631 follow-up: surface Anthropic errors as failed runs.
    // The per-page safeFetch below intentionally returns null on per-page
    // 404s — that's separate. This is the Claude API call.
    const body = await response.text().catch(() => '')
    throw new ModuleError(
      'api_error',
      `Anthropic API returned ${response.status}: ${body.slice(0, 500)}`
    )
  }

  const result: { content?: Array<{ type: string; text?: string }> } = await response.json()
  let text = result?.content?.find((b) => b.type === 'text')?.text?.trim()
  if (!text) return null
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

  const parsed = JSON.parse(text)
  return { ...parsed, pages_analyzed: pages.map((p) => p.url) }
}

async function safeFetch(url: string): Promise<string | null> {
  // Per-page best-effort within deep_website. Returning null for one page
  // is normal (404 on /careers, etc.) and must not poison the whole module.
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SMDBot/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    const ct = response.headers.get('content-type') ?? ''
    if (!ct.includes('text/html')) return null
    return await response.text()
  } catch {
    return null
  }
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatDeepWebsite(analysis: DeepWebsiteAnalysis): string {
  const parts: string[] = ['Deep website analysis:']
  if (analysis.owner_profile.name)
    parts.push(`Owner: ${analysis.owner_profile.name} (${analysis.owner_profile.title ?? 'owner'})`)
  if (analysis.owner_profile.background)
    parts.push(`Background: ${analysis.owner_profile.background}`)
  if (analysis.team.named_employees.length > 0)
    parts.push(
      `Named staff: ${analysis.team.named_employees.map((e) => `${e.name} (${e.role})`).join(', ')}`
    )
  if (analysis.business_profile.services.length > 0)
    parts.push(`Services: ${analysis.business_profile.services.join(', ')}`)
  if (analysis.business_profile.service_areas.length > 0)
    parts.push(`Service areas: ${analysis.business_profile.service_areas.join(', ')}`)
  if (analysis.business_profile.certifications.length > 0)
    parts.push(`Certifications: ${analysis.business_profile.certifications.join(', ')}`)
  if (analysis.business_profile.awards.length > 0)
    parts.push(`Awards: ${analysis.business_profile.awards.join(', ')}`)
  if (analysis.business_profile.partnerships.length > 0)
    parts.push(`Partnerships: ${analysis.business_profile.partnerships.join(', ')}`)
  if (analysis.contact_info.email) parts.push(`Email: ${analysis.contact_info.email}`)
  if (analysis.contact_info.phone) parts.push(`Phone: ${analysis.contact_info.phone}`)
  if (analysis.contact_info.address) parts.push(`Address: ${analysis.contact_info.address}`)
  return parts.join('\n')
}
