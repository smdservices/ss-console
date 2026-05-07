/**
 * Arizona Registrar of Contractors (ROC) license lookup.
 * Only for trades businesses (home_services, contractor_trades).
 * Returns license status, classification, complaint history.
 *
 * Note: Government HTML scraping — build with graceful failure.
 */

export interface RocEnrichment {
  license_number: string | null
  classification: string | null
  status: string | null
  business_name: string
  complaint_count: number | null
}

const ROC_SEARCH_URL = 'https://roc.az.gov/contractor-search'

function matchTrim(html: string, pattern: RegExp): string | null {
  const m = html.match(pattern)
  return m?.[1]?.trim() ?? null
}

/** Parse ROC HTML search results into a structured result. */
function parseRocHtml(html: string, businessName: string): RocEnrichment | null {
  const licenseNumber = matchTrim(html, /License\s*#?\s*:?\s*(\w+)/i)
  const businessNameMatch = matchTrim(html, /Business\s*Name[^:]*:\s*([^<\n]+)/i)

  if (!licenseNumber && !businessNameMatch) return null

  const complaintMatch = html.match(/Complaints?\s*:?\s*(\d+)/i)

  return {
    license_number: licenseNumber,
    classification: matchTrim(html, /Classification[^:]*:\s*([^<\n]+)/i),
    status: matchTrim(html, /Status[^:]*:\s*([^<\n]+)/i),
    business_name: businessNameMatch ?? businessName,
    complaint_count: complaintMatch ? parseInt(complaintMatch[1]) : null,
  }
}

/**
 * Search Arizona ROC for a contractor license by business name.
 * Returns first matching result, or null.
 */
export async function lookupRoc(businessName: string): Promise<RocEnrichment | null> {
  const params = new URLSearchParams({
    company_name: businessName.replace(/\b(llc|inc|corp|ltd)\b\.?/gi, '').trim(),
  })

  const response = await fetch(`${ROC_SEARCH_URL}?${params.toString()}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) return null

  const html = await response.text()
  return parseRocHtml(html, businessName)
}
