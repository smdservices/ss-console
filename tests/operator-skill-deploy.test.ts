/**
 * Skill-delivery pipeline coverage (#1206).
 *
 * Two halves of the same gap — a repo skill bound in customer.yaml must reach
 * the Machine, and a missing body must be caught BEFORE boot, not as a runtime
 * crash-loop:
 *
 *  1. The author-time guardrail in `scripts/validate-customer-yaml.ts` — a
 *     schema-valid customer.yaml that binds a skill with no deployable body
 *     fails the pre-provision gate (exit 1), while the real customer-zero config
 *     still passes.
 *  2. The boot-time seed in `operator/templates/bootstrap.sh` — the
 *     `/app/skills -> ${HERMES_HOME}/skills` overlay is ADDITIVE: it lands repo
 *     skills on the volume without clobbering agent-authored skills that live
 *     only there (ADR 0017).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SMD_CUSTOMER_YAML = join(REPO_ROOT, 'operator', 'customers', 'smd', 'customer.yaml')
const BOOTSTRAP_SH = join(REPO_ROOT, 'operator', 'templates', 'bootstrap.sh')

interface ValidatorResult {
  code: number
  stdout: string
  stderr: string
}

/** Run the real validator CLI exactly as `provision-customer.sh` does. */
function runValidator(customerYamlPath: string): ValidatorResult {
  try {
    const stdout = execFileSync(
      'npx',
      ['--quiet', 'tsx', 'scripts/validate-customer-yaml.ts', customerYamlPath],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    )
    return { code: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string }
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') }
  }
}

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skill-deploy-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('validate-customer-yaml: author-time skill-body guardrail (#1206)', () => {
  it('passes the real customer-zero config (no false positive)', () => {
    const result = runValidator(SMD_CUSTOMER_YAML)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('OK')
  })

  it('fails a schema-valid config that binds a skill with no deployable body', () => {
    // Keep the real (cron/webhook-referenced) skill so the config stays
    // schema-valid; add one extra enabled skill whose body does not exist.
    const cfg = parseYaml(readFileSync(SMD_CUSTOMER_YAML, 'utf8')) as {
      personas: {
        skills: { name: string; version: string; trust_ceiling: string; enabled: boolean }[]
      }[]
    }
    cfg.personas[0].skills.push({
      name: 'nonexistent-skill-xyz',
      version: 'pending',
      trust_ceiling: 'draft_for_review',
      enabled: true,
    })
    const dir = makeTmpDir()
    const bad = join(dir, 'customer.yaml')
    writeFileSync(bad, stringifyYaml(cfg))

    const result = runValidator(bad)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('skill-body-missing')
    expect(result.stderr).toContain('nonexistent-skill-xyz')
  })

  it('accepts a customer-local skill body (skills/<name>/SKILL.md beside customer.yaml)', () => {
    // Bind a skill that exists only in the customer-local catalog, not the
    // shared repo catalog — the second lookup location must satisfy the gate.
    const cfg = parseYaml(readFileSync(SMD_CUSTOMER_YAML, 'utf8')) as {
      personas: {
        skills: { name: string; version: string; trust_ceiling: string; enabled: boolean }[]
      }[]
    }
    cfg.personas[0].skills.push({
      name: 'customer-local-skill',
      version: 'pending',
      trust_ceiling: 'draft_for_review',
      enabled: true,
    })
    const dir = makeTmpDir()
    mkdirSync(join(dir, 'skills', 'customer-local-skill'), { recursive: true })
    writeFileSync(join(dir, 'skills', 'customer-local-skill', 'SKILL.md'), '# local\n')
    const yamlPath = join(dir, 'customer.yaml')
    writeFileSync(yamlPath, stringifyYaml(cfg))

    const result = runValidator(yamlPath)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('OK')
  })
})

describe('bootstrap.sh: skill-catalog seed is additive (#1206)', () => {
  it('overlays repo skills onto the volume without clobbering agent-authored skills', () => {
    const dir = makeTmpDir()
    const appSkills = join(dir, 'app', 'skills')
    const volSkills = join(dir, 'opt', 'data', 'skills')
    mkdirSync(join(appSkills, 'inbox-triage'), { recursive: true })
    writeFileSync(join(appSkills, 'inbox-triage', 'SKILL.md'), '# repo body v2\n')
    // A skill that lives ONLY on the volume — the agent-authored case (ADR 0017).
    mkdirSync(join(volSkills, 'agent-authored-skill'), { recursive: true })
    writeFileSync(join(volSkills, 'agent-authored-skill', 'SKILL.md'), '# authored at runtime\n')

    // The exact idiom from bootstrap.sh step 6b.
    execFileSync('cp', ['-a', `${appSkills}/.`, `${volSkills}/`])

    // Repo skill landed on the volume...
    expect(existsSync(join(volSkills, 'inbox-triage', 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(volSkills, 'inbox-triage', 'SKILL.md'), 'utf8')).toContain(
      'repo body v2'
    )
    // ...and the agent-authored skill was preserved, not wiped.
    expect(existsSync(join(volSkills, 'agent-authored-skill', 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(volSkills, 'agent-authored-skill', 'SKILL.md'), 'utf8')).toContain(
      'authored at runtime'
    )
  })

  it('bootstrap.sh seeds the catalog additively and never destructively wipes it', () => {
    const script = readFileSync(BOOTSTRAP_SH, 'utf8')
    // The additive seed must be present...
    expect(script).toContain('cp -a /app/skills/.')
    // ...and there must be NO destructive mirror of the skills catalog, which
    // would delete agent-authored skills on the volume (the regression guard).
    expect(script).not.toMatch(/rm\s+-rf[^\n]*\$\{HERMES_HOME\}\/skills/)
  })
})
