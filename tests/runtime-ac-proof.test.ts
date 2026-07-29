/**
 * Unit coverage for the Law 9 merge gate (scripts/runtime-ac-proof.mjs).
 *
 * The gate's whole job is to be harder to satisfy than a self-declaration, so
 * the tests that matter are the ones proving it cannot be walked past: a
 * runtime AC marked met with a file:line must fail, and the template's own
 * placeholder row must not fail an otherwise-clean PR.
 *
 * @see docs/doctrine/agent-operating-doctrine.md - Law 9
 * @see .claude/commands/wired.md
 */
import { describe, it, expect } from 'vitest'
import {
  findUnprovenRuntimeAcs,
  extractAcSection,
  formatViolations,
} from '../scripts/runtime-ac-proof.mjs'

const VERIFY_ID = 'vfy_01KYNVJ4VG90G26SZSYPXF05KY'

function pr(rows: string): string {
  return [
    '## Summary',
    'Something changed.',
    '',
    '## Acceptance criteria status',
    '',
    '| AC (verbatim from issue) | Status | Evidence |',
    '| ------------------------ | ------ | -------- |',
    rows,
    '',
    '## Test plan',
    '- [ ] `npm run verify` passes',
  ].join('\n')
}

describe('runtime AC proof: the gate blocks self-certification', () => {
  it('fails a runtime AC marked met with only a file:line', () => {
    const body = pr(
      '| (runtime) Operator adopts the new level | met | src/lib/entitlements.ts:42 |'
    )
    const violations = findUnprovenRuntimeAcs(body)
    expect(violations).toHaveLength(1)
    expect(violations[0].ac).toContain('Operator adopts')
  })

  it('fails a runtime AC marked met with empty evidence', () => {
    const body = pr('| (runtime) Secret deployed to the seat | met |  |')
    expect(findUnprovenRuntimeAcs(body)).toHaveLength(1)
  })

  it('passes a runtime AC backed by a crane_verify ID', () => {
    const body = pr(`| (runtime) Operator adopts the new level | met | ${VERIFY_ID} |`)
    expect(findUnprovenRuntimeAcs(body)).toEqual([])
  })

  it('passes when the ID sits in prose alongside other evidence', () => {
    const body = pr(
      `| (runtime) Level raised as the client | met | raised on ashton-price seat, ${VERIFY_ID} |`
    )
    expect(findUnprovenRuntimeAcs(body)).toEqual([])
  })

  it('rejects a malformed ID rather than reading it as absent-but-fine', () => {
    const body = pr('| (runtime) Operator adopts the new level | met | vfy_short |')
    expect(findUnprovenRuntimeAcs(body)).toHaveLength(1)
  })

  it('flags every unproven runtime row, not just the first', () => {
    const body = pr(
      [
        '| (runtime) Role granted on the seat | met | config.yaml:8 |',
        `| (runtime) Transport reachable | met | ${VERIFY_ID} |`,
        '| (runtime) Machine adopts config | met | see PR #2019 |',
      ].join('\n')
    )
    expect(findUnprovenRuntimeAcs(body)).toHaveLength(2)
  })
})

describe('runtime AC proof: what it deliberately leaves alone', () => {
  it('ignores repo-layer ACs, where a file:line is the right evidence', () => {
    const body = pr(
      '| (repo) Control renders for the admin role | met | src/pages/portal/x.astro:12 |'
    )
    expect(findUnprovenRuntimeAcs(body)).toEqual([])
  })

  it('ignores untagged ACs, so pre-contract issues are not retroactively blocked', () => {
    const body = pr('| Legacy AC written before /wired existed | met | src/lib/thing.ts:3 |')
    expect(findUnprovenRuntimeAcs(body)).toEqual([])
  })

  it('ignores a runtime AC that is deferred rather than claimed', () => {
    const body = pr('| (runtime) Machine adopts config | deferred | tracked in #2044 |')
    expect(findUnprovenRuntimeAcs(body)).toEqual([])
  })

  it('ignores a runtime AC marked n/a', () => {
    const body = pr('| (runtime) Monitoring field emitted | n/a | no monitoring surface here |')
    expect(findUnprovenRuntimeAcs(body)).toEqual([])
  })

  it('ignores the untouched template placeholder row', () => {
    const body = pr('|  | met / deferred / n/a | commit / file:line / explanation |')
    expect(findUnprovenRuntimeAcs(body)).toEqual([])
  })

  it('stays silent on a PR with no AC section at all (chores)', () => {
    expect(findUnprovenRuntimeAcs('## Summary\n\nBumped a dependency.')).toEqual([])
  })

  it('stays silent on an empty or missing body', () => {
    expect(findUnprovenRuntimeAcs('')).toEqual([])
    expect(findUnprovenRuntimeAcs(undefined as unknown as string)).toEqual([])
  })
})

describe('runtime AC proof: section extraction', () => {
  it('stops at the next heading so later sections cannot leak rows in', () => {
    const body = pr('| (repo) Something | met | file.ts:1 |')
    const section = extractAcSection(body)
    expect(section).toContain('(repo) Something')
    expect(section).not.toContain('Test plan')
  })

  it('returns empty when the section is absent', () => {
    expect(extractAcSection('## Summary\n\nNothing here.')).toBe('')
  })

  it('is case-insensitive on the heading', () => {
    const body = '## ACCEPTANCE CRITERIA STATUS\n| (repo) X | met | f.ts:1 |'
    expect(extractAcSection(body)).toContain('(repo) X')
  })
})

describe('runtime AC proof: the failure message tells you what to do', () => {
  it('names the AC, the evidence given, and the remedy', () => {
    const violations = findUnprovenRuntimeAcs(
      pr('| (runtime) Operator adopts the new level | met | src/x.ts:1 |')
    )
    const message = formatViolations(violations)
    expect(message).toContain('Operator adopts the new level')
    expect(message).toContain('src/x.ts:1')
    expect(message).toContain('crane_verify')
    expect(message).toContain('.claude/commands/wired.md')
  })

  it('renders empty evidence legibly rather than as a blank', () => {
    const message = formatViolations(findUnprovenRuntimeAcs(pr('| (runtime) X | met |  |')))
    expect(message).toContain('(empty)')
  })
})
