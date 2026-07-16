/**
 * Show-once flash for the change-request outcome (Captain, 2026-07-15: the
 * `?cr=filed` banner rode the URL and kept announcing itself on every reload).
 * The filing endpoint sets a short-lived cookie instead of a query param; the
 * surface reads it exactly once (read + delete in the same render), so the
 * banner appears on the redirect-back and is gone on the next navigation or
 * refresh. Pure post-redirect-get flash; no client JS.
 */

import type { AstroCookies } from 'astro'

export const CR_FLASH_COOKIE = 'ss_cr_flash'

export type ChangeRequestFlash = 'filed' | 'invalid' | 'error'

/** Set-Cookie header value for the filing endpoint's redirect response. */
export function changeRequestFlashCookie(status: ChangeRequestFlash): string {
  return `${CR_FLASH_COOKIE}=${status}; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax`
}

/** Read and consume the flash. Returns null when none is pending. */
export function readChangeRequestFlash(cookies: AstroCookies): ChangeRequestFlash | null {
  const value = cookies.get(CR_FLASH_COOKIE)?.value ?? null
  if (value === null) return null
  cookies.delete(CR_FLASH_COOKIE, { path: '/' })
  return value === 'filed' || value === 'invalid' || value === 'error' ? value : null
}
