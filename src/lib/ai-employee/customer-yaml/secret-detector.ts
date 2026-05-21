/**
 * customer.yaml secret detector — refuse-to-merge heuristic for the file
 * that wires one customer's configuration. customer.yaml lives in git (ADR
 * 0012); any literal secret committed here is in git history permanently and,
 * for a regulated tenant like a law firm, constitutes a privilege-breach.
 *
 * This module is consumed by:
 *   1. tests/customer-yaml-validator.test.ts — invariant coverage
 *   2. validator.ts — runs scanRawYaml as the first pass before structural parse
 *   3. (deferred) CI workflow at the canonical configs repo per ADR 0012 §5
 *   4. (deferred) pre-commit hook authors can wire in their dev environment
 *
 * Two operating modes:
 *   - `scanRawYaml(text, options)` — line-by-line scan of the raw file. Used
 *     before structural parsing so a malformed YAML containing a secret still
 *     fails closed. Returns SecretFinding[] with line numbers.
 *   - `scanParsedValue(value, path, options)` — recursive scan of a parsed
 *     object. Used by the validator after structural parsing so JSONPath-level
 *     context (e.g. "connectors.PracticeManagement.token_ref") is available.
 *
 * Reasonable user prompt for design: Risk 2 in the Tech Lead PRD contribution.
 * Reference: gitleaks default rule set, trimmed to patterns that materially
 * appear in YAML configuration files for this product.
 *
 * Critical invariant: error messages NEVER echo the matched substring. The
 * detector exists precisely because secret values must not enter persistent
 * stores (git, CI logs, terminal transcripts, agent context). Echoing the
 * match would defeat the purpose.
 */

/**
 * Categories of secret-shaped patterns the detector recognizes. New
 * categories require a corresponding entry in PROVIDER_PATTERNS or a
 * dedicated check below — see secret-detector.test.ts for coverage.
 */
export type SecretPatternCategory =
  | 'stripe_or_resend_shaped'
  | 'jwt'
  | 'aws_access_key_id'
  | 'github_token'
  | 'openai_api_key'
  | 'slack_token'
  | 'google_oauth_client_secret'
  | 'hex_long'
  | 'base64_long'
  | 'high_entropy_long'
  | 'banned_field_name'

/** Categories that match on a value's shape (substring-anywhere matching). */
type ValuePatternCategory = Exclude<SecretPatternCategory, 'banned_field_name'>

/** A single match. The matched substring is intentionally NOT stored. */
export interface SecretFinding {
  /** Which heuristic triggered. */
  category: SecretPatternCategory
  /** 1-indexed line number when scanning raw text; null when scanning a parsed value. */
  line: number | null
  /** Dotted/bracketed path through the parsed object when available. */
  path: string | null
  /** Short, non-revealing description for human authors. */
  reason: string
}

/**
 * Provider-shaped patterns. These are deterministic shape checks — if the
 * value matches the regex, it is almost certainly a real secret of that
 * provider. They run inside allowlisted fields too (an OpenAI key smuggled
 * into signature_html is still a leak).
 */
const PROVIDER_PATTERNS: ReadonlyArray<{
  category: ValuePatternCategory
  pattern: RegExp
  reason: string
}> = [
  {
    category: 'stripe_or_resend_shaped',
    pattern: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{20,}\b/,
    reason: 'value resembles a Stripe / Resend / Anthropic-shaped key',
  },
  {
    category: 'jwt',
    pattern: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    reason: 'value resembles a JSON Web Token',
  },
  {
    category: 'aws_access_key_id',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    reason: 'value resembles an AWS access key ID',
  },
  {
    category: 'github_token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
    reason: 'value resembles a GitHub personal/OAuth token',
  },
  {
    category: 'openai_api_key',
    pattern: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/,
    reason: 'value resembles an OpenAI API key',
  },
  {
    category: 'slack_token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    reason: 'value resembles a Slack token',
  },
  {
    category: 'google_oauth_client_secret',
    pattern: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/,
    reason: 'value resembles a Google OAuth client secret',
  },
]

