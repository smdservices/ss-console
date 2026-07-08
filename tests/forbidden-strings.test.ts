/**
 * Regression guard: forbidden strings must not appear in shipped source files.
 *
 * These strings represent CLAUDE.md Pattern A/B violations (committed template
 * sentences promising uncontracted behavior, or hardcoded fallback identities).
 * Any re-introduction of these strings is a P0 compliance failure.
 *
 * @see CLAUDE.md — "No fabricated client-facing content"
 * @see docs/archive/code-review-2026-04-16.md
 * @see GitHub issues #398
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { resolve, join, extname } from 'path'

const SRC_ROOT = resolve('src')
const PAGES_ROOT = resolve('src/pages')
const COMPONENTS_ROOT = resolve('src/components')
const LAYOUTS_ROOT = resolve('src/layouts')

const USER_FACING_EXCLUDED_DIRS = [
  resolve('src/pages/admin'),
  resolve('src/pages/api'),
  resolve('src/pages/design-preview'),
  resolve('src/pages/dev'),
  resolve('src/components/admin'),
]

/** Collect all .astro, .ts, .tsx files under src/ (excluding test files and dev harness) */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      // Exclude src/pages/dev/ — developer harness, not shipped client-facing code
      if (fullPath === resolve('src/pages/dev')) continue
      files.push(...collectSourceFiles(fullPath))
    } else {
      const ext = extname(entry)
      if (
        ['.astro', '.ts', '.tsx'].includes(ext) &&
        !entry.endsWith('.test.ts') &&
        !entry.endsWith('.test.tsx')
      ) {
        files.push(fullPath)
      }
    }
  }
  return files
}

function isWithinDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`)
}

function collectAstroFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (USER_FACING_EXCLUDED_DIRS.some((excludedDir) => isWithinDir(fullPath, excludedDir))) {
      continue
    }

    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...collectAstroFiles(fullPath))
    } else if (extname(entry) === '.astro') {
      files.push(fullPath)
    }
  }
  return files
}

function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const FORBIDDEN_PATTERNS: Array<{ label: string; pattern: RegExp | string }> = [
  {
    label: 'Pattern A: hardcoded kickoff outreach promise',
    pattern: "We'll reach out to schedule kickoff",
  },
  {
    label: 'Pattern A: hardcoded "within two weeks" start window',
    pattern: 'Work begins within two weeks',
  },
  {
    label: 'Pattern A: hardcoded SLA "Replies within 1 business day"',
    pattern: 'Replies within 1 business day',
  },
  {
    label: 'Pattern A: hardcoded "2-week stabilization period" duration',
    pattern: '2-week stabilization period',
  },
  {
    label: 'Pattern A: hardcoded "within 1 business day of receiving"',
    pattern: 'within 1 business day of receiving',
  },
  {
    label: 'Pattern A: hardcoded "within one business day" promise',
    pattern: 'within one business day',
  },
  {
    label: 'Pattern A: hardcoded "will / we\'ll reach out" outreach promise (structural)',
    // 2026-04-17 audit finding: dashboard fallback rendered
    // `${consultantFirst} will reach out to schedule the next check-in.` as
    // fabricated next-step copy when no authored touchpoint existed.
    // 2026-06-12 code review: "We'll reach out once it's ready to review."
    // on the portal operator provisioning card slipped past the literal
    // /will reach out/ form. Broadened to catch the contraction. The
    // first-person prospect voice ("I'll reach out") is deliberately not
    // matched — that is the client speaking, not SMD promising.
    pattern: /(?:we['’]ll|will)\s+reach out/i,
  },
  {
    // 2026-06-30 code review (C2): src/lib/sow/service-finalize.ts hardcoded
    // `description: 'Deposit - Operations Cleanup Engagement'` on EVERY client's
    // Stripe invoice — a synthesized scope label rendered to a client (same
    // Pattern-B family as the audited `overview: 'Operations cleanup engagement
    // as discussed during assessment.'`). Invoice/SOW/PDF descriptions must come
    // from authored quote content, never a template scope phrase.
    // Case-SENSITIVE on purpose: the lowercase "operations cleanup engagements"
    // in LLM system prompts (assessment-to-quote.ts, dossier.ts) describes the
    // business to the model and is not client-rendered content — matching the
    // title-case rendered label avoids those false positives.
    label: 'Pattern B: hardcoded "Operations Cleanup Engagement" scope label (invoices/SOW/PDF)',
    pattern: 'Operations Cleanup Engagement',
  },
  {
    label: 'Pattern A: hardcoded "will / we\'ll be in touch" outbound-contact promise (structural)',
    // 2026-05-04 /book intake architecture review caught this same class
    // creeping back in as a Send-acknowledgement copy ("Got it. We'll be
    // in touch.") before merge. Same false-promise shape as `will reach
    // out` — commits SMD to an outbound action that no system guarantees.
    // 2026-06-12 code review: the signature-confirmation email shipped
    // "Our team will be in touch shortly" — the uncontracted tense variant
    // the literal /we'll be in touch/ form missed. Broadened.
    pattern: /(?:['’]ll|will)\s+be in touch/i,
  },
  {
    label: 'Pattern A: hardcoded "we will send it/a new" outbound delivery promise',
    // 2026-06-12 code review: InvoiceDetail rendered "We will send a new
    // one." / "We will send it shortly." — promises of a manual outbound
    // action no system guarantees. Scoped to the it/a-new objects so that
    // system-guaranteed mechanics ("we will send a calendar invite", which
    // booking reserve actually sends automatically) stay legal.
    pattern: /we will send (?:it|a new)\b/i,
  },
  {
    label: 'Pattern A: hardcoded work-start framing "work begins at/once/when"',
    // 2026-06-12 code review: EngagementProgress empty state rendered
    // "The work begins at the first scheduled check-in." — a schedule
    // commitment not authored per engagement. The literal "Work begins
    // within two weeks" guard above covers the duration variant; this
    // covers the event-anchored variants.
    pattern: /work begins (?:at|once|when)\b/i,
  },
  {
    label: 'Pattern B: synthesized "Kickoff next:" next-step copy',
    // 2026-04-17 audit finding: signed-state copy synthesized
    // `Kickoff next: ${engagement.scope_summary}.` when next_touchpoint_label
    // was missing. scope_summary is not an authored next-step field.
    pattern: /Kickoff next:/,
  },
  {
    label: 'Pattern B: fabricated "Engagement work" invoice line-item fallback',
    // 2026-04-17 audit finding: invoice line-item fallback fabricated
    // 'Engagement work' when no line items existed. Send-gate now blocks
    // sending an invoice without line items; this guards re-introduction
    // of a client-facing placeholder.
    pattern: /['"]Engagement work['"]/,
  },
  {
    label: 'Entity detail regression: do not reintroduce outreach_angle',
    pattern: /\boutreach_angle\b/,
  },
  {
    label: 'Entity detail regression: do not reintroduce pre-dossier draft copy',
    pattern: /Pre-dossier draft/,
  },
  {
    label: 'Pattern B: hardcoded "Scott" fallback in portal render paths',
    // Match ?? 'Scott' or : 'Scott' (ternary / nullish) in portal pages and components.
    // Does not flag 'Scott' in test fixtures, variable names, or email author strings.
    pattern: /\?\? ['"]Scott['"]/,
  },
  {
    label: "Pattern B: hardcoded default consultantFirstName = 'Scott'",
    pattern: /consultantFirstName\s*=\s*['"]Scott['"]/,
  },
  // --- Decision Stack #20 voice violations — portal surfaces must use
  //     "we / our team", never a named human or single-person framing.
  //     Added 2026-04-23 alongside the Plainspoken PR B voice fixes. ---
  {
    // "Text {consultantFirst} with questions." routes the client at a
    // specific person. The portal's persistent header three-icon control
    // (email / SMS / phone) is the canonical contact affordance; do not
    // re-route to a named consultant in body copy.
    label: 'Decision Stack #20: personalized "Text {firstName} with questions" CTA',
    pattern: /Text \{?\w+\}? with questions/i,
  },
  {
    // "Your consultant will send…" / "your consultant will…" frames the
    // engagement as a single-person service relationship. Prefer "we'll
    // send…" or similar. First flagged in the 2026-04-15 Pattern audit
    // and fixed in src/components/portal/InvoiceDetail.astro.
    label: 'Decision Stack #20: "your consultant will …" named-person framing',
    pattern: /your consultant will/i,
  },
  // --- Specific phrases removed from CaseStudies.astro (2026-04-22) ---
  // CaseStudies shipped four fabricated case studies with specific
  // quantified results. Real case studies belong in an authored data
  // source per engagement, not committed to source. These patterns
  // guard against reintroduction of the exact phrases removed.
  {
    label: 'Pattern A: fabricated "X hours/week freed" result',
    pattern: /hours\/week freed/,
  },
  {
    label: 'Pattern A: fabricated "Zero missed leads in [period]" result',
    pattern: /Zero missed leads in /,
  },
  {
    label: 'Pattern A: fabricated "Zero turnover in [period]" result',
    // Matches both "Zero turnover in 6 months" and "Zero turnover in the 6 months"
    // (the original fabrication used the latter phrasing). Still shape-bound —
    // honest general copy like "Zero turnover in isolation" would not match.
    pattern: /Zero turnover in (?:the |\d)/,
  },
  {
    label: 'Pattern A: fabricated "Partner reclaimed N+ hours" result',
    pattern: /Partner reclaimed \d+\+? hours/,
  },
  // --- AI-opener voice violations — see issue #815 ---
  // "Thanks for sharing" is a banned AI opener that performs gratitude
  // without conveying information. First flagged on the /get-started post-
  // booking success page; Captain decision 2026-05-26 to kill outright
  // rather than carve out a confirmed-prospect exception.
  {
    label: 'AI-opener: banned "Thanks for sharing" acknowledgment',
    pattern: /Thanks for sharing/i,
  },
  // --- Structural pattern: quantified time-savings results at large ---
  // Catches "12 hours/week freed", "15 hrs per month saved",
  // "10+ hours/day reclaimed", etc. Drift resistance to the pattern-class,
  // not just today's exact wording. Narrowly scoped to the
  // freed/saved/reclaimed/back verbs to avoid false positives on honest
  // general copy about "hours per week".
  {
    label: 'Pattern A: fabricated quantified time-savings result (structural)',
    pattern:
      /\d+\+?\s*(?:hours?|hrs?)\s*(?:per|\/)\s*(?:week|wk|month|mo|day)\s+(?:freed|saved|reclaimed|back)/i,
  },
  // --- Retired Operator marketing spine (ADR 0037, 2026-06-27) ---
  // "the role you keep meaning to fill" opened on a role the owner had failed
  // to fill, which is an accusation; "fill the seat" carried the same framing.
  // Both retired in favor of the off-the-shelf / built-for-you / third-option
  // spine. Scanned over src only (docs/ may quote the retired line to explain
  // the rip). See feedback_no_accusatory_role_framing.
  {
    label: 'Retired accusatory spine: "keep(s) meaning to fill"',
    pattern: /keeps?\s+meaning\s+to\s+fill/i,
  },
  {
    label: 'Retired spine framing: "fill the seat"',
    pattern: /\bfill the seat\b/i,
  },
]

const sourceFiles = collectSourceFiles(SRC_ROOT)
const userFacingSurfaceFiles = [
  ...collectAstroFiles(PAGES_ROOT),
  ...collectAstroFiles(COMPONENTS_ROOT),
  ...collectAstroFiles(LAYOUTS_ROOT),
]

const USER_FACING_COPY_GUARDS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'no em dashes in shipped user-facing surfaces',
    pattern: /—/,
  },
  {
    label: 'no "coming soon" placeholder copy in shipped user-facing surfaces',
    pattern: /\bcoming soon\b/i,
  },
  // "off the shelf" disparages the very people and software an Operator works
  // alongside (a non-starter for a staffing alternative). Retired 2026-06-27 in
  // favor of the gap / space-between spine. See feedback_respect_people_and_software.
  {
    label: 'no "off the shelf" framing in shipped user-facing surfaces',
    pattern: /\boff the shelf\b/i,
  },
]

describe('forbidden-strings: Pattern A/B violations must not appear in shipped source', () => {
  for (const { label, pattern } of FORBIDDEN_PATTERNS) {
    it(`must not contain: ${label}`, () => {
      const violations: string[] = []
      for (const file of sourceFiles) {
        const content = readFileSync(file, 'utf-8')
        const matched =
          typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content)
        if (matched) {
          // Compute a relative path for readable failure messages
          const rel = file.replace(SRC_ROOT, 'src')
          violations.push(rel)
        }
      }
      expect(violations).toEqual([])
    })
  }
})

// ============================================================================
// Done-card fabrication-trap guard — V3 /book chat redesign.
//
// IntakeClosed.astro renders an acknowledgment card after the prospect
// clicks "Done" without booking. Per the no-fabricated-content policy in
// CLAUDE.md (Pattern A is P0), the card MUST NOT promise follow-up
// outreach. The Captain authors the literal copy line; this scoped check
// blocks regression patterns sneaking into THIS file specifically. The
// global FORBIDDEN_PATTERNS list catches historical violations elsewhere;
// this list is targeted at the surface most likely to drift.
// ============================================================================

const DONE_CARD_FILE = resolve('src/components/booking/IntakeClosed.astro')
const DONE_CARD_FABRICATION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: '"we will" follow-up promise',
    pattern: /\bwe\s+will\b/i,
  },
  {
    label: '"we\'ll" follow-up promise',
    pattern: /\bwe['’]ll\b/i,
  },
  {
    label: '"review your" implies we will read and act',
    pattern: /\breview your\b/i,
  },
  {
    label: '"get back" implies a return contact',
    pattern: /\bget back\b/i,
  },
  {
    label: '"in touch" implies we will reach out',
    pattern: /\bin touch\b/i,
  },
  {
    label: '"reach out" implies we will reach out',
    pattern: /\breach out\b/i,
  },
]

