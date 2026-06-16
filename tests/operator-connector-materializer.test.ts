/**
 * Guard 4 (audit Wave 0) — VALIDATE-FAIL-CLOSED guard (connector backends).
 *
 * THE INERT-CONTROL CLASS THIS CLOSES
 * -----------------------------------
 * customer.yaml binds each capability to a connector `backend:` whose prefix
 * selects how it is materialized at runtime. The validator
 * (src/lib/operator/customer-yaml/sections-connectors.ts::checkBackend) accepts
 * any prefix in `ACCEPTED_BACKEND_PREFIXES` (`mcp:` / `build:` / `synthetic:`),
 * but a backend only surfaces real tools if SOMETHING materializes it:
 *
 *   - `mcp:`       — overlay translate.py `_materialize_mcp_servers` writes the
 *                    profile mcp_servers → tools. Always materialized.
 *   - `build:<a>`  — a Python CLI adapter at operator/connectors/<family>/
 *                    (declaring ADAPTER = "<a>") reached via execute_code.
 *                    Materialized ONLY for adapters that actually have an impl.
 *                    A build:<adapter> with no impl (e.g. build:filevine) has no
 *                    runtime bridge — validates clean, boots with zero tools.
 *   - `synthetic:` — demo/substrate stand-in. No live connector, no real tools.
 *
 * "validation passing ≠ materialized": a capability bound to `synthetic:no_pm`
 * or `build:<no-impl>` as its SOLE backend boots with ZERO tools while
 * validating clean. The cron-block failure shape, applied to connectors.
 *
 * WHAT THIS GUARD ASSERTS
 * -----------------------
 * `operator/contracts/connector-backend-materializers.json` classifies every
 * accepted prefix. For `build:` the materialized-adapter allowlist is DERIVED
 * here from the connector impls under operator/connectors/ (ADAPTER = "..."), so
 * it cannot drift from reality. The guard:
 *
 *   1. PREFIX COVERAGE — every prefix in `ACCEPTED_BACKEND_PREFIXES` is
 *      classified.
 *   2. FAIL-CLOSED ON ZERO-TOOL BINDINGS — no real (non-exempt) customer.yaml
 *      may bind a capability whose SOLE resolved backend is non-materializable
 *      (synthetic:*, or build:<adapter> with no impl).
 *   3. INERT/CONDITIONAL PREFIXES STAY DOCUMENTED.
 *
 * CROSS-REPO LIMIT. The mcp materializer (translate.py) lives in the overlay,
 * not in this CI; the actual fail-closed REJECTION at materialization time must
 * land there. This guard is the ss-console-side anchor — it classifies every
 * prefix and blocks a real customer from shipping a zero-tool capability.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import { parse as parseYaml } from 'yaml'

const TYPES_SOURCE = resolve('src/lib/operator/customer-yaml/types.ts')
const CONTRACT_PATH = resolve('operator/contracts/connector-backend-materializers.json')
const CONNECTORS_DIR = resolve('operator/connectors')

interface PrefixEntry {
  status: 'materialized' | 'conditional' | 'inert'
  materializer?: string
  materializedWhen?: string
  reason?: string
  tracking?: string
}

interface MaterializerContract {
  prefixes: Record<string, PrefixEntry>
  exemptCustomers: string[]
  demoCustomers: string[]
}

/** Parse ACCEPTED_BACKEND_PREFIXES = ['mcp:', 'build:', 'synthetic:'] from types.ts. */
function parseAcceptedBackendPrefixes(): string[] {
  const src = readFileSync(TYPES_SOURCE, 'utf-8')
  const m = src.match(/ACCEPTED_BACKEND_PREFIXES\s*=\s*\[([^\]]*)\]/)
  if (!m) throw new Error('ACCEPTED_BACKEND_PREFIXES not found in types.ts')
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

function loadContract(): MaterializerContract {
  return JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8')) as MaterializerContract
}

