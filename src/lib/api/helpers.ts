/**
 * Shared API-route helpers.
 *
 * Canonical home for the small request/response utilities that the public
 * API routes (booking reserve, intake, intake send) previously each carried
 * as byte-identical private copies (2026-06-12 code review dedup).
 * `src/pages/api/booking/reserve-helpers.ts` re-exports these so its
 * existing import surface keeps working.
 */

export function trimString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function isValidEmail(email: string): boolean {
  if (email.length > 254) return false
  const parts = email.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (!local || !domain) return false
  if (domain.indexOf('.') === -1) return false
  return true
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