describe('IntakeClosed.astro fabrication guard (no follow-up promises)', () => {
  it('finds the Done acknowledgment card source (sanity)', () => {
    expect(() => readFileSync(DONE_CARD_FILE, 'utf-8')).not.toThrow()
  })

  for (const { label, pattern } of DONE_CARD_FABRICATION_PATTERNS) {
    it(`IntakeClosed.astro must not contain: ${label}`, () => {
      const content = stripComments(readFileSync(DONE_CARD_FILE, 'utf-8'))
      expect(pattern.test(content)).toBe(false)
    })
  }
})

// ============================================================================
// Operator marketing page — fenced-term guard.
//
// Four terms are fenced from the Operator SKU marketing copy: "compliant" (no
// compliance claim without counsel review), "AI Workforce" (a competitor
// trademark), "AI Operating System" (a competitor trademark), and "litigation
// insurance" (overclaim). This guard targets the Operator SKU page specifically
// rather than all of src/, where "compliant" can legitimately appear (e.g.
// "WCAG-compliant" in a technical context). Comments are stripped first, so an
// explanatory note that mentions a fenced term does not trip the guard.
// ============================================================================

// The Hosted Agent storefront (ADR 0067) carries the same fenced-term
// exposure as the Operator page, so both SKU pages are scanned.
const SKU_MARKETING_PAGES = [resolve('src/pages/operator.astro'), resolve('src/pages/agent.astro')]
const MARKETING_FENCED_TERMS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: '"compliant" (no compliance claim without counsel review)',
    pattern: /\bcompliant\b/i,
  },
  {
    label: '"AI Workforce" (competitor trademark)',
    pattern: /\bAI Workforce\b/i,
  },
  {
    label: '"AI Operating System" (competitor trademark)',
    pattern: /\bAI Operating System\b/i,
  },
  {
    label: '"litigation insurance" (overclaim)',
    pattern: /\blitigation insurance\b/i,
  },
]

