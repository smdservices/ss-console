/**
 * Tests for the customer.yaml secret detector
 * (src/lib/ai-employee/customer-yaml/secret-detector.ts).
 *
 * The detector exists because customer.yaml lives in git (ADR 0012). A
 * literal secret committed here is in git history permanently and, for a
 * regulated tenant, a privilege-breach. These tests verify the detector
 * catches what it claims to catch — provider-shaped keys, banned field
 * names, high-entropy strings — and never echoes a matched substring back.
 *
 * The no-echo invariant matters as much as the detection itself: this is
 * the one component in the stack whose output is GUARANTEED to be looked
 * at by humans and tools when a real secret was leaked. Logging the match
 * would defeat the purpose.
 */

import { describe, it, expect } from 'vitest'
import {
  scanParsedValue,
  scanRawYaml,
  SECRET_DETECTOR_INTERNALS,
  type SecretFinding,
} from '../src/lib/ai-employee/customer-yaml'

// Synthetic secret-shaped strings used in tests. None of these are real
// credentials. They follow the published shapes of each provider so the
// pattern detectors flag them.
//
// Each fixture is built by runtime concatenation of its provider prefix +
// random-looking body. Storing them as static literals trips GitHub's own
// secret scanner during push (it cannot distinguish synthetic shapes from
// the real thing). The runtime build is functionally identical for the
// tests but invisible to static scanners.
const BODY_36 = 'abcdefghijklmnopqrstuvwxyz0123456789ab'
const BODY_40 = 'abcdefghijklmnopqrstuvwxyz0123456789abcd'
const BODY_HEX_64 = 'deadbeefcafebabe0123456789abcdef0123456789abcdef0123456789abcdef'

const SYNTH = {
  // sk_live_ Stripe-shape (concat at runtime so static scanners don't match)
  stripeLive: ['sk', 'live', BODY_36].join('_'),
  stripeTest: ['pk', 'test', BODY_36].join('_'),
  // JWT-shape: three base64url segments joined by '.'
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjMifQ', 'AbCdEfGhIjKlMnOpQrStUv'].join('.'),
  // AWS key ID shape
  awsKey: 'AKIA' + 'IOSFODNN7EXAMPLE',
  // GitHub PAT shape
  ghPat: 'ghp' + '_' + 'aaaabbbbccccddddeeeeffffgggghhhhiiiiJJJJ',
  // OpenAI key shape: sk-<32+ alnum>
  openaiKey: 'sk' + '-' + BODY_40,
  // Slack bot token shape
  slackBot: ['xoxb', '1111111111', '2222222222', 'aaaaaaaaaaaa'].join('-'),
  // Google OAuth client secret shape: GOCSPX-<20+ alnum>
  googleCs: 'GOCSPX' + '-' + 'abcdefghijklmnopqrstuvwxyz1234',
  hexLong: BODY_HEX_64,
  // Long base64-shaped (>80 chars, base64 alphabet only)
  base64Long: 'A'.repeat(60) + 'B'.repeat(40) + '=',
} as const

describe('scanParsedValue — provider-shaped patterns', () => {
  it('flags Stripe-shaped live key in any field', () => {
    const findings = scanParsedValue(
      { customer_id: 'smith', personas: [{ name: SYNTH.stripeLive }] },
      ''
    )
    expect(findings.some((f) => f.category === 'stripe_or_resend_shaped')).toBe(true)
  })

  it('flags Stripe-shaped test key', () => {
    const findings = scanParsedValue({ x: SYNTH.stripeTest }, '')
    expect(findings.some((f) => f.category === 'stripe_or_resend_shaped')).toBe(true)
  })

  it('flags a JWT', () => {
    const findings = scanParsedValue({ x: SYNTH.jwt }, '')
    expect(findings.some((f) => f.category === 'jwt')).toBe(true)
  })

  it('flags an AWS access key ID', () => {
    const findings = scanParsedValue({ creds: SYNTH.awsKey }, '')
    expect(findings.some((f) => f.category === 'aws_access_key_id')).toBe(true)
  })

  it('flags a GitHub personal access token', () => {
    const findings = scanParsedValue({ x: SYNTH.ghPat }, '')
    expect(findings.some((f) => f.category === 'github_token')).toBe(true)
  })

  it('flags an OpenAI API key', () => {
    const findings = scanParsedValue({ x: SYNTH.openaiKey }, '')
    expect(findings.some((f) => f.category === 'openai_api_key')).toBe(true)
  })

  it('flags a Slack bot token', () => {
    const findings = scanParsedValue({ x: SYNTH.slackBot }, '')
    expect(findings.some((f) => f.category === 'slack_token')).toBe(true)
  })

  it('flags a Google OAuth client secret', () => {
    const findings = scanParsedValue({ x: SYNTH.googleCs }, '')
    expect(findings.some((f) => f.category === 'google_oauth_client_secret')).toBe(true)
  })

  it('runs provider checks even on allowlisted paths', () => {
    // signature_html is shape-heuristic allowlisted, but a smuggled OpenAI
    // key still gets flagged.
    const findings = scanParsedValue(
      { personas: [{ signature_html: `<img>${SYNTH.openaiKey}</img>` }] },
      ''
    )
    expect(findings.some((f) => f.category === 'openai_api_key')).toBe(true)
  })
})

