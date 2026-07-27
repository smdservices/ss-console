/**
 * Surgical exposure editing (#2003 slice 2).
 *
 * Run against the REAL ashton-price customer.yaml: the contract is that a
 * client's config file survives an edit with a one-line diff and every
 * authored comment intact. A fixture would not prove that.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parse as parseYaml } from 'yaml'
import { validate } from '../src/lib/operator/customer-yaml'
import { setExposureKey } from '../src/lib/operator/exposure-yaml-edit'

const AP_YAML = resolve('operator/customers/ashton-price/customer.yaml')
const source = () => readFileSync(AP_YAML, 'utf-8')

function diffLines(a: string, b: string): { added: string[]; removed: string[] } {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const added = bLines.filter((l, i) => l !== aLines[i] && !aLines.includes(l))
  const removed = aLines.filter((l, i) => l !== bLines[i] && !bLines.includes(l))
  return { added, removed }
}

describe('one-line diffs on a real client config', () => {
  it('changing a value touches exactly one line and keeps every comment', () => {
    const src = source()
    const result = setExposureKey(src, 'operator', 'external_send_client', 'autonomous')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)

    const { added, removed } = diffLines(src, result.text)
    expect(added).toEqual(['        external_send_client: autonomous'])
    expect(removed).toEqual(['        external_send_client: draft_for_review'])
    expect(result.text.split('\n')).toHaveLength(src.split('\n').length)

    // Every comment line survives byte-for-byte.
    const comments = (t: string) => t.split('\n').filter((l) => l.trimStart().startsWith('#'))
    expect(comments(result.text)).toEqual(comments(src))
  })

  it('the edited file still validates through the canonical validator', () => {
    const result = setExposureKey(source(), 'operator', 'external_send_client', 'autonomous')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const parsed = validate(parseYaml(result.text) as Record<string, unknown>)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const persona = parsed.value.personas.find((p) => p.slug === 'operator')
    expect(persona?.entitlements.exposure['external_send_client']).toBe('autonomous')
  })

  it('adding a new key appends one line inside the block', () => {
    const src = source()
    const result = setExposureKey(src, 'operator', 'destructive', 'draft_for_review')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text.split('\n')).toHaveLength(src.split('\n').length + 1)
    const parsed = validate(parseYaml(result.text) as Record<string, unknown>)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(
      parsed.value.personas.find((p) => p.slug === 'operator')?.entitlements.exposure['destructive']
    ).toBe('draft_for_review')
  })

  it('removing a key (fail-closed) drops exactly that line', () => {
    const src = source()
    const result = setExposureKey(src, 'operator', 'external_send_vendor', null)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text.split('\n')).toHaveLength(src.split('\n').length - 1)
    const parsed = validate(parseYaml(result.text) as Record<string, unknown>)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(
      parsed.value.personas.find((p) => p.slug === 'operator')?.entitlements.exposure[
        'external_send_vendor'
      ]
    ).toBeUndefined()
  })
})

describe('no-ops and refusals', () => {
  it('setting a key to its current value is a no-op, not a diff', () => {
    const src = source()
    const result = setExposureKey(src, 'operator', 'external_send_client', 'draft_for_review')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(false)
    expect(result.text).toBe(src)
  })

  it('removing an absent key is a no-op', () => {
    const src = source()
    const result = setExposureKey(src, 'operator', 'code_execution', null)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(false)
    expect(result.text).toBe(src)
  })

  it('refuses an unknown persona rather than editing the wrong block', () => {
    const result = setExposureKey(source(), 'not-a-persona', 'external_send', 'autonomous')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('not found')
  })

  it('refuses unsafe key/value shapes (no YAML injection through the edit path)', () => {
    for (const key of ['external_send\nrogue: x', 'a b', 'KEY', '']) {
      expect(setExposureKey(source(), 'operator', key, 'autonomous').ok).toBe(false)
    }
    for (const value of ['autonomous\n      rogue: x', 'a b', '{}', '']) {
      expect(setExposureKey(source(), 'operator', 'external_send', value).ok).toBe(false)
    }
  })

  it('edits only the addressed persona (multi-persona safety)', () => {
    const twoPersonas = source().replace(
      /^personas:$/m,
      'personas:\n  - slug: decoy\n    status: archived\n    name: Decoy\n    tone: [plain]\n    entitlements:\n      exposure:\n        external_send: autonomous\n    skills: []\n'
    )
    const result = setExposureKey(twoPersonas, 'operator', 'external_send', 'autonomous')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The decoy's identical key is untouched: exactly one line changed overall.
    const changedCount = result.text
      .split('\n')
      .filter((l, i) => l !== twoPersonas.split('\n')[i]).length
    expect(changedCount).toBe(1)
  })
})