describe('SKU marketing pages fenced-term guard', () => {
  it('finds the SKU page sources (sanity)', () => {
    for (const page of SKU_MARKETING_PAGES) {
      expect(() => readFileSync(page, 'utf-8')).not.toThrow()
    }
  })

  for (const page of SKU_MARKETING_PAGES) {
    for (const { label, pattern } of MARKETING_FENCED_TERMS) {
      it(`${page.split('/').slice(-1)[0]} must not contain fenced term: ${label}`, () => {
        const content = stripComments(readFileSync(page, 'utf-8'))
        expect(pattern.test(content)).toBe(false)
      })
    }
  }
})

describe('user-facing copy guardrails', () => {
  it('finds shipped user-facing Astro surfaces to check (sanity)', () => {
    expect(userFacingSurfaceFiles.length).toBeGreaterThan(0)
  })

  for (const { label, pattern } of USER_FACING_COPY_GUARDS) {
    it(`must enforce: ${label}`, () => {
      const violations: string[] = []
      for (const file of userFacingSurfaceFiles) {
        const content = stripComments(readFileSync(file, 'utf-8'))
        if (pattern.test(content)) {
          violations.push(file.replace(SRC_ROOT, 'src'))
        }
      }
      expect(violations).toEqual([])
    })
  }
})

// ============================================================================
// Portal list-row registry — UI-PATTERNS R7 enforcement.
//
// List-row markup drifted across portal surfaces (proposals, invoices,
// documents) when Stitch generated each screen in isolation. The registry
// collapses the pattern to one component (`PortalListItem.astro`) + two
// helper modules (`src/lib/portal/{formatters,status}.ts`). These tests
// enforce the registry at CI time so drift fails the build, not review.
//
// Scope: every `src/pages/portal/*/index.astro` EXCEPT the home dashboard
// (which iterates its timeline, not list rows). New portal list surfaces
// auto-enroll — explicit exceptions go in LIST_INDEX_ALLOWLIST with a
// comment explaining why.
// ============================================================================

const PORTAL_INDEX_ROOT = resolve('src/pages/portal')
const PORTAL_HOME = resolve('src/pages/portal/index.astro')

/**
 * Allowlist for portal list-index files that legitimately cannot use
 * `PortalListItem` (e.g., because they iterate something that isn't a
 * list-row card — timeline, form fields, milestone rail). Each entry needs
 * a comment explaining why.
 */
