/**
 * The console → vault writer for authored output-class specs (ADR 0083, #2089).
 *
 * Three properties are load-bearing enough that a regression would be silent
 * and would reach a client's running Operator:
 *
 *  1. ONE KEY SPACE. This module writes `vaults/<slug>/output-classes.json`
 *     and can address nothing else. `customer.yaml` beside it is
 *     git-authoritative and published by CI; a portal write there would be
 *     clobbered by the next unrelated merge to that slug. The mirror-image
 *     guard lives in `tests/config-publish-guards.test.ts`.
 *  2. THE HASH IS COMPUTED HERE. A digest arriving with a request is never
 *     read; the one written beside each body is computed over the bytes about
 *     to be written.
 *  3. NO SUCCESS FOR A WRITE THAT DID NOT HAPPEN. `writeSpecDocument` reports
 *     ok only after reading the object back byte-identical.
 *  4. THE STORED BYTES ARE LF-ONLY. A browser textarea submits CRLF. Nothing
 *     would fail loudly if it survived — the digest matches its own CRLF body,
 *     so the applier verifies and installs it — and the seat would hold a file
 *     whose every line carries a trailing `\r`.
 *
 * No live R2. `FakeBucket` implements the two methods the module uses and can
 * be told to drop or corrupt a write, so the read-back proof is exercised
 * rather than assumed.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  MAX_SPEC_BODY_BYTES,
  SPEC_SCHEMA_VERSION,
  assertSpecKey,
  buildSpecDocument,
  collectAuthoredBodies,
  countBodies,
  normalizeLineEndings,
  parseSpecDocument,
  readSpecDocument,
  serializeSpecDocument,
  sha256Hex,
  specFieldName,
  specObjectKey,
  writeSpecDocument,
  type SpecDocument,
} from '../src/lib/operator/output-class-specs'

const MODULE_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/lib/operator/output-class-specs.ts', import.meta.url)),
  'utf8'
)

const FORM_SOURCE = readFileSync(
  fileURLToPath(
    new URL('../src/components/portal/operator/OutputClassSpecs.astro', import.meta.url)
  ),
  'utf8'
)

const ENDPOINT_SOURCE = readFileSync(
  fileURLToPath(
    new URL('../src/pages/api/portal/operator/settings/output-class-specs.ts', import.meta.url)
  ),
  'utf8'
)

const ADVANCED_PAGE_SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      '../src/pages/portal/products/operator/[instance]/settings/advanced/index.astro',
      import.meta.url
    )
  ),
  'utf8'
)

/** Minimal stand-in for the two R2Bucket methods this module uses. */
class FakeBucket {
  readonly objects = new Map<string, string>()
  /** When set, `put` silently stores this instead of what it was given. */
  corruptWith: string | null = null
  /** When true, `put` resolves without storing anything. */
  dropWrites = false

  put(key: string, value: string): Promise<void> {
    if (!this.dropWrites) this.objects.set(key, this.corruptWith ?? value)
    return Promise.resolve()
  }

  get(key: string): Promise<{ text: () => Promise<string> } | null> {
    const stored = this.objects.get(key)
    if (stored === undefined) return Promise.resolve(null)
    return Promise.resolve({ text: () => Promise.resolve(stored) })
  }
}

function asBucket(fake: FakeBucket): R2Bucket {
  return fake as unknown as R2Bucket
}

