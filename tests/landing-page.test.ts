import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const srcDir = resolve('src')
const componentsDir = resolve('src/components')

function readComponent(name: string): string {
  return readFileSync(join(componentsDir, name), 'utf-8')
}

function readAllSrcFiles(): string[] {
  const files: string[] = []
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.name.endsWith('.astro') || entry.name.endsWith('.ts')) {
        files.push(fullPath)
      }
    }
  }
  walk(srcDir)
  return files
}

// Marketing surfaces. The "no dollar amounts" check below applies to these
// files. The Operator SKU page (src/pages/operator.astro) is included:
// as of 2026-05-30 we pulled the published $5,000/mo price and route pricing
// to the first conversation, so no dollar amount may appear on that surface
// either. New marketing sections SHOULD be added here so a future edit cannot
// accidentally publish a price.
function readMarketingFiles(): string[] {
  return [
    resolve('src/pages/index.astro'),
    resolve('src/pages/operator.astro'),
    resolve('src/pages/consulting.astro'),
    resolve('src/pages/why.astro'),
    resolve('src/pages/ai.astro'),
    resolve('src/pages/packs/law-firm.astro'),
    resolve('src/pages/packs/insurance.astro'),
    resolve('src/pages/packs/veterinary.astro'),
    resolve('src/pages/packs/title.astro'),
    resolve('src/pages/packs/accounting.astro'),
    resolve('src/pages/packs/ria.astro'),
    resolve('src/pages/packs/mortgage.astro'),
    resolve('src/pages/packs/dental.astro'),
    resolve('src/pages/packs/med-spa.astro'),
    resolve('src/pages/packs/marketing-agency.astro'),
    resolve('src/pages/packs/property-management.astro'),
    resolve('src/pages/packs/home-services.astro'),
    join(componentsDir, 'OperatorHero.astro'),
    join(componentsDir, 'ConsultingPath.astro'),
    join(componentsDir, 'Hero.astro'),
    join(componentsDir, 'ProblemCards.astro'),
    join(componentsDir, 'RoiMath.astro'),
    join(componentsDir, 'HowWeEngage.astro'),
    join(componentsDir, 'HowWePrice.astro'),
    join(componentsDir, 'WhatYouGet.astro'),
    join(componentsDir, 'OperatorIntro.astro'),
    join(componentsDir, 'CaseStudies.astro'),
    join(componentsDir, 'About.astro'),
    join(componentsDir, 'FinalCta.astro'),
    join(componentsDir, 'Footer.astro'),
    join(componentsDir, 'JsonLd.astro'),
  ]
}

describe('component existence', () => {
  const expectedComponents = [
    'CtaButton.astro',
    'Hero.astro',
    'ProblemCards.astro',
    'RoiMath.astro',
    'HowWeEngage.astro',
    'HowWePrice.astro',
    'WhatYouGet.astro',
    'CaseStudies.astro',
    'About.astro',
    'FinalCta.astro',
    'Footer.astro',
    'JsonLd.astro',
  ]

  it.each(expectedComponents)('%s exists', (component) => {
    expect(existsSync(join(componentsDir, component))).toBe(true)
  })
})

describe('content integrity', () => {
  it('no dollar amounts published in marketing content', () => {
    const files = readMarketingFiles()
    const dollarPattern = /\$[\d,]+/
    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8')
      expect(content, `Dollar amount found in ${filePath}`).not.toMatch(dollarPattern)
    }
  })
})

describe('voice standard', () => {
  // About.astro is intentionally excluded: SMD is positioned as a practitioner
  // firm (lawyer / doctor / craftsman model) where the founder *is* the firm.
  // §07 Who We Are uses Scott's first-person voice; the rest of the page stays
  // in firm-level "we" voice. See CLAUDE.md "Voice standard" practitioner-firm
  // exception.
  const marketingComponents = [
    'OperatorHero.astro',
    'ConsultingPath.astro',
    'Hero.astro',
    'ProblemCards.astro',
    'RoiMath.astro',
    'HowWeEngage.astro',
    'HowWePrice.astro',
    'WhatYouGet.astro',
    'FinalCta.astro',
  ]

  // Operator-forward home and the /why manifesto carry the lead argument as
  // long-form page prose, not components. They must hold the same firm-level
  // "we" voice. Decision (Operator-forward redesign): keep the strict component
  // regex and constrain page copy to pass it, rather than loosen the guardrail
  // for pages. First-person "I" stays confined to the test-excluded About.astro
  // component; it is never inlined into these page files.
  const marketingPages = ['src/pages/index.astro', 'src/pages/why.astro']

  // Shared scan: flag standalone first-person "I " in the author's voice, after
  // stripping quoted spans (owner quotes such as "I can't take a day off" are
  // allowed). Identical heuristic for components and pages.
  function scanFirstPerson(content: string, label: string) {
    const lines = content.split('\n')
    for (const line of lines) {
      if (line.includes('quote:') || line.includes('"I ') || line.includes("'I ")) continue
      const stripped = line.replace(/['"][^'"]*['"]/g, '')
      expect(stripped, `First-person "I " found in ${label}: ${line.trim()}`).not.toMatch(
        /\bI\s(?!can't|don't|have|personally|text)/
      )
    }
  }

  it.each(marketingComponents)('%s does not use first-person singular "I "', (component) => {
    scanFirstPerson(readComponent(component), component)
  })

  it.each(marketingPages)('%s does not use first-person singular "I "', (page) => {
    scanFirstPerson(readFileSync(resolve(page), 'utf-8'), page)
  })
})