const LIST_INDEX_ALLOWLIST: string[] = [
  // `engagement/index.astro` is the engagement DETAIL surface (one
  // engagement per client), not a list of engagements. Its milestone
  // rendering is a vertical-timeline with marker-ring state semantics, not
  // a repeating card — a different primitive than `PortalListItem`. Track
  // as a follow-up if milestone rail drifts or gains a second use.
  resolve('src/pages/portal/engagement/index.astro'),
  // `products/hosted-agent/index.astro` is the Hosted Agent status surface
  // (one subscription per render), not a list of products. Its `.map(` is
  // the setup-journey stepper: numbered steps with whose-move state badges
  // (done / your turn / our team / up next) — milestone-rail semantics like
  // the engagement surface above, not list-row cards.
  resolve('src/pages/portal/products/hosted-agent/index.astro'),
  // `products/operator/index.astro` is the Operator dashboard
  // landing (one customer per render), not a list of products. The
  // small `.map(roles, …)` inside the sidebar renders a bullet list of
  // granted role names (principal / staff / compliance) — text
  // items inside a chrome card, not a list-row card surface.
  resolve('src/pages/portal/products/operator/index.astro'),
  // `products/operator/[instance]/calendar/index.astro` is the Operator
  // calendar agenda (#872). It renders list rows through the
  // dedicated <CalendarItemRow> primitive (mirrors DraftRow's
  // justification — the six-cell calendar vocabulary, time-range /
  // title / type / source / matter / conflict, does not fit
  // PortalListItem's status or document variants). The .map( hits on
  // this page render the filter form's type checkboxes and sort
  // <option>s, not list rows. The agenda itself is rendered through
  // <CalendarAgenda>, which iterates via <CalendarItemRow>.
  resolve('src/pages/portal/products/operator/[instance]/calendar/index.astro'),
  // `products/operator/[instance]/settings/advanced/index.astro` is the
  // customer.yaml editor (#877): a structured FORM, not a list
  // surface. The only `.map(` on the page is the frontmatter
  // `resolved.errors.map((e) => e.path)` call that joins validation-
  // error paths into a status banner. Form sections (PersonaFields,
  // EscalationFields, BusinessHoursFields, ConnectorsFields,
  // ScopeFields) live under
  // `src/components/portal/operator/customer-yaml-editor/` and
  // render typed inputs per field group, not list-row cards. The
  // PortalListItem primitive is the wrong shape here. There is no
  // status/document repeating-card vocabulary to enforce.
  resolve('src/pages/portal/products/operator/[instance]/settings/advanced/index.astro'),
  // `products/operator/[instance]/connections/index.astro` (§5.8) iterates connectors
  // through the dedicated <ConnectionRowCard> primitive, not PortalListItem. A
  // connection row's vocabulary (capability + adapter/health + custody badge +
  // custody description + the operable OAuth/write-only-secret controls) does
  // not fit either of PortalListItem's two variants (status / document). Same
  // justification as DraftRow / MatterRow / AuditEntryRow / CalendarItemRow /
  // NotificationRow. The .map( hits render the read-slot and operable-slot
  // connector lists; both go through <ConnectionRowCard>.
  resolve('src/pages/portal/products/operator/[instance]/connections/index.astro'),
  // `products/operator/[instance]/configure/index.astro` (§5.6) renders config FIELD rows
  // (skill name + on/off, action-class + governance floor) as plain text <li>s
  // inside config section cards — not the PortalListItem status/document
  // repeating-card vocabulary. Same justification as settings/advanced (a
  // structured config surface, not a list of records). The .map( hits iterate
  // the skill list and the action-class governance rows; neither carries a
  // money/status/document cell that PortalListItem's variants model.
  resolve('src/pages/portal/products/operator/[instance]/configure/index.astro'),
  // `products/operator/[instance]/team/index.astro` (§5.7) renders the people-on-this-
  // account roster as identity rows (name + email/last-login, away badge, role
  // chips) inside the dual-mode read/operable slots — not the PortalListItem
  // status/document record-row vocabulary. The .map( iterates members; the
  // people_access domain is Read + Request at launch (ADR 0041).
  resolve('src/pages/portal/products/operator/[instance]/team/index.astro'),
  // `products/operator/[instance]/account/index.astro` (§5.9) renders escalation
  // recipients as plain contact rows (one email per row) inside read-only
  // domain surfaces — not the PortalListItem status/document record-row
  // vocabulary. The .map( iterates authored escalation recipients; subscription
  // is the SMD-only provisioning domain shown as an honest status surface.
  resolve('src/pages/portal/products/operator/[instance]/account/index.astro'),
  // `products/operator/[instance]/settings/index.astro` is the settings hub — a
  // NAVIGATION menu, not a list of records. The `.map(` iterates
  // SETTINGS_LINKS (label + description → link) to render nav rows pointing
  // at the sub-surfaces (Connections / Users / Advanced). Menu links are not
  // the PortalListItem status/document record-row vocabulary; same category
  // as the other Operator sub-pages above.
  resolve('src/pages/portal/products/operator/[instance]/settings/index.astro'),
  // `products/operator/[instance]/onboarding/index.astro` (§6) renders the three
  // get-started steps as numbered guidance cards (step number, title,
  // description, honest status badge) linking to Team/Connections/Calibration —
  // not the PortalListItem status/document record-row vocabulary. The .map(
  // iterates the derived steps; a step with no signal reads "to do", never a
  // fabricated completion.
  resolve('src/pages/portal/products/operator/[instance]/onboarding/index.astro'),
]

/** Collect every `index.astro` under `src/pages/portal/` EXCEPT the home. */
function collectPortalListIndexFiles(): string[] {
  const files: string[] = []
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (entry === 'index.astro' && fullPath !== PORTAL_HOME) {
        files.push(fullPath)
      }
    }
  }
  walk(PORTAL_INDEX_ROOT)
  return files.filter((f) => !LIST_INDEX_ALLOWLIST.includes(f))
}

const portalListIndexFiles = collectPortalListIndexFiles()

