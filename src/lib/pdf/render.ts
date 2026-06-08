/**
 * Thin wrapper around Forme PDF rendering.
 *
 * Provides a single entry point for generating SOW PDFs from typed props.
 *
 * Cloudflare Workers can't fetch() WASM at runtime — the binary must be
 * imported at build time. We import forme_bg.wasm explicitly and pass
 * the compiled module to init() before any render call. The Astro
 * Cloudflare adapter (cloudflareModules) emits the WASM as a build
 * asset and produces a WebAssembly.Module reference.
 *
 * @see docs/spikes/forme-wasm-pdf.md — Forme spike results
 * @see src/lib/pdf/sow-template.tsx — SOW template component
 */

import { renderDocument } from '@formepdf/core'
import { init } from '@formepdf/core/browser'
import { SOWTemplate } from './sow-template'
import type { SOWTemplateProps } from './sow-template'
import { ScorecardReportTemplate } from './scorecard-template'
import type { ScorecardReportProps } from './scorecard-template'
import formeWasm from '@formepdf/core/pkg/forme_bg.wasm'

/**
 * Ensure the Forme WASM module is initialized before rendering.
 * Memoizes the init promise; resets on failure so the next call retries.
 *
 * Accepted module-scope-state exception (coding-standards.md §10, "Module-level
 * `let`/`const` for immutable init-time values only"): this is NOT request-scoped
 * state. `init(formeWasm)` binds the build-imported, immutable WebAssembly.Module
 * into the @formepdf/core glue exactly once per isolate; the result is idempotent
 * and carries no per-request data. Memoizing it here is the correct pattern —
 * re-initializing per request would re-instantiate the WASM instance on every
 * PDF render for no benefit. The promise is re-nulled ONLY on init failure so a
 * subsequent render retries a cold init rather than awaiting a permanently
 * rejected promise; it is never reassigned per request on the success path.
 */
let wasmReady: Promise<void> | null = null
function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = init(formeWasm).catch((err) => {
      wasmReady = null
      throw err
    })
  }
  return wasmReady
}

/**
 * Render a Statement of Work PDF from quote/client/contact data.
 *
 * @param props - All data needed for the SOW template (see SOWTemplateProps)
 * @returns PDF binary as Uint8Array — suitable for R2 storage or HTTP response
 */
export async function renderSow(props: SOWTemplateProps): Promise<Uint8Array> {
  await ensureWasm()
  return renderDocument(SOWTemplate(props))
}

/**
 * Render an Operations Health Scorecard report PDF.
 *
 * @param props - Scorecard results data (see ScorecardReportProps)
 * @returns PDF binary as Uint8Array — suitable for email attachment
 */
export async function renderScorecardReport(props: ScorecardReportProps): Promise<Uint8Array> {
  await ensureWasm()
  const pdf = await renderDocument(ScorecardReportTemplate(props))
  return pdf
}