describe('output-class specs: one key space', () => {
  it('builds the key from a constant basename and a charset-bounded slug', () => {
    expect(specObjectKey('ashton-price')).toBe('vaults/ashton-price/output-classes.json')
  })

  it('refuses a slug that could name any other object', () => {
    // `.` is the character that separates `output-classes.json` from
    // `customer.yaml`, and `/` is the one that leaves the prefix entirely.
    for (const slug of ['bad.slug', 'a/b', '../etc', 'UPPER', '', '  ']) {
      expect(() => specObjectKey(slug)).toThrow(/refusing a customer slug/)
    }
  })

  it('refuses any assembled key outside the output-classes shape', () => {
    for (const key of [
      'vaults/ashton-price/customer.yaml',
      'vaults/ashton-price/voice/output-classes.json',
      'customers/ashton-price/output-classes.json',
      'vaults//output-classes.json',
    ]) {
      expect(() => assertSpecKey(key)).toThrow(/outside the output-classes key space/)
    }
  })

  it('names the object exactly once, as a literal', () => {
    // If a future edit made the object name an input, this is what fails.
    const assignments = MODULE_SOURCE.match(/^const SPEC_OBJECT_BASENAME =.*$/gm) ?? []
    expect(assignments).toEqual([`const SPEC_OBJECT_BASENAME = 'output-classes.json'`])
    // The only mention of the neighbouring key space is in prose explaining
    // why this module cannot write it.
    const codeLines = MODULE_SOURCE.split('\n').filter(
      (l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//')
    )
    expect(codeLines.join('\n')).not.toContain('customer.yaml')
  })

  it('a write never touches a key outside the space', async () => {
    const bucket = new FakeBucket()
    const built = await buildSpecDocument([
      { outputClass: 'work_product', property: 'format', body: 'Two-page cap.' },
    ])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    await writeSpecDocument(asBucket(bucket), 'ashton-price', built.doc)
    expect([...bucket.objects.keys()]).toEqual(['vaults/ashton-price/output-classes.json'])
  })
})

describe('output-class specs: the hash is computed server-side', () => {
  it('hashes the body it is about to write, not a submitted digest', async () => {
    const body = 'Plain sentences. No headings.'
    const built = await buildSpecDocument([{ outputClass: 'staff', property: 'voice', body }])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.doc.classes['staff']?.voice?.sha256).toBe(await sha256Hex(body))
  })

  it('ignores a hash carried in an existing document when rewriting it', async () => {
    // A previous writer (or a hand edit) left a body whose declared digest is a
    // lie. Round-tripping it through a build re-derives the truth.
    const parsed = parseSpecDocument(
      JSON.stringify({
        schema_version: SPEC_SCHEMA_VERSION,
        classes: { staff: { voice: { body: 'Warm.', sha256: 'deadbeef' } } },
      })
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc.classes['staff']?.voice?.sha256).toBe('deadbeef')

    const rebuilt = await buildSpecDocument([
      { outputClass: 'staff', property: 'voice', body: 'Warm.' },
    ])
    expect(rebuilt.ok).toBe(true)
    if (!rebuilt.ok) return
    expect(rebuilt.doc.classes['staff']?.voice?.sha256).toBe(await sha256Hex('Warm.'))
  })

  it('produces a document the applier would accept: every declared hash matches its body', async () => {
    const built = await buildSpecDocument([
      { outputClass: 'work_product', property: 'voice', body: 'Measured.' },
      { outputClass: 'work_product', property: 'format', body: 'Numbered paragraphs.' },
      { outputClass: 'outbound_client', property: 'voice', body: 'Warm, never breezy.' },
    ])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    for (const entry of Object.values(built.doc.classes)) {
      for (const spec of Object.values(entry)) {
        expect(spec.sha256).toBe(await sha256Hex(spec.body))
      }
    }
    expect(countBodies(built.doc.classes)).toBe(3)
  })
})

describe('output-class specs: what the builder refuses', () => {
  it('refuses a document that would declare no bodies at all', async () => {
    // The seat refuses an empty document and keeps the tree it already has, so
    // writing one would leave the portal and the Operator disagreeing.
    const built = await buildSpecDocument([
      { outputClass: 'staff', property: 'voice', body: '   ' },
    ])
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.errors.join(' ')).toContain('no spec bodies')
  })

  it('drops one blank property while keeping the others', async () => {
    const built = await buildSpecDocument([
      { outputClass: 'staff', property: 'voice', body: 'Warm.' },
      { outputClass: 'staff', property: 'format', body: '' },
    ])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.doc.classes['staff']?.voice).toBeDefined()
    expect(built.doc.classes['staff']?.format).toBeUndefined()
  })

  it('refuses a body past the ceiling the seat enforces', async () => {
    const built = await buildSpecDocument([
      { outputClass: 'staff', property: 'voice', body: 'x'.repeat(MAX_SPEC_BODY_BYTES + 1) },
    ])
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.errors.join(' ')).toContain('ceiling')
  })

  it('refuses a class slug that could escape its path segment', async () => {
    for (const slug of ['../escape', 'a/b', 'Upper']) {
      const built = await buildSpecDocument([{ outputClass: slug, property: 'voice', body: 'x' }])
      expect(built.ok, slug).toBe(false)
    }
  })
})