describe('portal list-row registry: UI-PATTERNS R7 enforcement', () => {
  it('finds at least one portal list-index file to check (sanity)', () => {
    // If this fails, the file collection logic broke — not the registry.
    expect(portalListIndexFiles.length).toBeGreaterThan(0)
  })

  // ----------------------------------------------------------------
  // Presence assertion.
  //
  // If the file iterates (`.map(`), it must render through
  // `<PortalListItem`. Class-reorder evasion (the Devil's Advocate's
  // objection to "no forbidden markup string" assertions) is defeated
  // because this asserts PRESENCE of the primitive, not absence of
  // specific class strings.
  // ----------------------------------------------------------------
  for (const file of portalListIndexFiles) {
    const rel = file.replace(resolve('.') + '/', '')
    it(`${rel} — must render list rows through <PortalListItem>`, () => {
      const content = readFileSync(file, 'utf-8')
      const iteratesList = /\.map\(/.test(content)
      if (!iteratesList) return // not a list surface, no assertion
      const usesPrimitive = content.includes('<PortalListItem')
      expect(
        usesPrimitive,
        `${rel} iterates with .map( but does not render through <PortalListItem>. ` +
          `Portal list-row markup must go through src/components/portal/PortalListItem.astro.`
      ).toBe(true)
    })
  }

  // ----------------------------------------------------------------
  // No local helper redefinition.
  //
  // Drift starts when a page defines its own formatDate / statusColorMap
  // instead of importing from src/lib/portal/{formatters,status}.ts.
  // Catch it at the declaration site.
  // ----------------------------------------------------------------
  const FORBIDDEN_LOCAL_DECLARATIONS: Array<{ name: string; pattern: RegExp }> = [
    {
      name: 'formatDate',
      pattern: /^\s*(?:const|function)\s+formatDate\b/m,
    },
    {
      name: 'formatCurrency',
      pattern: /^\s*(?:const|function)\s+formatCurrency\b/m,
    },
    {
      name: 'statusColorMap',
      pattern: /^\s*const\s+statusColorMap\b/m,
    },
    {
      name: 'statusLabelMap',
      pattern: /^\s*const\s+statusLabelMap\b/m,
    },
    {
      name: 'typeLabels',
      // Matches `typeLabels` as a standalone const; does NOT match
      // `typeLabel` or `typeLabelMap` (detail pages use those for
      // one-off single-title mapping and are out of scope).
      pattern: /^\s*const\s+typeLabels\s*(?::|=)/m,
    },
  ]

  for (const file of portalListIndexFiles) {
    const rel = file.replace(resolve('.') + '/', '')
    for (const { name, pattern } of FORBIDDEN_LOCAL_DECLARATIONS) {
      it(`${rel} — must not redefine local helper \`${name}\``, () => {
        const content = readFileSync(file, 'utf-8')
        expect(
          pattern.test(content),
          `${rel} declares a local \`${name}\`. Import from ` +
            `src/lib/portal/formatters.ts or src/lib/portal/status.ts instead.`
        ).toBe(false)
      })
    }
  }
})

/**
 * Operator customer.yaml invariants.
 *
 * Guards the exact regression #776 shipped: a customer config with an invalid
 * `hermes_ref` fork tag (`v2026.5.16-smd.0`). Also bans `composio:` backends:
 * composio is retired (ADR 0020, 2026-05-30 revision) and the `composio:` prefix
 * is no longer accepted by the customer.yaml validator — this is a defensive
 * second layer so no committed config can reintroduce it. Narrow on purpose —
 * this guards two invariants, not the full config content (the config is data,
 * not code).
 *
 * @see docs/adr/0020-connector-strategy.md (composio retired)
 * @see docs/adr/0024-hermes-consumption-and-update-cadence.md (hermes_ref pin format)
 */
describe('operator customer.yaml invariants', () => {
  const customersRoot = resolve('operator/customers')
  // v{YYYY}.{M}.{D}@{40-hex-sha} — fork tags like -smd.N do not match.
  const HERMES_REF_RE = /^v\d{4}\.\d{1,2}\.\d{1,2}@[0-9a-f]{40}$/

  function customerYamls(): string[] {
    const out: string[] = []
    let entries: string[]
    try {
      entries = readdirSync(customersRoot)
    } catch {
      return out // no customers dir yet
    }
    for (const entry of entries) {
      if (entry.startsWith('_')) continue // _template scaffold, not a real customer
      const file = join(customersRoot, entry, 'customer.yaml')
      try {
        if (statSync(file).isFile()) out.push(file)
      } catch {
        // no customer.yaml in this dir
      }
    }
    return out
  }

  it('no committed customer.yaml uses a composio: backend or a hermes_ref fork tag', () => {
    for (const file of customerYamls()) {
      const rel = file.replace(resolve('.') + '/', '')
      const content = readFileSync(file, 'utf-8')
      expect(
        content.includes('composio:'),
        `${rel} uses a composio: backend — composio is retired and the prefix is ` +
          `no longer accepted by the validator (ADR 0020).`
      ).toBe(false)
      const match = content.match(/^\s*hermes_ref:\s*['"]?([^'"\n]+?)['"]?\s*$/m)
      if (match) {
        const ref = match[1].trim()
        expect(
          HERMES_REF_RE.test(ref),
          `${rel} hermes_ref "${ref}" is not v{YYYY}.{M}.{D}@{40-hex-sha} ` +
            `(fork tags like -smd.N are rejected per ADR 0024).`
        ).toBe(true)
      }
    }
  })
})

describe('client surfaces render curated activity language only', () => {
  // Portal IA rebuild, Captain decision 7 (2026-07-07): raw runtime audit
  // vocabulary ("INVARIANT_VIOLATION" title-cased to "Invariant Violation")
  // must never render on a client surface. formatAuditAction is the raw
  // mechanical transform and stays admin-side; client surfaces go through
  // src/lib/portal/operator/activity-language.ts (allowlist; unmapped
  // renders nothing).
  const CLIENT_SURFACE_ROOTS = [resolve('src/pages/portal'), resolve('src/components/portal')]

  it('formatAuditAction is not imported by any client surface', () => {
    for (const root of CLIENT_SURFACE_ROOTS) {
      for (const file of collectSourceFiles(root)) {
        const content = readFileSync(file, 'utf-8')
        expect(
          content.includes('formatAuditAction'),
          `${file} references formatAuditAction — client surfaces must use activity-language`
        ).toBe(false)
      }
    }
  })
})

describe('operator client-portal surfaces stay vertical-agnostic (ADR 0052)', () => {
  // The Operator is a vertical-agnostic product (ADR 0052): client-portal
  // surfaces must not reintroduce law-vertical vocabulary or demo persona
  // names. A regression here means the "Matters"/case-data model or a hardcoded
  // persona crept back onto a shipped surface.
  //
  // Scope is the CLIENT portal only. Deliberately excluded:
  //   - the customer.yaml editor (customer-yaml-editor/): it authors per-customer
  //     config whose field names (e.g. matter_blocks for a law customer) are
  //     legitimate vertical config, not product structure — the same out-of-scope
  //     category as capability adapters and practice_areas (ADR 0052 "Out of
  //     scope").
  //   - the admin console (src/pages/admin/**): it observes/authors one specific,
  //     possibly-law customer, so per-customer law values are legitimate there.
  const OPERATOR_SURFACE_ROOTS = [
    resolve('src/pages/portal/products/operator'),
    resolve('src/components/portal/operator'),
  ]
  const EDITOR_EXCLUDE = resolve('src/components/portal/operator/customer-yaml-editor')

  const BANNED: ReadonlyArray<{ re: RegExp; label: string }> = [
    {
      re: /\bmatters?\b/i,
      label: 'matter(s) — use the generic opaque object reference (ADR 0052 §6)',
    },
    { re: /\bdeposition\b/i, label: 'deposition — law-vertical vocabulary' },
    { re: /\bhearing\b/i, label: 'hearing — law-vertical vocabulary' },
    { re: /\b(?:pre_suit|pre_trial)\b/i, label: 'PI litigation phase enum (ADR 0052)' },
    { re: /\bMarcus\b/, label: 'Marcus — demo persona name' },
    { re: /\bSusan\b/, label: 'Susan — demo persona name' },
  ]

  function operatorSurfaceFiles(): string[] {
    return OPERATOR_SURFACE_ROOTS.flatMap((root) => collectSourceFiles(root)).filter(
      (f) => !isWithinDir(f, EDITOR_EXCLUDE)
    )
  }

  it('no law-vertical vocabulary or persona names on client-portal operator surfaces', () => {
    const violations: string[] = []
    for (const file of operatorSurfaceFiles()) {
      const rel = file.replace(resolve('.') + '/', '')
      const content = readFileSync(file, 'utf-8')
      for (const { re, label } of BANNED) {
        if (re.test(content)) violations.push(`${rel}: ${label}`)
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Calm register — UI-PATTERNS Rule 8 enforcement.
//
// The console (client portal + admin) renders in the calm Plainspoken
// register: white raised cards, hairline borders, sentence-case headings.
// The loud markers below are the marketing register bleeding into a console
// and are banned on every migrated console surface.
//
// CALM_REGISTER_PENDING is the set of console files still permitted to be
// loud. It starts as the full loud-file set and SHRINKS with each migration
// slice; the end state is an empty list — whole console calm, guard fully
// enforcing. The list only shrinks. New console files are enforced from day
// one (they are not in PENDING), so loudness cannot re-enter the codebase.
// ---------------------------------------------------------------------------
const CONSOLE_ROOTS = [
  resolve('src/pages/portal'),
  resolve('src/components/portal'),
  resolve('src/pages/admin'),
  resolve('src/components/admin'),
]

const LOUD_MARKERS: { re: RegExp; label: string }[] = [
  { re: /border-\[3px\]/, label: 'border-[3px] (use `border` / --color-border hairline)' },
  { re: /\bfont-black\b/, label: 'font-black (use text-title/text-heading token weights)' },
]

// Comments are stripped (via the shared stripComments above) before scanning
// so a file that merely *documents* a loud marker — like the primitives' doc
// blocks — is not flagged. Only real class usage should trip the guard.
const CALM_REGISTER_PENDING: string[] = [
  // Operator landing reverted to the loud register per Captain (2026-07-08):
  // keep the Status/Role/Management content, drop the calm register for now.
  'src/pages/portal/products/operator/index.astro',
  'src/pages/portal/products/operator/[instance]/index.astro',
  'src/components/portal/operator/facets/OperatorHero.astro',
  'src/components/portal/operator/FacetDoorList.astro',
  'src/components/admin/EntityContactRow.astro',
  'src/components/admin/EntityIdentityStrip.astro',
  'src/components/admin/HostedAgentQueueCard.astro',
  'src/components/portal/HomeOfferingCard.astro',
  'src/components/portal/operator/AuditEntryRow.astro',
  'src/components/portal/operator/AuditFilterBar.astro',
  'src/components/portal/operator/AuditLogTable.astro',
  'src/components/portal/operator/CalendarAgenda.astro',
  'src/components/portal/operator/CalendarItemRow.astro',
  'src/components/portal/operator/ConnectionRowCard.astro',
  'src/components/portal/operator/ConnectorStatusSection.astro',
  'src/components/portal/operator/customer-yaml-editor/BusinessHoursFields.astro',
  'src/components/portal/operator/customer-yaml-editor/ConnectorRow.astro',
  'src/components/portal/operator/customer-yaml-editor/ConnectorsFields.astro',
  'src/components/portal/operator/customer-yaml-editor/EscalationFields.astro',
  'src/components/portal/operator/customer-yaml-editor/PersonaFields.astro',
  'src/components/portal/operator/customer-yaml-editor/PersonaRow.astro',
  'src/components/portal/operator/customer-yaml-editor/ScopeFields.astro',
  'src/components/portal/operator/PromotionCard.astro',
  'src/components/portal/operator/SkillTogglesSection.astro',
  'src/components/portal/operator/TrustCeilingSection.astro',
  'src/components/portal/operator/VoiceSamplesSection.astro',
  'src/components/portal/PortalListItem.astro',
  'src/components/portal/PortalPageHead.astro',
  'src/components/portal/QuoteProposalSections.astro',
  'src/pages/admin/hosted-agent/index.astro',
  'src/pages/portal/billing/index.astro',
  'src/pages/portal/engagement/[id].astro',
  'src/pages/portal/engagement/documents/index.astro',
  'src/pages/portal/engagement/index.astro',
  'src/pages/portal/engagement/proposals/[id].astro',
  'src/pages/portal/index.astro',
  'src/pages/portal/products/hosted-agent/api-key.astro',
  'src/pages/portal/products/hosted-agent/index.astro',
  'src/pages/portal/products/hosted-agent/intake.astro',
  'src/pages/portal/products/operator/[instance]/account/index.astro',
  'src/pages/portal/products/operator/[instance]/activity/index.astro',
  'src/pages/portal/products/operator/[instance]/calendar/index.astro',
  'src/pages/portal/products/operator/[instance]/compliance/index.astro',
  'src/pages/portal/products/operator/[instance]/configure/index.astro',
  'src/pages/portal/products/operator/[instance]/connections/index.astro',
  'src/pages/portal/products/operator/[instance]/onboarding/index.astro',
  'src/pages/portal/products/operator/[instance]/settings/advanced/index.astro',
  'src/pages/portal/products/operator/[instance]/settings/index.astro',
  'src/pages/portal/products/operator/[instance]/settings/users.astro',
  'src/pages/portal/products/operator/[instance]/team/index.astro',
]

// PENDING entries are repo-relative paths; the collected files are absolute.
// relOf normalizes an absolute path to the repo-relative form for comparison
// (constant `resolve('.')` only — no variable ever enters path.join/resolve).
function relOf(absPath: string): string {
  return absPath.replace(resolve('.') + '/', '')
}

describe('calm register: UI-PATTERNS R8 enforcement', () => {
  const migrated = CONSOLE_ROOTS.flatMap((root) =>
    existsSync(root) ? collectSourceFiles(root) : []
  ).filter((f) => !CALM_REGISTER_PENDING.includes(relOf(f)))

  it('finds migrated console files to check (sanity)', () => {
    expect(migrated.length).toBeGreaterThan(0)
  })

  for (const file of migrated) {
    const rel = relOf(file)
    it(`${rel} — no loud markers (Rule 8)`, () => {
      const src = stripComments(readFileSync(file, 'utf-8'))
      const hits = LOUD_MARKERS.filter(({ re }) => re.test(src)).map(({ label }) => label)
      expect(hits, `${rel} still loud: ${hits.join(', ')}`).toEqual([])
    })
  }

  // Keep PENDING honest: every entry must still exist AND still be loud. Once a
  // file is migrated clean, it MUST be removed from PENDING (else the list would
  // silently mask a now-clean file and the guard would never enforce it). The
  // relative paths are read relative to cwd (tests run from the repo root).
  it('CALM_REGISTER_PENDING has no stale entries (migrated files must be removed)', () => {
    const stale: string[] = []
    for (const rel of CALM_REGISTER_PENDING) {
      if (!existsSync(rel)) {
        stale.push(`${rel} (no longer exists)`)
        continue
      }
      const src = stripComments(readFileSync(rel, 'utf-8'))
      const stillLoud = LOUD_MARKERS.some(({ re }) => re.test(src))
      if (!stillLoud) stale.push(`${rel} (now clean — remove from PENDING)`)
    }
    expect(stale, `stale PENDING entries:\n${stale.join('\n')}`).toEqual([])
  })
})