/**
 * Field names that should never carry a value in customer.yaml — these
 * fields belong in Infisical, not in git. Matched case-insensitively as a
 * substring of the full key name.
 */
const BANNED_FIELD_NAME_SUBSTRINGS: ReadonlyArray<string> = [
  'password',
  'passwd',
  'secret', // matches `client_secret`, `api_secret`, etc.
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'private_key',
  'bearer',
  'auth_token',
]

/**
 * Paths permitted to contain long high-entropy / base64-shaped values. They
 * are STILL scanned for provider-shaped keys — only the heuristic shape
 * checks (`hex_long`, `base64_long`, `high_entropy_long`) are skipped.
 *
 * Paths use dotted notation with `[idx]` for array indexes, e.g.
 * `personas[0].signature_html`. The allowlist matches when any entry is a
 * prefix or full-path match of the value's path.
 */
const SHAPE_HEURISTIC_ALLOWLIST_PATHS: ReadonlyArray<string> = [
  'customer_name',
  'personas[*].signature_html',
  'personas[*].avatar_url',
  'personas[*].send_as.agentmail_identity',
  'users[*].email',
  'users[*].full_name',
  'escalation.red_flag_recipients',
  'escalation.failure_recipients',
  // token_ref is the ONE permitted secret-reference channel. The value is an
  // Infisical path string; it carries no secret. Bypass shape heuristics so
  // the path is not flagged as base64-shaped or high-entropy.
  'connectors.*.token_ref',
]

/**
 * Field paths that may carry an `infisical:` token_ref but must NEVER carry
 * a literal value. The validator checks the prefix rule separately; this
 * detector only checks that the value does not look like a real secret.
 */

/** Options accepted by both scanners. */
export interface ScanOptions {
  /**
   * Additional path patterns to allowlist for shape heuristics (not for
   * provider-shaped checks; those always run). Callers should rarely need
   * this — prefer adding the path to SHAPE_HEURISTIC_ALLOWLIST_PATHS above
   * and shipping it in the next schema version.
   */
  extraAllowlist?: ReadonlyArray<string>
}

/** Convert a real path like `personas[0].skills[1].name` to its template
 * form `personas[*].skills[*].name` so it can be compared against the
 * allowlist patterns. */
function pathTemplate(path: string): string {
  return path.replace(/\[\d+\]/g, '[*]')
}

function isPathShapeAllowlisted(path: string | null, extra: ReadonlyArray<string>): boolean {
  if (path === null) return false
  const template = pathTemplate(path)
  for (const entry of SHAPE_HEURISTIC_ALLOWLIST_PATHS) {
    if (template === entry || template.startsWith(entry + '.') || template.startsWith(entry + '['))
      return true
  }
  for (const entry of extra) {
    if (template === entry || template.startsWith(entry + '.') || template.startsWith(entry + '['))
      return true
  }
  return false
}

/** Shannon entropy of a string in bits per character. Used to flag
 * unstructured high-entropy values that the deterministic provider patterns
 * miss. The 4.5 bits/char threshold below is conservative — random base64
 * sits around 5.5, English prose sits around 3.5. */
function shannonEntropy(s: string): number {
  if (s.length === 0) return 0
  const freq: Record<string, number> = {}
  for (const ch of s) freq[ch] = (freq[ch] ?? 0) + 1
  let h = 0
  for (const count of Object.values(freq)) {
    const p = count / s.length
    h -= p * Math.log2(p)
  }
  return h
}

function checkProviderPatterns(value: string): SecretPatternCategory | null {
  for (const entry of PROVIDER_PATTERNS) {
    if (entry.pattern.test(value)) return entry.category
  }
  return null
}