describe('output-class specs: the stored bytes are LF-only', () => {
  // A browser textarea submits CRLF. Nothing downstream converts it and nothing
  // fails loudly if it survives, because the digest matches its own CRLF body:
  // the applier verifies it and installs a file whose every line carries a
  // trailing `\r`. That is different bytes from the LF file every existing
  // proof was taken against, and a trailing character any line-oriented format
  // check would silently inherit.
  const CRLF = 'Open with the case name.\r\nClose with a single line beginning Next:.\r\n'
  const LF = 'Open with the case name.\nClose with a single line beginning Next:.\n'

  it('collapses CRLF and lone CR to LF', () => {
    expect(normalizeLineEndings(CRLF)).toBe(LF)
    expect(normalizeLineEndings('a\rb')).toBe('a\nb')
    expect(normalizeLineEndings('a\r\r\nb')).toBe('a\n\nb')
    expect(normalizeLineEndings(LF)).toBe(LF)
  })

  it('writes a document with no carriage return anywhere in it', async () => {
    const built = await buildSpecDocument([
      { outputClass: 'staff', property: 'format', body: CRLF },
    ])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(serializeSpecDocument(built.doc)).not.toContain('\r')
    expect(built.doc.classes['staff']?.format?.body).not.toContain('\r')
  })

  it('hashes the LF body it is about to write, not the CRLF body that arrived', async () => {
    const built = await buildSpecDocument([
      { outputClass: 'staff', property: 'format', body: CRLF },
    ])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const written = built.doc.classes['staff']?.format
    expect(written?.sha256).toBe(await sha256Hex(LF.trim()))
    // And the digest still describes the bytes beside it, which is the property
    // the applier checks before installing.
    expect(written?.sha256).toBe(await sha256Hex(written?.body ?? ''))
  })

  it('produces byte-identical documents from a CRLF body and its LF equivalent', async () => {
    const fromCrlf = await buildSpecDocument([
      { outputClass: 'staff', property: 'format', body: CRLF },
    ])
    const fromLf = await buildSpecDocument([{ outputClass: 'staff', property: 'format', body: LF }])
    expect(fromCrlf.ok && fromLf.ok).toBe(true)
    if (!fromCrlf.ok || !fromLf.ok) return
    expect(serializeSpecDocument(fromCrlf.doc)).toBe(serializeSpecDocument(fromLf.doc))
  })

  it('measures the ceiling against the normalised bytes, not the submitted ones', async () => {
    // LF: 262,144 bytes, one under the ceiling after trim. CRLF: 393,216, well
    // over it. Checking before normalising would refuse a body that fits.
    const lines = MAX_SPEC_BODY_BYTES / 2
    const built = await buildSpecDocument([
      { outputClass: 'staff', property: 'format', body: 'a\r\n'.repeat(lines) },
    ])
    expect(built.ok).toBe(true)
  })
})