/**
 * Derive the set of materialized `build:` adapter names from the connector
 * impls: every operator/connectors/<family>/*.py declaring ADAPTER = "<name>"
 * is a build:<name> with a real runtime CLI bridge. Reading the impls (not a
 * hard-coded list) is what keeps the allowlist honest: deleting crane_gmail.py
 * makes build:google-gmail non-materializable here too.
 */
function materializedBuildAdapters(): Set<string> {
  const out = new Set<string>()
  if (!existsSync(CONNECTORS_DIR)) return out
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'tests' || ent.name === '__pycache__') continue
        walk(full)
      } else if (ent.name.endsWith('.py') && !ent.name.startsWith('test_')) {
        const m = readFileSync(full, 'utf-8').match(/^ADAPTER\s*=\s*"([^"]+)"/m)
        if (m) out.add(m[1])
      }
    }
  }
  walk(CONNECTORS_DIR)
  return out
}

/** Split a single backend or a bracketed pick-one menu into resolved options. */
function resolveBackendOptions(backend: string): string[] {
  const trimmed = backend.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  return [trimmed]
}

function prefixOf(backend: string, prefixes: string[]): string | null {
  return prefixes.find((p) => backend.startsWith(p)) ?? null
}

/**
 * Is a single resolved backend option materializable (will surface tools)?
 *   - mcp:*                       → yes (mcp_servers materializer)
 *   - build:<a> where <a> impl'd  → yes (CLI adapter bridge)
 *   - build:<a> with no impl      → NO
 *   - synthetic:*                 → NO
 */
function isMaterializable(option: string, buildAllowlist: Set<string>): boolean {
  if (option.startsWith('mcp:')) return true
  if (option.startsWith('build:')) {
    return buildAllowlist.has(option.slice('build:'.length))
  }
  return false // synthetic:* or anything unrecognised
}

describe('connector backend materializer guard (validate-fail-closed)', () => {
  const prefixes = parseAcceptedBackendPrefixes()
  const contract = loadContract()

  it('extracted prefixes are non-trivial and include mcp:', () => {
    expect(prefixes.length).toBeGreaterThan(0)
    expect(prefixes).toContain('mcp:')
  })

  it('every accepted backend prefix is classified in the materializer contract', () => {
    const unclassified = prefixes.filter((p) => !(p in contract.prefixes))
    expect(
      unclassified,
      'Every prefix in ACCEPTED_BACKEND_PREFIXES (sections-connectors.ts accepts these) must be ' +
        'classified in connector-backend-materializers.json. An unclassified prefix is the ' +
        'inert-control hole: it validates clean but may surface zero tools.\n' +
        `unclassified: ${unclassified.join(', ')}`
    ).toEqual([])
  })

  it('each prefix entry is well-formed for its status', () => {
    const broken: string[] = []
    for (const [prefix, entry] of Object.entries(contract.prefixes)) {
      if (entry.status === 'materialized') {
        if (!entry.materializer?.trim()) broken.push(`${prefix}: materialized but no materializer`)
      } else if (entry.status === 'conditional') {
        if (!entry.materializedWhen?.trim())
          broken.push(`${prefix}: conditional but no materializedWhen`)
        if (!entry.reason?.trim()) broken.push(`${prefix}: conditional but no reason`)
        if (!entry.tracking?.trim()) broken.push(`${prefix}: conditional but no tracking`)
      } else if (entry.status === 'inert') {
        if (!entry.reason?.trim()) broken.push(`${prefix}: inert but no reason`)
        if (!entry.tracking?.trim()) broken.push(`${prefix}: inert but no tracking`)
      } else {
        broken.push(`${prefix}: unknown status ${(entry).status}`)
      }
    }
    expect(broken, broken.join('\n')).toEqual([])
  })

  it('the derived build: adapter allowlist is read from real connector impls', () => {
    const allow = materializedBuildAdapters()
    // Sanity: the Google family impls exist today, so the allowlist is non-empty
    // and includes them. If this regresses, build:google-* would (correctly)
    // start failing the fail-closed check below — surfacing a real break.
    expect(allow.size, 'no build: adapter impls found under operator/connectors/').toBeGreaterThan(
      0
    )
    expect([...allow].sort()).toEqual(['google-calendar', 'google-drive', 'google-gmail'])
  })
})

