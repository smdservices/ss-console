/**
 * Canonical enum of structured "lost" reasons for entity stage transitions.
 *
 * Shared between:
 * - The per-entity dismiss / stage-change flow
 * - The bulk entity action endpoint (issue #463)
 * - Future Lost tab filter + reason-chip UI (issue #477)
 *
 * When #477 lands the filterable Lost tab it will extend this module with
 * querying helpers. The enum values themselves are the contract — do NOT
 * invent a second list elsewhere.
 */

export type LostReason =
  | 'not-a-fit'
  | 'no-budget'
  | 'no-response'
  | 'declined-quote'
  | 'unreachable'
  | 'wrong-contact'
  | 'other'

export const LOST_REASONS: { value: LostReason; label: string }[] = [
  { value: 'not-a-fit', label: 'Not a fit' },
  { value: 'no-budget', label: 'No budget' },
  { value: 'no-response', label: 'No response' },
  { value: 'declined-quote', label: 'Declined quote' },
  { value: 'unreachable', label: 'Unreachable' },
  { value: 'wrong-contact', label: 'Wrong contact' },
  { value: 'other', label: 'Other' },
]

const LOST_REASON_SET = new Set<string>(LOST_REASONS.map((r) => r.value))

export function isLostReason(value: unknown): value is LostReason {
  return typeof value === 'string' && LOST_REASON_SET.has(value)
}

export function labelForLostReason(value: LostReason): string {
  return LOST_REASONS.find((r) => r.value === value)?.label ?? value
}
