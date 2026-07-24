import { describe, it } from 'vitest'

/**
 * ADR 0069 Lock 1 — config + own-actions only; never client business data.
 * These guards activate when the workflow viewer lands (Slice 10). Named and
 * present now so the guard is visible in the spine, per the Phase-0 process
 * (pending = `.todo`, tied to its slice).
 *
 * When active they assert:
 *  - the workflow/config viewers read the config plane (customer.yaml /
 *    projection) only, never a runtime business-data surface;
 *  - no client-business-data field renders — the `matterRef`-shaped leak that
 *    ADR 0052 removed is the canonical anti-pattern;
 *  - the workflow-viewer schema and code carry NO vertical vocabulary.
 */
describe('operator legibility boundary (ADR 0069 Lock 1)', () => {
  it.todo('workflow/config viewers read the config plane only — no client business data (Slice 10)')
  it.todo('workflow-viewer schema and code carry no vertical vocabulary (Slice 10)')
})
