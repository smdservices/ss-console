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