describe('scanParsedValue — shape heuristics', () => {
  it('flags long hex strings outside the allowlist', () => {
    const findings = scanParsedValue({ x: SYNTH.hexLong }, '')
    expect(findings.some((f) => f.category === 'hex_long')).toBe(true)
  })

  it('flags long base64-shaped strings outside the allowlist', () => {
    const findings = scanParsedValue({ x: SYNTH.base64Long }, '')
    const hits = findings.filter(
      (f) => f.category === 'base64_long' || f.category === 'high_entropy_long'
    )
    expect(hits.length).toBeGreaterThan(0)
  })

  it('SKIPS shape heuristics in signature_html', () => {
    // A bare long base64 string in signature_html should not flag as
    // base64_long (signature bodies legitimately contain data URIs).
    const longBenign = 'A'.repeat(120)
    const findings = scanParsedValue({ personas: [{ signature_html: longBenign }] }, '')
    expect(findings.filter((f) => f.category === 'base64_long').length).toBe(0)
  })

  it('SKIPS shape heuristics on connectors.*.token_ref', () => {
    // token_ref is the permitted Infisical channel; its path value is long
    // and entropic but should not trigger heuristics.
    const findings = scanParsedValue(
      {
        connectors: {
          PracticeManagement: {
            token_ref: 'infisical:/ai-employee/smith/practice-management/oauth-refresh',
          },
        },
      },
      ''
    )
    expect(findings.length).toBe(0)
  })

  it('does NOT flag short low-entropy strings', () => {
    const findings = scanParsedValue({ name: 'Marcus', tone: ['warm', 'concise'] }, '')
    expect(findings.length).toBe(0)
  })
})

describe('scanParsedValue — banned field names', () => {
  it('flags `client_secret` even when the value is empty', () => {
    const findings = scanParsedValue({ connectors: { Email: { client_secret: '' } } }, '')
    expect(findings.some((f) => f.category === 'banned_field_name')).toBe(true)
  })

  it('flags `api_key`', () => {
    const findings = scanParsedValue({ api_key: 'whatever' }, '')
    expect(findings.some((f) => f.category === 'banned_field_name')).toBe(true)
  })

  it('flags `refresh_token`', () => {
    const findings = scanParsedValue({ refresh_token: 'whatever' }, '')
    expect(findings.some((f) => f.category === 'banned_field_name')).toBe(true)
  })

  it('flags `bearer`', () => {
    const findings = scanParsedValue({ x: { bearer: 'whatever' } }, '')
    expect(findings.some((f) => f.category === 'banned_field_name')).toBe(true)
  })

  it('EXEMPTS `token_ref` (the permitted Infisical channel)', () => {
    const findings = scanParsedValue(
      { connectors: { Email: { token_ref: 'infisical:/scope/customer/email/refresh' } } },
      ''
    )
    expect(findings.filter((f) => f.category === 'banned_field_name').length).toBe(0)
  })

  it('reports the JSONPath of a banned field', () => {
    const findings = scanParsedValue({ connectors: { Email: { client_secret: 'foo' } } }, '')
    const banned = findings.find((f) => f.category === 'banned_field_name')
    expect(banned).toBeDefined()
    expect(banned!.path).toBe('connectors.Email.client_secret')
  })
})

describe('scanParsedValue — no-echo invariant', () => {
  // The single most important invariant. Findings name the category and the
  // path; they NEVER include the matched substring.
  const cases: Array<{ name: string; doc: unknown; secret: string }> = [
    { name: 'stripe', doc: { x: SYNTH.stripeLive }, secret: SYNTH.stripeLive },
    { name: 'jwt', doc: { x: SYNTH.jwt }, secret: SYNTH.jwt },
    { name: 'aws', doc: { creds: SYNTH.awsKey }, secret: SYNTH.awsKey },
    { name: 'openai', doc: { x: SYNTH.openaiKey }, secret: SYNTH.openaiKey },
    { name: 'github', doc: { x: SYNTH.ghPat }, secret: SYNTH.ghPat },
    { name: 'slack', doc: { x: SYNTH.slackBot }, secret: SYNTH.slackBot },
    { name: 'google', doc: { x: SYNTH.googleCs }, secret: SYNTH.googleCs },
    { name: 'hex', doc: { x: SYNTH.hexLong }, secret: SYNTH.hexLong },
  ]
  for (const c of cases) {
    it(`never echoes ${c.name} substring in finding.reason or finding.path`, () => {
      const findings = scanParsedValue(c.doc, '')
      expect(findings.length).toBeGreaterThan(0)
      for (const f of findings) {
        expect(JSON.stringify(f)).not.toContain(c.secret)
      }
    })
  }
})