describe('output-class specs: the server holds the ceiling, and every refusal is named', () => {
  it('derives the maxlength attribute from the server constant rather than picking one', () => {
    // The attribute counts UTF-16 code units and the ceiling counts UTF-8
    // bytes, and a string is never fewer bytes than code units — so deriving it
    // this way can only refuse text the server would also refuse. A picked
    // number below the ceiling (it was 20,000) makes a longer body authored
    // elsewhere render into a field the browser treats as over-limit, and
    // constraint validation can then make the whole form unsubmittable with
    // nothing on screen saying why.
    expect(FORM_SOURCE).toContain('maxlength={MAX_SPEC_BODY_BYTES}')
    expect(FORM_SOURCE).not.toMatch(/maxlength=\{\d/)
  })

  it('reports why a build was refused as a value, not a string to match on', async () => {
    const tooLong = await buildSpecDocument([
      { outputClass: 'staff', property: 'voice', body: 'x'.repeat(MAX_SPEC_BODY_BYTES + 1) },
    ])
    expect(tooLong.ok).toBe(false)
    if (tooLong.ok) return
    expect(tooLong.reason).toBe('body_too_long')

    const empty = await buildSpecDocument([
      { outputClass: 'staff', property: 'voice', body: '   ' },
    ])
    expect(empty.ok).toBe(false)
    if (empty.ok) return
    expect(empty.reason).toBe('no_bodies')

    const bad = await buildSpecDocument([{ outputClass: 'Upper', property: 'voice', body: 'x' }])
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.reason).toBe('invalid_class')
  })

  it('gives every refusal status a banner on the page it redirects to', () => {
    // A status with no banner renders as no message at all: the person is
    // returned to the form, nothing saved, nothing said.
    const block = ENDPOINT_SOURCE.match(
      /const BUILD_FAILURE_STATUS: Record<SpecBuildFailure, string> = \{([\s\S]*?)\n\}/
    )
    expect(block).not.toBeNull()
    const statuses = [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(statuses).toEqual(['spec_too_long', 'spec_empty', 'spec_invalid'])
    for (const status of statuses) {
      expect(ADVANCED_PAGE_SOURCE, status).toMatch(new RegExp(`^\\s*${status}: \\{`, 'm'))
    }
  })
})

describe('output-class specs: only declared classes are authorable', () => {
  it('reads a field for every declared class property', () => {
    const form = new FormData()
    form.set('specs[staff].voice', 'Warm.')
    form.set('specs[staff].format', 'Short.')
    expect(collectAuthoredBodies(form, ['staff'])).toEqual([
      { outputClass: 'staff', property: 'voice', body: 'Warm.' },
      { outputClass: 'staff', property: 'format', body: 'Short.' },
    ])
  })

  it('drops a field naming a class the seat did not declare', () => {
    // A hand-crafted POST must not be able to mint a spec for a class the
    // engagement never agreed to. The iteration is over the declared classes,
    // never over the form's own keys, so the smuggled field is not looked for.
    const form = new FormData()
    form.set('specs[staff].voice', 'Warm.')
    form.set('specs[work_product].voice', 'Smuggled.')
    expect(collectAuthoredBodies(form, ['staff'])).toEqual([
      { outputClass: 'staff', property: 'voice', body: 'Warm.' },
    ])
  })

  it('declares nothing when the customer declared no classes', () => {
    const form = new FormData()
    form.set('specs[staff].voice', 'Warm.')
    expect(collectAuthoredBodies(form, [])).toEqual([])
  })

  it('uses the one field-name definition the form renders with', () => {
    expect(specFieldName('work_product', 'format')).toBe('specs[work_product].format')
  })
})

describe('output-class specs: parsing what is already in the vault', () => {
  it('refuses a document of an unknown schema version rather than best-effort parsing it', () => {
    const parsed = parseSpecDocument(JSON.stringify({ schema_version: 2, classes: {} }))
    expect(parsed.ok).toBe(false)
  })

  it('refuses malformed JSON and a non-object root', () => {
    expect(parseSpecDocument('{not json').ok).toBe(false)
    expect(parseSpecDocument('[]').ok).toBe(false)
  })

  it('refuses an entry missing its body or its digest', () => {
    const parsed = parseSpecDocument(
      JSON.stringify({
        schema_version: SPEC_SCHEMA_VERSION,
        classes: { staff: { voice: { body: 'Warm.' } } },
      })
    )
    expect(parsed.ok).toBe(false)
  })

  it('reports an absent object distinctly from an unreadable one', async () => {
    const bucket = new FakeBucket()
    expect((await readSpecDocument(asBucket(bucket), 'ashton-price')).kind).toBe('absent')

    bucket.objects.set('vaults/ashton-price/output-classes.json', 'not json at all')
    const read = await readSpecDocument(asBucket(bucket), 'ashton-price')
    // The distinction is load-bearing: `absent` renders an empty form, but
    // offering to overwrite prose we could not display would destroy it.
    expect(read.kind).toBe('unreadable')
  })
})

describe('output-class specs: the write is proven, not assumed', () => {
  const doc: SpecDocument = {
    schema_version: SPEC_SCHEMA_VERSION,
    classes: { staff: { voice: { body: 'Warm.', sha256: 'x' } } },
  }

  it('reports ok only after reading the object back byte-identical', async () => {
    const bucket = new FakeBucket()
    const written = await writeSpecDocument(asBucket(bucket), 'ashton-price', doc)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    expect(written.key).toBe('vaults/ashton-price/output-classes.json')
    expect(written.bodies).toBe(1)
  })

  it('reports failure when the object is not there afterwards', async () => {
    const bucket = new FakeBucket()
    bucket.dropWrites = true
    const written = await writeSpecDocument(asBucket(bucket), 'ashton-price', doc)
    expect(written.ok).toBe(false)
  })

  it('reports failure when what comes back is not what went in', async () => {
    const bucket = new FakeBucket()
    bucket.corruptWith = '{"schema_version":1,"classes":{}}'
    const written = await writeSpecDocument(asBucket(bucket), 'ashton-price', doc)
    expect(written.ok).toBe(false)
  })

  it('serializes deterministically so an unchanged save is byte-stable', () => {
    const a: SpecDocument = {
      schema_version: SPEC_SCHEMA_VERSION,
      classes: {
        staff: { format: { body: 'B', sha256: '2' }, voice: { body: 'A', sha256: '1' } },
        record: { voice: { body: 'C', sha256: '3' } },
      },
    }
    const b: SpecDocument = {
      schema_version: SPEC_SCHEMA_VERSION,
      classes: {
        record: { voice: { body: 'C', sha256: '3' } },
        staff: { voice: { body: 'A', sha256: '1' }, format: { body: 'B', sha256: '2' } },
      },
    }
    expect(serializeSpecDocument(a)).toBe(serializeSpecDocument(b))
  })
})
