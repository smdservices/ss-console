/**
 * Constant-time string comparison for verifying bearer secrets.
 *
 * Comparing a caller-supplied token against an expected secret with `===` leaks
 * timing information (it short-circuits at the first differing byte). This helper
 * XOR-accumulates over the full length so the comparison time does not depend on
 * how many leading bytes matched. A length mismatch returns early — the length of
 * a secret is not itself sensitive.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
