/**
 * Boundary tests for vertical-aware outreach generation (issue #594).
 *
 * The outreach prompt is a single shared backbone. When a recognized vertical
 * is supplied, a small per-vertical guidance block is appended that names the
 * general operational pain areas that vertical commonly faces. These tests
 * lock in the contract:
 *
 * 1. Per-vertical specificity — each vertical's guidance leans on its own
 *    pain backbone (contractor estimating/scheduling, salon scheduling/
 *    communication, etc.) but uses the SAME backbone system prompt.
 * 2. Generic fallback — when vertical is null/undefined/unrecognized, the
 *    generic backbone is returned with no vertical-specific block.
 * 3. Anti-fabrication — the per-vertical guidance contains NO invented
 *    specifics (no fake numbers, no fake names, no fake events).
 * 4. Taxonomy boundary — vertical guidance speaks 5-cat observation IDs
 *    (process_design, tool_systems, data_visibility, customer_pipeline,
 *    team_operations), never the 6-cat marketing delivery taxonomy.
 *
 * @see docs/adr/0001-taxonomy-two-layer-model.md
 * @see CLAUDE.md — "Pain Clusters by Vertical", "No fabricated client-facing content"
 * @see https://github.com/venturecrane/ss-console/issues/594
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  buildOutreachSystemPrompt,
  normalizeVertical,
  type OutreachVertical,
} from '../src/lib/claude/outreach.js'

const RECOGNIZED_VERTICALS: OutreachVertical[] = [
  'home_services',
  'professional_services',
  'contractor_trades',
  'retail_salon',
  'restaurant_food',
]

// ---------------------------------------------------------------------------
// Generic backbone — what every prompt shares regardless of vertical.
// Asserting these phrases are present in EVERY prompt variant (with or
// without vertical guidance) is how we lock "shared backbone, injected
// specifics" as the architecture.
// ---------------------------------------------------------------------------
const BACKBONE_MARKERS = [
  // Voice / Decision Stack #20
  '"we" / "our team."',
  // Tone & Positioning rule 1 — objectives over problems
  'GIVE THEM SOMETHING',
  // Tone & Positioning rule 3 — no timeframes
  'No dollar amounts. No pricing. No timeframes.',
  // Anti-fabrication rule
  'Anti-fabrication rule (CRITICAL)',
  // Sign-off
  '-- The SMD Services team',
]

describe('outreach: shared backbone is present in all prompt variants', () => {
  it('generic prompt (no vertical) contains every backbone marker', () => {
    const prompt = buildOutreachSystemPrompt(null)
    for (const marker of BACKBONE_MARKERS) {
      expect(prompt, `generic prompt missing backbone marker "${marker}"`).toContain(marker)
    }
  })

  for (const vertical of RECOGNIZED_VERTICALS) {
    it(`${vertical} prompt contains every backbone marker`, () => {
      const prompt = buildOutreachSystemPrompt(vertical)
      for (const marker of BACKBONE_MARKERS) {
        expect(
          prompt,
          `${vertical} prompt missing backbone marker "${marker}" — backbone must be shared across all variants`
        ).toContain(marker)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Per-vertical specificity — each vertical injects its OWN pain backbone.
// CLAUDE.md "Pain Clusters by Vertical" defines the entry-point pain areas
// per vertical; these assertions lock the prompt to that table.
// ---------------------------------------------------------------------------
describe('outreach: per-vertical guidance leans on the right pain backbone', () => {
  it('contractor_trades references contractor pain (estimating, scheduling, retention)', () => {
    const prompt = buildOutreachSystemPrompt('contractor_trades')
    // CLAUDE.md row: "Contractor/trades — Estimating/quoting + scheduling + employee retention"
    expect(prompt.toLowerCase()).toContain('estimating')
    expect(prompt.toLowerCase()).toMatch(/scheduling|crews/)
    expect(prompt.toLowerCase()).toMatch(/field staff|seasons|retention|keeping/)
  })

  it('retail_salon references salon pain (scheduling, communication, financial visibility)', () => {
    const prompt = buildOutreachSystemPrompt('retail_salon')
    // CLAUDE.md row: "Retail/salon/spa — Scheduling + communication + financial visibility"
    expect(prompt.toLowerCase()).toMatch(/booking|scheduling/)
    expect(prompt.toLowerCase()).toMatch(/front-desk|workflows|client/)
    expect(prompt.toLowerCase()).toMatch(/revenue|margin|measured/)
  })

  it('restaurant_food references restaurant pain (team comms, inventory, financial visibility)', () => {
    const prompt = buildOutreachSystemPrompt('restaurant_food')
    // CLAUDE.md row: "Restaurant/food service — Team communication + inventory + financial visibility"
    expect(prompt.toLowerCase()).toMatch(/communication|shifts|foh|boh/)
    expect(prompt.toLowerCase()).toMatch(/pos|inventory|tools/)
    expect(prompt.toLowerCase()).toMatch(/food cost|labor|prime cost/)
  })

  it('home_services references home services pain (scheduling, lead follow-up, retention)', () => {
    const prompt = buildOutreachSystemPrompt('home_services')
    // CLAUDE.md row: "Home services (plumber, HVAC) — Scheduling + lead follow-up + employee retention"
    expect(prompt.toLowerCase()).toMatch(/leads|follow-up|phone|text/)
    expect(prompt.toLowerCase()).toMatch(/dispatch|schedule|crews/)
    expect(prompt.toLowerCase()).toMatch(/techs|finding|keeping/)
  })

  it('professional_services references pro services pain (owner bottleneck, manual comms, pipeline)', () => {
    const prompt = buildOutreachSystemPrompt('professional_services')
    // CLAUDE.md row: "Professional services (accountant, attorney) — Owner bottleneck + manual communication + pipeline"
    expect(prompt.toLowerCase()).toMatch(/bottleneck|delegable/)
    expect(prompt.toLowerCase()).toMatch(/manual communication|email threads|phone tag/)
    expect(prompt.toLowerCase()).toMatch(/utilization|pipeline|spreadsheet/)
  })
})

// ---------------------------------------------------------------------------
// Per-vertical contracts are DISTINCT from each other.
// ---------------------------------------------------------------------------
describe('outreach: per-vertical guidance is distinct per vertical', () => {
  it('every recognized vertical produces a unique system prompt', () => {
    const seen = new Map<string, OutreachVertical>()
    for (const vertical of RECOGNIZED_VERTICALS) {
      const prompt = buildOutreachSystemPrompt(vertical)
      const prior = seen.get(prompt)
      expect(
        prior,
        `${vertical} produced an identical prompt to ${prior} — guidance must vary per vertical`
      ).toBeUndefined()
      seen.set(prompt, vertical)
    }
  })

  it('every per-vertical prompt is longer than the generic prompt', () => {
    const generic = buildOutreachSystemPrompt(null)
    for (const vertical of RECOGNIZED_VERTICALS) {
      const prompt = buildOutreachSystemPrompt(vertical)
      expect(
        prompt.length,
        `${vertical} prompt should append vertical guidance, growing the prompt`
      ).toBeGreaterThan(generic.length)
    }
  })
})

// ---------------------------------------------------------------------------
// Generic backbone fallback — null / undefined / unrecognized => no
// vertical guidance. This is the no-fabrication contract: when we don't
// know the vertical, we don't guess.
// ---------------------------------------------------------------------------
describe('outreach: generic backbone fallback for unknown verticals', () => {
  it('null vertical returns the generic prompt verbatim (no vertical block)', () => {
    const generic = buildOutreachSystemPrompt(null)
    expect(generic).not.toContain('## Vertical context:')
  })

  it('normalizeVertical returns null for null / undefined / empty', () => {
    expect(normalizeVertical(null)).toBeNull()
    expect(normalizeVertical(undefined)).toBeNull()
    expect(normalizeVertical('')).toBeNull()
  })

  it('normalizeVertical returns null for unrecognized verticals', () => {
    // 'healthcare', 'technology', 'manufacturing', 'other' are valid Vertical
    // values per src/portal/assessments/extraction-schema.ts but are NOT in
    // CLAUDE.md "Pain Clusters by Vertical" — outreach has no authored
    // backbone for them, so they fall back to the generic prompt.
    expect(normalizeVertical('healthcare')).toBeNull()
    expect(normalizeVertical('technology')).toBeNull()
    expect(normalizeVertical('manufacturing')).toBeNull()
    expect(normalizeVertical('other')).toBeNull()
    expect(normalizeVertical('not_a_real_vertical')).toBeNull()
  })

  it('normalizeVertical recognizes all 5 supported verticals', () => {
    for (const vertical of RECOGNIZED_VERTICALS) {
      expect(normalizeVertical(vertical)).toBe(vertical)
    }
  })

  it('unrecognized vertical strings produce the generic prompt', () => {
    const generic = buildOutreachSystemPrompt(null)
    // Simulate the path generateOutreachDraft takes for these inputs.
    const fromHealthcare = buildOutreachSystemPrompt(normalizeVertical('healthcare'))
    const fromOther = buildOutreachSystemPrompt(normalizeVertical('other'))
    const fromGarbage = buildOutreachSystemPrompt(normalizeVertical('foo_bar_baz'))
    expect(fromHealthcare).toBe(generic)
    expect(fromOther).toBe(generic)
    expect(fromGarbage).toBe(generic)
  })
})

// ---------------------------------------------------------------------------
// Anti-fabrication contract — the per-vertical guidance backbone must NOT
// contain invented prospect-specific details (numbers, names, events,
// claimed conversations). This locks the architecture: the backbone is
// register/language hints; specifics come from the assembled enrichment
// context, not the prompt.
// ---------------------------------------------------------------------------
describe('outreach: per-vertical guidance contains no fabricated specifics', () => {
  // Patterns that would indicate the prompt is inventing prospect-specific
  // facts. If any per-vertical block adds, say, "your 3-truck operation"
  // or "the conversation you had at the Vistage breakfast", these regexes
  // catch the drift at CI time.
  const FABRICATION_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
    {
      name: 'specific employee/truck/crew counts',
      // matches "your 3-truck", "the 12-person team", "10 employees"
      // Avoids matching "10-25 employees" in the corp backbone (wider regex
      // around it would, so we only match this in vertical blocks below).
      pattern:
        /\b(?:your|the)\s+\d+[-\s](?:truck|person|employee|crew|chair|location|seat|table|tech)/i,
    },
    {
      name: 'specific event or meeting reference',
      pattern:
        /\b(?:at|during)\s+the\s+(?:Vistage|EO|trade show|conference|breakfast|lunch|meeting|event)/i,
    },
    {
      name: 'specific claimed conversation',
      pattern: /(?:you\s+(?:mentioned|told\s+us|said|shared)\s+(?:on|at|during|last|in|that))/i,
    },
    {
      name: 'specific dollar amount',
      pattern: /\$\d/,
    },
    {
      name: 'specific date or month reference',
      pattern:
        /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d/,
    },
    {
      name: 'specific named person (capitalized first + last name pattern)',
      // Avoids matching SMD Services / Phoenix etc. by requiring two
      // consecutive capitalized words that aren't a known proper noun.
      pattern: /\b(?:Mr|Mrs|Ms|Dr)\.\s+[A-Z]/,
    },
  ]

  for (const vertical of RECOGNIZED_VERTICALS) {
    it(`${vertical} guidance does not invent prospect-specific facts`, () => {
      const generic = buildOutreachSystemPrompt(null)
      const withVertical = buildOutreachSystemPrompt(vertical)
      // Isolate the vertical block — only assert against what was added,
      // so we don't false-positive on backbone content.
      const verticalBlock = withVertical.slice(generic.length)
      for (const { name, pattern } of FABRICATION_PATTERNS) {
        expect(
          pattern.test(verticalBlock),
          `${vertical} vertical block contains fabrication pattern "${name}". ` +
            `Per-vertical guidance must be backbone language only — never invent specifics.`
        ).toBe(false)
      }
    })
  }

  // Snapshot-shaped structural lock: the per-vertical block has a stable
  // shape ("## Vertical context: ..." header, three observation-area
  // bullets, anti-fabrication footer). This catches accidental shape
  // drift across all 5 verticals at once.
  it('every vertical block follows the same structural shape', () => {
    const generic = buildOutreachSystemPrompt(null)
    for (const vertical of RECOGNIZED_VERTICALS) {
      const block = buildOutreachSystemPrompt(vertical).slice(generic.length).trim()
      // Header
      expect(block, `${vertical} block missing vertical-context header`).toMatch(
        /^## Vertical context:/
      )
      // Observation-area bullets — each block has exactly 3
      const bullets = block.split('\n').filter((line) => /^- [a-z_]+ —/.test(line))
      expect(
        bullets.length,
        `${vertical} block should have 3 observation-area bullets, got ${bullets.length}`
      ).toBe(3)
      // Anti-fabrication footer
      expect(block, `${vertical} block missing anti-fabrication footer`).toContain(
        'do not invent specifics'
      )
    }
  })
})

// ---------------------------------------------------------------------------
// Taxonomy boundary — per-vertical guidance must speak the 5-cat
// observation taxonomy, NEVER the 6-cat marketing delivery taxonomy.
// Mirrors tests/taxonomy-boundary.test.ts but scoped to outreach.ts.
//
// The shipped tests/taxonomy-boundary.test.ts already covers
// src/lead-gen/prompts/* — this extends the lock to the outreach prompt
// authored by issue #594.
// ---------------------------------------------------------------------------
describe('outreach: vertical guidance respects ADR 0001 taxonomy boundary', () => {
  // 5-cat observation IDs — the language outreach speaks.
  const OBSERVATION_IDS = [
    'process_design',
    'tool_systems',
    'data_visibility',
    'customer_pipeline',
    'team_operations',
  ]

  // 6-cat marketing delivery taxonomy — forbidden in outreach.
  const FORBIDDEN_DELIVERY_IDS = [
    'custom_internal_tools',
    'systems_integration',
    'operational_visibility',
    'vendor_platform_selection',
    'ai_automation',
  ]
  const FORBIDDEN_DELIVERY_PHRASES = [
    'Custom internal tools',
    'Vendor/platform selection',
    'Systems integration',
    'Operational visibility',
  ]

  it('outreach.ts source does not reference forbidden delivery taxonomy IDs', () => {
    const src = readFileSync(resolve('src/lib/claude/outreach.ts'), 'utf-8')
    for (const id of FORBIDDEN_DELIVERY_IDS) {
      expect(
        src,
        `outreach.ts references marketing delivery ID "${id}" — forbidden by ADR 0001`
      ).not.toContain(id)
    }
  })

  it('outreach.ts source does not contain forbidden delivery taxonomy phrases', () => {
    const src = readFileSync(resolve('src/lib/claude/outreach.ts'), 'utf-8')
    for (const phrase of FORBIDDEN_DELIVERY_PHRASES) {
      expect(
        src,
        `outreach.ts contains marketing delivery phrase "${phrase}" — forbidden by ADR 0001`
      ).not.toContain(phrase)
    }
  })

  it('vertical guidance collectively references at least 4 of the 5 observation IDs', () => {
    // Not every vertical has to name every observation area — that would
    // flatten the per-vertical signal. But across all 5 verticals, the
    // guidance should cover most of the taxonomy. Lock at >=4/5 so a
    // future regression that drops to "everything is process_design"
    // fails CI.
    const allBlocks = RECOGNIZED_VERTICALS.map((v) =>
      buildOutreachSystemPrompt(v).slice(buildOutreachSystemPrompt(null).length)
    ).join('\n')
    const referenced = OBSERVATION_IDS.filter((id) => allBlocks.includes(id))
    expect(
      referenced.length,
      `Only ${referenced.length} observation IDs referenced across all vertical blocks: ${referenced.join(', ')}. Need at least 4.`
    ).toBeGreaterThanOrEqual(4)
  })
})

// ---------------------------------------------------------------------------
// Wiring contract — regenerateOutreach() in src/lib/enrichment/index.ts
// must thread entity.vertical through to generateOutreachDraft().
// Without this, the prompt is vertical-aware but the runtime never uses
// the parameter.
// ---------------------------------------------------------------------------
describe('outreach: enrichment pipeline threads entity.vertical', () => {
  // tryOutreach / regenerateOutreach were extracted to enrichment-advanced.ts
  // and re-exported from index.ts to keep it within the 500-line ceiling.
  const enrichmentSrc = () =>
    readFileSync(resolve('src/lib/enrichment/index.ts'), 'utf-8') +
    '\n' +
    readFileSync(resolve('src/lib/enrichment/enrichment-advanced.ts'), 'utf-8')

  it('regenerateOutreach passes entity.vertical to generateOutreachDraft', () => {
    const src = enrichmentSrc()
    // The 4-arg signature is the contract: apiKey, entityName, context, vertical.
    expect(
      src,
      'regenerateOutreach must pass entity.vertical as the 4th arg to generateOutreachDraft'
    ).toMatch(/generateOutreachDraft\([\s\S]{0,200}?entity\.vertical/)
  })

  it('regenerateOutreach records vertical in outreach_draft metadata', () => {
    // Auditability — re-runs and audits should see which variant ran.
    const src = enrichmentSrc()
    expect(src).toMatch(/vertical:\s*entity\.vertical\s*\?\?\s*null/)
  })
})