function checkShapeHeuristics(value: string): SecretPatternCategory | null {
  const trimmed = value.trim()
  // Standalone hex: pure hex chars, ≥40 long (SHA-1 length and up).
  if (/^[a-f0-9]{40,}$/.test(trimmed)) return 'hex_long'
  // Standalone base64: ≥80 chars and base64 alphabet only (with optional
  // = padding). Length threshold avoids hashing legitimate short tokens.
  if (trimmed.length > 80 && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return 'base64_long'
  // High-entropy long string: 32+ chars with entropy ≥ 4.5 bits/char.
  if (trimmed.length >= 32 && shannonEntropy(trimmed) >= 4.5) return 'high_entropy_long'
  return null
}

function reasonForCategory(category: SecretPatternCategory): string {
  switch (category) {
    case 'stripe_or_resend_shaped':
      return 'value resembles a Stripe / Resend / Anthropic-shaped key'
    case 'jwt':
      return 'value resembles a JSON Web Token'
    case 'aws_access_key_id':
      return 'value resembles an AWS access key ID'
    case 'github_token':
      return 'value resembles a GitHub token'
    case 'openai_api_key':
      return 'value resembles an OpenAI API key'
    case 'slack_token':
      return 'value resembles a Slack token'
    case 'google_oauth_client_secret':
      return 'value resembles a Google OAuth client secret'
    case 'hex_long':
      return 'value is a long hex string (likely a secret hash or key)'
    case 'base64_long':
      return 'value is a long base64-shaped string'
    case 'high_entropy_long':
      return 'value is long and high-entropy (likely a generated secret)'
    case 'banned_field_name':
      return 'field name is reserved for Infisical-managed secrets and must not appear in customer.yaml'
  }
}

/**
 * Scan a value's shape and return the first triggered category, or null.
 * Provider patterns always run; shape heuristics are skipped when the path
 * is allowlisted. The caller is responsible for never echoing the value.
 */
function scanValueShape(
  value: string,
  path: string | null,
  extraAllowlist: ReadonlyArray<string>
): SecretPatternCategory | null {
  const provider = checkProviderPatterns(value)
  if (provider !== null) return provider
  if (isPathShapeAllowlisted(path, extraAllowlist)) return null
  return checkShapeHeuristics(value)
}

/**
 * Scan a parsed YAML value recursively. Used by the validator after the
 * structural parse so JSONPath context is available for each finding.
 *
 * For each scalar string value, checks provider patterns + shape heuristics
 * (the latter respecting the allowlist). For each object key, checks the
 * field name against BANNED_FIELD_NAME_SUBSTRINGS.
 */
export function scanParsedValue(
  value: unknown,
  path: string,
  options: ScanOptions = {}
): SecretFinding[] {
  const findings: SecretFinding[] = []
  const extra = options.extraAllowlist ?? []
  visit(value, path, findings, extra)
  return findings
}

function visit(
  value: unknown,
  path: string,
  findings: SecretFinding[],
  extra: ReadonlyArray<string>
): void {
  if (typeof value === 'string') {
    const category = scanValueShape(value, path, extra)
    if (category !== null) {
      findings.push({
        category,
        line: null,
        path,
        reason: reasonForCategory(category),
      })
    }
    return
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      visit(value[i], `${path}[${i}]`, findings, extra)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const keyLower = key.toLowerCase()
      const banned = BANNED_FIELD_NAME_SUBSTRINGS.find((s) => keyLower.includes(s))
      // `token_ref` is the explicitly permitted Infisical-reference field,
      // even though the name contains "token". Skip the field-name ban for it.
      if (banned !== undefined && key !== 'token_ref') {
        findings.push({
          category: 'banned_field_name',
          line: null,
          path: path === '' ? key : `${path}.${key}`,
          reason: reasonForCategory('banned_field_name'),
        })
        // Continue visiting; the value still goes through the value-shape check.
      }
      visit(child, path === '' ? key : `${path}.${key}`, findings, extra)
    }
    return
  }
  // Scalars other than strings (numbers, booleans, null) are not scanned.
}

