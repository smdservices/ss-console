/**
 * Identity + runtime + users section validators for customer.yaml.
 * Kept apart from validator.ts to honor the 500/75/15 ceiling.
 */

import {
  ACCEPTED_SCHEMA_VERSIONS,
  ACCEPTED_USER_ROLES,
  SLUG_PATTERN,
  type MachineSpec,
  type User,
  type UserRole,
  type ValidationError,
} from './types'
import { isPlainObject } from './helpers'

export function checkSchemaVersion(
  root: Record<string, unknown>,
  errors: ValidationError[]
): number {
  const v = root['schema_version']
  if (v === undefined || v === null) {
    errors.push({
      code: 'MissingField',
      path: 'schema_version',
      message: 'schema_version is required (must be 1)',
    })
    return 0
  }
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'schema_version',
      message: 'schema_version must be an integer',
    })
    return 0
  }
  if (!(ACCEPTED_SCHEMA_VERSIONS as readonly number[]).includes(v)) {
    errors.push({
      code: 'SchemaVersionUnsupported',
      path: 'schema_version',
      message: `schema_version ${v} is not in the accepted set [${ACCEPTED_SCHEMA_VERSIONS.join(', ')}]`,
    })
    return 0
  }
  return v
}

export function checkCustomerId(
  root: Record<string, unknown>,
  errors: ValidationError[]
): string | null {
  const id = root['customer_id']
  if (id === undefined || id === null) {
    errors.push({
      code: 'MissingField',
      path: 'customer_id',
      message: 'customer_id is required',
    })
    return null
  }
  if (typeof id !== 'string') {
    errors.push({
      code: 'TypeMismatch',
      path: 'customer_id',
      message: 'customer_id must be a string',
    })
    return null
  }
  if (id.length === 0) {
    errors.push({
      code: 'EmptyField',
      path: 'customer_id',
      message: 'customer_id must not be empty',
    })
    return null
  }
  if (!SLUG_PATTERN.test(id)) {
    errors.push({
      code: 'InvalidSlug',
      path: 'customer_id',
      message: 'customer_id must match ^[a-z0-9][a-z0-9-]{0,31}$',
    })
    return null
  }
  return id
}

export function checkPracticeAreas(
  root: Record<string, unknown>,
  vertical: string | null,
  errors: ValidationError[]
): string[] {
  const raw = root['practice_areas']
  if (raw === undefined || raw === null) {
    if (vertical === 'law-firm') {
      errors.push({
        code: 'MissingField',
        path: 'practice_areas',
        message: 'practice_areas is required when vertical=law-firm',
      })
    }
    return []
  }
  if (!Array.isArray(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'practice_areas',
      message: 'practice_areas must be a list of strings',
    })
    return []
  }
  const out: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i]
    if (typeof item !== 'string' || item.length === 0) {
      errors.push({
        code: 'TypeMismatch',
        path: `practice_areas[${i}]`,
        message: 'practice_areas entries must be non-empty strings',
      })
      continue
    }
    out.push(item)
  }
  return out
}

export function checkMachine(
  root: Record<string, unknown>,
  errors: ValidationError[]
): MachineSpec | null {
  const m = root['machine']
  if (m === undefined || m === null) {
    errors.push({ code: 'MissingField', path: 'machine', message: 'machine is required' })
    return null
  }
  if (!isPlainObject(m)) {
    errors.push({ code: 'TypeMismatch', path: 'machine', message: 'machine must be an object' })
    return null
  }
  return checkMachineFields(m, errors)
}

function checkMachineFields(
  m: Record<string, unknown>,
  errors: ValidationError[]
): MachineSpec | null {
  const size = m['size']
  const mem = m['memory_mb']
  let ok = true
  if (typeof size !== 'string' || size.length === 0) {
    errors.push({
      code: 'MissingField',
      path: 'machine.size',
      message: 'machine.size is required',
    })
    ok = false
  }
  if (typeof mem !== 'number' || !Number.isInteger(mem)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'machine.memory_mb',
      message: 'machine.memory_mb must be an integer',
    })
    ok = false
  } else if (mem < 256 || mem > 8192) {
    errors.push({
      code: 'EnumViolation',
      path: 'machine.memory_mb',
      message: 'machine.memory_mb must be between 256 and 8192',
    })
    ok = false
  }
  return ok ? { size: size as string, memory_mb: mem as number } : null
}

export function checkUsers(root: Record<string, unknown>, errors: ValidationError[]): User[] {
  const raw = root['users']
  if (raw === undefined || raw === null) {
    errors.push({ code: 'MissingField', path: 'users', message: 'users is required' })
    return []
  }
  if (!Array.isArray(raw)) {
    errors.push({ code: 'TypeMismatch', path: 'users', message: 'users must be a list' })
    return []
  }
  if (raw.length === 0) {
    errors.push({
      code: 'EmptyList',
      path: 'users',
      message: 'users must contain at least one entry',
    })
    return []
  }
  const out: User[] = []
  for (let i = 0; i < raw.length; i++) {
    const u = checkOneUser(raw[i], i, errors)
    if (u !== null) out.push(u)
  }
  return out
}

function checkOneUser(u: unknown, i: number, errors: ValidationError[]): User | null {
  if (!isPlainObject(u)) {
    errors.push({
      code: 'TypeMismatch',
      path: `users[${i}]`,
      message: 'users entries must be objects',
    })
    return null
  }
  const email = u['email']
  const role = u['role']
  const fullName = u['full_name']
  let valid = true
  if (typeof email !== 'string' || email.length === 0) {
    errors.push({
      code: 'MissingField',
      path: `users[${i}].email`,
      message: 'users[].email is required',
    })
    valid = false
  }
  if (typeof role !== 'string' || !(ACCEPTED_USER_ROLES as readonly string[]).includes(role)) {
    errors.push({
      code: 'EnumViolation',
      path: `users[${i}].role`,
      message: `users[].role must be one of: ${ACCEPTED_USER_ROLES.join(', ')}`,
    })
    valid = false
  }
  if (typeof fullName !== 'string' || fullName.length === 0) {
    errors.push({
      code: 'MissingField',
      path: `users[${i}].full_name`,
      message: 'users[].full_name is required',
    })
    valid = false
  }
  if (!valid) return null
  return {
    email: email as string,
    role: role as UserRole,
    full_name: fullName as string,
  }
}
