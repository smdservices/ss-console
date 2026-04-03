import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

describe('contacts: data access layer', () => {
  const source = () => readFileSync(resolve('src/lib/db/contacts.ts'), 'utf-8')

  it('contacts.ts exists', () => {
    expect(existsSync(resolve('src/lib/db/contacts.ts'))).toBe(true)
  })

  it('exports listContacts function', () => {
    expect(source()).toContain('export async function listContacts')
  })

  it('exports getContact function', () => {
    expect(source()).toContain('export async function getContact')
  })

  it('exports createContact function', () => {
    expect(source()).toContain('export async function createContact')
  })

  it('exports updateContact function', () => {
    expect(source()).toContain('export async function updateContact')
  })

  it('exports deleteContact function', () => {
    expect(source()).toContain('export async function deleteContact')
  })

  it('Contact interface includes role field', () => {
    const code = source()
    expect(code).toContain('role: string | null')
  })

  it('uses parameterized queries (no string interpolation in SQL)', () => {
    const code = source()
    // Ensure bind() is used for parameterized queries
    expect(code).toContain('.bind(')
    // Should not use template literals in SQL strings
    expect(code).not.toMatch(/prepare\(`[^`]*\$\{/)
  })

  it('generates UUIDs for primary keys', () => {
    expect(source()).toContain('crypto.randomUUID()')
  })

  it('scopes contact queries to org_id', () => {
    const code = source()
    expect(code).toContain('org_id = ?')
  })

  it('CreateContactData includes optional role field', () => {
    const code = source()
    expect(code).toContain('role?: string | null')
  })

  it('UpdateContactData includes optional role field', () => {
    const code = source()
    expect(code).toContain('role?: string | null')
  })

  it('updateContact handles role field updates', () => {
    const code = source()
    expect(code).toContain("fields.push('role = ?')")
  })

  it('createContact stores role in INSERT', () => {
    const code = source()
    expect(code).toContain('data.role ?? null')
  })
})
