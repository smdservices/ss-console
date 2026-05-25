#!/usr/bin/env tsx
/**
 * Standalone customer.yaml validator wrapper.
 *
 * Replaces the retired `ai-employee/adapter/validate_customer_yaml.py`
 * with an invocation of the canonical TS validator at
 * `src/lib/ai-employee/customer-yaml/` (per ADR 0019: TS is the canonical
 * pre-merge gate; the overlay's bootstrap/validate.py is the runtime
 * re-check; the in-tree Python copy was on a stale schema and is gone).
 *
 * Usage:
 *   npx tsx scripts/validate-customer-yaml.ts <path-to-customer.yaml>
 *
 * Exit codes:
 *   0 — valid
 *   1 — schema validation errors (printed to stderr)
 *   2 — file not readable / not parseable YAML
 *
 * Called by `ai-employee/bin/provision-customer.sh` before any Fly action.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

import { validate } from '../src/lib/ai-employee/customer-yaml'

function fail(code: number, message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

const argPath = process.argv[2]
if (!argPath) {
  fail(2, 'Usage: validate-customer-yaml.ts <path-to-customer.yaml>')
}

const filePath = resolve(argPath)
let raw: string
try {
  raw = readFileSync(filePath, 'utf8')
} catch (err) {
  fail(2, `cannot read ${filePath}: ${(err as Error).message}`)
}

let parsed: unknown
try {
  parsed = parseYaml(raw)
} catch (err) {
  fail(2, `${filePath} is not valid YAML: ${(err as Error).message}`)
}

const result = validate(parsed)

if (!result.ok) {
  process.stderr.write(`customer.yaml has ${result.errors.length} validation error(s):\n`)
  for (const e of result.errors) {
    process.stderr.write(`  [${e.code}] ${e.path}: ${e.message}\n`)
  }
  process.exit(1)
}

process.stdout.write(`${filePath} OK\n`)
process.exit(0)