describe('operator-forward home integrity', () => {
  // Encodes the new IA: the apex home leads with the Operator and keeps the
  // secondary consulting path and the manifesto reachable. Replaces the implicit
  // "home is consulting" contract that demoting the consulting components removed.
  const home = readFileSync(resolve('src/pages/index.astro'), 'utf-8')

  it('home composes the Operator-forward lead hero', () => {
    expect(home).toContain('OperatorHero')
  })

  it('home routes the primary CTA to the Operator intake', () => {
    expect(home).toContain('/book?interest=operator')
  })

  it('home keeps the secondary consulting path reachable', () => {
    expect(home).toContain('ConsultingPath')
  })

  it('home links to the category manifesto', () => {
    expect(home).toContain('/why')
  })
})

describe('locked positioning spine', () => {
  // Encodes the locks in docs/marketing/positioning-spine.md so a future rebuild
  // cannot silently reverse a Captain-locked decision and still pass `npm run verify`.
  // The marketing site went in circles (#1534/#1538/#1541/#1543) because the locks
  // were prose, not guardrails. These are the load-bearing ones.
  // Prettier wraps prose across lines, so phrase assertions normalize runs of
  // whitespace to a single space (and lowercase) before matching.
  const flat = (s: string) => s.replace(/\s+/g, ' ').toLowerCase()
  const operatorHero = flat(readComponent('OperatorHero.astro'))
  const home = flat(readFileSync(resolve('src/pages/index.astro'), 'utf-8'))
  const whyRaw = readFileSync(resolve('src/pages/why.astro'), 'utf-8')
  const why = flat(whyRaw)
  const operator = flat(readFileSync(resolve('src/pages/operator.astro'), 'utf-8'))

  it('home hero is symptom-led: it names a concrete leak', () => {
    // The §2 nesting step 1 — hook the symptom in the buyer's words, not a bare
    // abstraction. Do not revert the hero to a context-free gap statement.
    expect(operatorHero).toContain("everyone's job and no one's")
  })

  it('home hero resolves the symptom to the gap', () => {
    // §2 nesting step 2 — the named leak resolves to the gap. Do not strip this so
    // the hero becomes a generic pain list with no category.
    expect(operatorHero).toContain('the gap between your people and your software')
  })

  it('home surfaces the forwardable "fills the gap" definition', () => {
    expect(home).toContain('fills the gap')
  })

  it('/operator bridges from the gap rather than opening on a disconnected metaphor', () => {
    // /operator must tie back to the home's framing before going to mechanism.
    expect(operator).toContain('the gap between your people and your software')
  })

  it('/why keeps the comparison FAQ', () => {
    expect(whyRaw).toContain('FAQPage')
  })

  it('/why also carries the conviction beat (it is not a pure FAQ)', () => {
    // /why must still earn belief — the gap, stated respectfully. Locked synthesis:
    // keep #1541's FAQ AND restore one conviction beat.
    expect(why).toContain('no single tool was ever built to do the work between')
  })

  it('single primary verb across the spine surfaces', () => {
    for (const [label, content] of [
      ['OperatorHero.astro', operatorHero],
      ['index.astro', home],
      ['operator.astro', operator],
      ['why.astro', why],
    ] as const) {
      expect(content, `"Start the conversation" missing from ${label}`).toContain(
        'start the conversation'
      )
    }
  })
})

describe('JSON-LD schema', () => {
  it('JsonLd.astro contains LocalBusiness type', () => {
    const content = readComponent('JsonLd.astro')
    expect(content).toContain('LocalBusiness')
  })

  it('JsonLd.astro contains schema.org context', () => {
    const content = readComponent('JsonLd.astro')
    expect(content).toContain('https://schema.org')
  })
})

describe('decision compliance', () => {
  it('no "free assessment" language in any src file', () => {
    const files = readAllSrcFiles()
    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8').toLowerCase()
      expect(content, `"free assessment" found in ${filePath}`).not.toContain('free assessment')
      expect(content, `"free consultation" found in ${filePath}`).not.toContain('free consultation')
    }
  })

  it('no deprecated "team_invisibility" in src/', () => {
    const files = readAllSrcFiles()
    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8')
      expect(content, `"team_invisibility" found in ${filePath}`).not.toContain('team_invisibility')
      expect(content.toLowerCase(), `"team invisibility" found in ${filePath}`).not.toContain(
        'team invisibility'
      )
    }
  })

  it('no "the consultant" language in marketing components', () => {
    const files = readAllSrcFiles()
    for (const filePath of files) {
      if (!filePath.endsWith('.astro')) continue
      const content = readFileSync(filePath, 'utf-8').toLowerCase()
      expect(content, `"the consultant" found in ${filePath}`).not.toContain('the consultant')
    }
  })
})
