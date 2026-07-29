/**
 * Runtime-AC proof parser: the merge gate behind Law 9.
 *
 * Why this exists (2026-07-28, the entitlement-control incident). Four PRs each
 * defined "done" as the artifact it added. Each was individually honest; one
 * even wrote "Next slices, unbuilt and not implied here." The artifacts summed
 * to less than the feature, the epic closed green, and a real client could not
 * perform the act.
 *
 * The CI chain made that outcome look certified. tick-acs-on-merge parses the
 * MERGING PR's own "Acceptance criteria status" table, ticks every row the PR
 * marked `met` on the linked issue, and unmet-ac-on-close explicitly skips
 * PR-driven closes. So the author declares its slice met, CI ticks the epic,
 * the epic closes. The system certifies the author's own definition of done.
 *
 * This gate narrows what a PR is allowed to self-certify. An AC tagged
 * `(runtime)` describes a gate on a live layer (D1, R2, the Fly volume, the
 * running Machine, monitoring, external records). Marking one `met` now
 * requires a crane_verify ID in the Evidence column: an observation of the
 * running system, not a file:line pointing at code that would work once
 * configured.
 *
 * Repo-layer ACs are untouched. A file:line is the right evidence for those,
 * and gating them would be ceremony.
 *
 * @see docs/doctrine/wired-contract.md - the contract that authors the tags
 * @see docs/doctrine/agent-operating-doctrine.md - Law 9
 */

/** Section whose table the AC-tick workflow already parses. Same anchor. */
const SECTION_RE = /^##\s+Acceptance criteria status\s*$/im

/**
 * crane_verify returns `vfy_` + a 26-char ULID (Crockford base32). Matched
 * loosely on length rather than the exact alphabet: a near-miss ID should read
 * as a typo to fix, not slip through as "no ID present".
 */
const VERIFY_ID_RE = /\bvfy_[0-9A-Za-z]{20,}\b/

/** Layer tag authored per the reachability contract into the issue's ACs, carried verbatim into the PR table. */
const RUNTIME_TAG_RE = /\(\s*runtime[^)]*\)/i

/** A markdown table separator: cells of dashes and optional alignment colons. */
const SEPARATOR_CELL_RE = /^:?-{2,}:?$/

/**
 * The template's own placeholder row ships in every PR body until edited. Its
 * status cell enumerates the options rather than picking one, which is how it
 * is told apart from a real row.
 */
const TEMPLATE_STATUS_RE = /\//

/**
 * Split one markdown table row into trimmed cells.
 * @param {string} line
 * @returns {string[]}
 */
function cells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((c) => c.trim())
}

/**
 * Extract the "Acceptance criteria status" section body from a PR description.
 * Returns '' when the section is absent.
 * @param {string} body
 * @returns {string}
 */
export function extractAcSection(body) {
  const lines = String(body ?? '').split('\n')
  const start = lines.findIndex((l) => SECTION_RE.test(l))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^##\s+/.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/**
 * Find runtime-tagged ACs that a PR marks `met` without a crane_verify ID.
 *
 * Deliberately silent when there is no AC table at all: the PR template and
 * review own that, and duplicating the check here would fail chore PRs that
 * legitimately carry no ACs.
 *
 * @param {string} body - the pull request description
 * @returns {{ ac: string, status: string, evidence: string }[]} violations, in table order
 */
export function findUnprovenRuntimeAcs(body) {
  const section = extractAcSection(body)
  if (!section) return []

  const violations = []
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cols = cells(line)
    if (cols.length < 3) continue

    const [ac, status, evidence] = cols

    // Header, separator, and the untouched template row are not claims.
    if (cols.every((c) => SEPARATOR_CELL_RE.test(c) || c === '')) continue
    if (/^ac\b/i.test(ac) && /status/i.test(status)) continue
    if (TEMPLATE_STATUS_RE.test(status)) continue

    if (status.toLowerCase() !== 'met') continue
    if (!RUNTIME_TAG_RE.test(ac)) continue
    if (VERIFY_ID_RE.test(evidence)) continue

    violations.push({ ac, status, evidence })
  }
  return violations
}

/**
 * Human-readable failure text for the workflow annotation.
 * @param {{ ac: string, evidence: string }[]} violations
 * @returns {string}
 */
export function formatViolations(violations) {
  const rows = violations
    .map((v) => `  - ${v.ac}\n      evidence given: ${v.evidence || '(empty)'}`)
    .join('\n')
  return [
    `${violations.length} runtime AC(s) marked "met" without a crane_verify ID:`,
    rows,
    '',
    'A (runtime) AC is a gate on a live layer: D1, R2, the Fly volume, the running',
    'Machine, monitoring, or an external record. Marking it met means someone',
    'performed the act on the real deployment and observed the far end change.',
    '',
    'Record that observation with crane_verify and put the returned vfy_... ID in',
    'the Evidence column. If the gate is not actually closed, mark the AC deferred',
    'and say which gate is open, per docs/doctrine/wired-contract.md.',
  ].join('\n')
}