/**
 * Scan raw YAML text line-by-line. Used before structural parsing so a
 * malformed YAML still fails closed on a leaked secret.
 *
 * Strategy: a simple per-line scan that:
 *   - For each line, extracts the field name (before the first unquoted `:`).
 *     If the field name is banned, emits a finding. token_ref is exempt.
 *   - For each line, extracts everything after `:` and treats it as the
 *     candidate value (after stripping comments and YAML quoting). Runs
 *     scanValueShape on the candidate.
 *
 * This is a heuristic — it doesn't understand block scalars, anchors, or
 * multi-line strings. The structural pass in scanParsedValue is the
 * authoritative check; this raw pass is the "fail closed even on malformed
 * input" defense.
 */
export function scanRawYaml(text: string, options: ScanOptions = {}): SecretFinding[] {
  const findings: SecretFinding[] = []
  const extra = options.extraAllowlist ?? []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? ''
    const line = rawLine.replace(/^\s+/, '')
    if (line === '' || line.startsWith('#')) continue
    const colon = findUnquotedColon(line)
    let fieldName: string | null = null
    let valueText: string
    if (colon === -1) {
      // No colon — treat the whole non-comment portion as a value (covers
      // YAML list items written as `- bare-value`).
      valueText = stripLeadingDash(line)
    } else {
      fieldName = line.slice(0, colon).trim()
      valueText = line.slice(colon + 1).trim()
    }
    if (fieldName !== null) {
      const keyName = fieldName.replace(/^["']|["']$/g, '')
      const keyLower = keyName.toLowerCase()
      const banned = BANNED_FIELD_NAME_SUBSTRINGS.find((s) => keyLower.includes(s))
      if (banned !== undefined && keyName !== 'token_ref') {
        findings.push({
          category: 'banned_field_name',
          line: i + 1,
          path: keyName,
          reason: reasonForCategory('banned_field_name'),
        })
      }
    }
    const cleanedValue = stripCommentAndQuotes(valueText)
    if (cleanedValue === '') continue
    // Raw-line scanning has no structural path; rely solely on value shape.
    const category = scanValueShape(cleanedValue, null, extra)
    if (category !== null) {
      findings.push({
        category,
        line: i + 1,
        path: fieldName,
        reason: reasonForCategory(category),
      })
    }
  }
  return findings
}

/** Find the index of the first colon not enclosed in matching quotes. */
function findUnquotedColon(line: string): number {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ':') return i
  }
  return -1
}

/** Strip a leading `- ` (YAML list marker) from a line. */
function stripLeadingDash(line: string): string {
  if (line.startsWith('- ')) return line.slice(2).trim()
  if (line === '-') return ''
  return line.trim()
}

/**
 * Strip a YAML inline comment and surrounding quotes from a value snippet.
 * Comments start at an unquoted `#`. Both single and double quotes are
 * supported.
 */
function stripCommentAndQuotes(value: string): string {
  let quote: '"' | "'" | null = null
  let end = value.length
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#') {
      end = i
      break
    }
  }
  let out = value.slice(0, end).trim()
  if (
    (out.startsWith('"') && out.endsWith('"') && out.length >= 2) ||
    (out.startsWith("'") && out.endsWith("'") && out.length >= 2)
  ) {
    out = out.slice(1, -1)
  }
  return out
}

/**
 * Exported constants for tests + downstream consumers. The list shapes are
 * intentionally narrow — tests assert behavior, not the list contents.
 */
export const SECRET_DETECTOR_INTERNALS = {
  BANNED_FIELD_NAME_SUBSTRINGS,
  SHAPE_HEURISTIC_ALLOWLIST_PATHS,
  PROVIDER_PATTERN_COUNT: PROVIDER_PATTERNS.length,
} as const