describe('fail-closed: no real customer ships a zero-tool capability', () => {
  const prefixes = parseAcceptedBackendPrefixes()
  const contract = loadContract()
  const buildAllowlist = materializedBuildAdapters()
  const exempt = new Set([...contract.exemptCustomers, ...contract.demoCustomers])

  const customersDir = resolve('operator/customers')
  const customerFiles = existsSync(customersDir)
    ? readdirSync(customersDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(customersDir, d.name, 'customer.yaml'))
        .filter((p) => existsSync(p))
    : []

  it('discovers customer.yaml files', () => {
    expect(customerFiles.length).toBeGreaterThan(0)
  })

  it('every non-exempt customer capability has at least one materializable backend option', () => {
    const violations: string[] = []
    for (const file of customerFiles) {
      const slug = file.split('/').slice(-2)[0]
      if (exempt.has(slug)) continue
      const doc = parseYaml(readFileSync(file, 'utf-8')) as {
        connectors?: Record<string, { backend?: unknown; enabled?: unknown }>
      }
      const connectors = doc.connectors ?? {}
      for (const [capability, conn] of Object.entries(connectors)) {
        if (conn?.enabled === false) continue
        const backend = conn?.backend
        if (typeof backend !== 'string') continue
        const options = resolveBackendOptions(backend)
        if (!options.some((opt) => isMaterializable(opt, buildAllowlist))) {
          violations.push(
            `${slug} / ${capability}: backend ${JSON.stringify(backend)} has no materializable ` +
              `option (mcp:* or an impl'd build:<adapter>) — boots with ZERO tools`
          )
        }
      }
    }
    expect(
      violations,
      'A real customer capability whose only backend is non-materializable (synthetic:*, or a ' +
        'build:<adapter> with no impl under operator/connectors/) validates clean but surfaces no ' +
        "runtime tools. Bind it to an mcp: backend or an impl'd build: adapter, or add the " +
        'customer to demoCustomers if it is an intentional demo seat (and wire the overlay ' +
        'translate.py fail-closed rejection per the contract tracking note).\n' +
        violations.join('\n')
    ).toEqual([])
  })
})

describe('guard bites — non-materializable bindings are rejected by the predicate', () => {
  const prefixes = parseAcceptedBackendPrefixes()
  const buildAllowlist = materializedBuildAdapters()

  function ok(backend: string): boolean {
    return resolveBackendOptions(backend).some((opt) => isMaterializable(opt, buildAllowlist))
  }

  it('flags zero-tool bindings and accepts materializable ones', () => {
    // The exact zero-tool shapes the guard must catch.
    expect(ok('synthetic:no_pm'), 'synthetic-only must be zero-tool').toBe(false)
    expect(ok('build:filevine'), 'build: with no impl must be zero-tool').toBe(false)
    expect(ok('[build:filevine / synthetic:no_pm]'), 'menu of only zero-tool options').toBe(false)
    // Materializable: mcp, an impl'd build adapter, and any menu containing one.
    expect(ok('mcp:clio-oktopeak')).toBe(true)
    expect(ok('build:google-gmail'), 'build:google-gmail has an impl').toBe(true)
    expect(ok('[build:filevine / mcp:clio-oktopeak / synthetic:no_pm]')).toBe(true)
  })

  // Guard the build allowlist's honesty: prefixOf is still consistent with the
  // accepted prefixes (defends against a types.ts edit that drops a prefix).
  it('prefix detection stays consistent with ACCEPTED_BACKEND_PREFIXES', () => {
    expect(prefixOf('mcp:x', prefixes)).toBe('mcp:')
    expect(prefixOf('build:y', prefixes)).toBe('build:')
    expect(prefixOf('synthetic:z', prefixes)).toBe('synthetic:')
    expect(prefixOf('bogus:w', prefixes)).toBeNull()
  })
})