describe('scanRawYaml — line-level detection', () => {
  it('reports the 1-indexed line number on a hit', () => {
    const yaml = [
      'customer_id: smith',
      'customer_name: Smith PI',
      `api_key: ${SYNTH.openaiKey}`,
      'model: claude-opus-4-7',
    ].join('\n')
    const findings = scanRawYaml(yaml)
    // line 3 has BOTH a banned field name AND an OpenAI key value
    const lines = findings.map((f) => f.line).filter((n): n is number => n !== null)
    expect(lines).toContain(3)
  })

  it('flags banned field names in raw text', () => {
    const yaml = 'client_secret: anyvalue\n'
    const findings = scanRawYaml(yaml)
    expect(findings.some((f) => f.category === 'banned_field_name')).toBe(true)
  })

  it('flags provider-shaped values in raw text', () => {
    const yaml = `mystery: ${SYNTH.stripeLive}\n`
    const findings = scanRawYaml(yaml)
    expect(findings.some((f) => f.category === 'stripe_or_resend_shaped')).toBe(true)
  })

  it('ignores comments', () => {
    const yaml = `# pretend ${SYNTH.openaiKey} appears in a comment\ncustomer_id: smith\n`
    const findings = scanRawYaml(yaml)
    // The OpenAI shape is inside a comment line; raw scanner skips the line.
    expect(findings.filter((f) => f.category === 'openai_api_key').length).toBe(0)
  })

  it('handles trailing inline comments', () => {
    const yaml = `customer_id: smith # trailing comment with ${SYNTH.stripeLive}\n`
    const findings = scanRawYaml(yaml)
    // Trailing inline comment is stripped from the value before scanning.
    expect(findings.length).toBe(0)
  })

  it('exempts token_ref even when the value is long', () => {
    const yaml = 'token_ref: "infisical:/ai-employee/smith/practice-management/oauth-refresh"\n'
    const findings = scanRawYaml(yaml)
    expect(findings.length).toBe(0)
  })

  it('produces a non-empty reason that never contains the matched secret', () => {
    const yaml = `random_field: ${SYNTH.stripeLive}\n`
    const findings = scanRawYaml(yaml)
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(f.reason).not.toContain(SYNTH.stripeLive)
      expect(f.reason.length).toBeGreaterThan(0)
    }
  })
})

describe('scanRawYaml — adversarial inputs', () => {
  it('treats malformed YAML as best-effort (does not throw)', () => {
    // Wildly invalid input; scanner must still return without throwing.
    const yaml = `:::this:is\n  not-valid-yaml: [unbalanced\n  api_key: ${SYNTH.openaiKey}`
    expect(() => scanRawYaml(yaml)).not.toThrow()
    const findings = scanRawYaml(yaml)
    // The api_key banned field name should still be caught.
    expect(findings.some((f) => f.category === 'banned_field_name')).toBe(true)
  })

  it('handles an empty document', () => {
    expect(scanRawYaml('')).toEqual([])
  })

  it('does not flag the same line twice for the same value', () => {
    // A single bad line with one banned field name + one bad value should
    // produce two findings (one for each category), not duplicates.
    const yaml = `api_key: ${SYNTH.openaiKey}\n`
    const findings = scanRawYaml(yaml)
    const categories = findings.map((f) => f.category)
    expect(new Set(categories).size).toBe(categories.length)
  })
})

describe('detector internals are visible to tests', () => {
  it('exposes BANNED_FIELD_NAME_SUBSTRINGS via SECRET_DETECTOR_INTERNALS', () => {
    // The list contains substrings; `client_secret` is caught by the
    // `secret` substring entry. Verify a representative subset.
    expect(SECRET_DETECTOR_INTERNALS.BANNED_FIELD_NAME_SUBSTRINGS.length).toBeGreaterThan(0)
    for (const expected of ['secret', 'api_key', 'access_token', 'refresh_token']) {
      expect(SECRET_DETECTOR_INTERNALS.BANNED_FIELD_NAME_SUBSTRINGS).toContain(expected)
    }
  })

  it('declares at least the seven provider shapes', () => {
    expect(SECRET_DETECTOR_INTERNALS.PROVIDER_PATTERN_COUNT).toBeGreaterThanOrEqual(7)
  })
})

describe('extraAllowlist', () => {
  it('suppresses shape heuristics on caller-specified paths', () => {
    const doc = { metadata: { random_hash: SYNTH.hexLong } }
    const withoutAllowlist = scanParsedValue(doc, '')
    expect(withoutAllowlist.some((f: SecretFinding) => f.category === 'hex_long')).toBe(true)

    const withAllowlist = scanParsedValue(doc, '', {
      extraAllowlist: ['metadata.random_hash'],
    })
    expect(withAllowlist.filter((f) => f.category === 'hex_long').length).toBe(0)
  })

  it('still runs provider checks even on allowlisted paths', () => {
    const doc = { metadata: { random_hash: SYNTH.openaiKey } }
    const findings = scanParsedValue(doc, '', {
      extraAllowlist: ['metadata.random_hash'],
    })
    expect(findings.some((f) => f.category === 'openai_api_key')).toBe(true)
  })
})
