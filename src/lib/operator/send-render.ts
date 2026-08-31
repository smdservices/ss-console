/**
 * The send-render contract, read the way the arming gate needs it.
 *
 * `operator/contracts/send-render.yaml` declares, per skill, HOW a routine's
 * outbound body is produced: `templated` / `slot-templated` (deterministic
 * render from an authored artifact, hash-verified by the console instrument)
 * or `compositional` (the model composes; covered by cross-run invariants).
 *
 * THE ARMING RULE this module computes: a `personas[].cron[]` entry whose
 * skill is declared `outbound: derived` in output-classes.yaml must be
 * declared in send-render.yaml, and a declaration in a hash-verified mode must
 * name a template that exists. `compositional` is a valid authored state, not
 * a bypass -- the gate refuses the UNDECLARED, the state where a routine is
 * armed to send with nobody having decided how its body comes to exist (the
 * 2026-08-24..31 outbound-quality review: format drift, unstable ACK codes,
 * recipient flapping are all the model re-composing what nobody declared).
 *
 * Two consumers, one join (deliberately -- two hand-rolled copies of a
 * three-file join drift silently):
 *   - tests/cron-send-arming-gate.test.ts, the merge gate (runs in
 *     `npm run verify`, so the exact PR that arms a cron row runs it);
 *   - scripts/validate-customer-yaml.ts, the provision-time backstop, so
 *     `provision-customer.sh` refuses an armed-undeclared seat even if
 *     someone pushes around CI.
 *
 * Not the schema validator (sections-bundles-cron.ts): that one is
 * deliberately pure over one document, and this rule spans three files.
 */

import { parse as parseYaml } from 'yaml'

export type RenderMode = 'templated' | 'slot-templated' | 'compositional'

const RENDER_MODES: readonly RenderMode[] = ['templated', 'slot-templated', 'compositional']

/** Modes whose bodies are hash-verified and therefore need a template artifact. */
const HASH_VERIFIED_MODES: readonly RenderMode[] = ['templated', 'slot-templated']

export interface RenderDecl {
  skill: string
  render: RenderMode
  /** Repo-relative template path; null for `compositional`. */
  template: string | null
}

/**
 * Parse send-render.yaml. Parsed, never grepped; malformed THROWS -- a gate
 * that soldiers past a broken contract file evaluates against an empty
 * declaration set and calls every armed routine undeclared (or worse, none).
 */
export function parseSendRender(yamlText: string): Map<string, RenderDecl> {
  const parsed: unknown = parseYaml(yamlText)
  const skills = (parsed as { skills?: unknown } | null)?.skills
  if (typeof skills !== 'object' || skills === null || Array.isArray(skills)) {
    throw new Error('send-render.yaml: expected a mapping with a `skills` mapping')
  }
  const out = new Map<string, RenderDecl>()
  for (const [skill, entry] of Object.entries(skills as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`send-render.yaml: skills.${skill} must be a mapping`)
    }
    const render = (entry as { render?: unknown }).render
    if (typeof render !== 'string' || !(RENDER_MODES as readonly string[]).includes(render)) {
      throw new Error(
        `send-render.yaml: skills.${skill}.render must be one of ${RENDER_MODES.join(' | ')}`
      )
    }
    const template = (entry as { template?: unknown }).template
    if (
      (HASH_VERIFIED_MODES as readonly string[]).includes(render) &&
      (typeof template !== 'string' || template.length === 0)
    ) {
      throw new Error(
        `send-render.yaml: skills.${skill} declares render: ${render} but names no template`
      )
    }
    out.set(skill, {
      skill,
      render: render as RenderMode,
      template: typeof template === 'string' ? template : null,
    })
  }
  return out
}

/**
 * The `skill_bindings.<skill>.outbound` column of output-classes.yaml
 * (`derived` | `none`), the list CI already keeps honest
 * (test_output_class_conformance.py). Malformed THROWS for the same reason as
 * above.
 */
export function parseOutboundBindings(yamlText: string): Map<string, string> {
  const parsed: unknown = parseYaml(yamlText)
  const bindings = (parsed as { skill_bindings?: unknown } | null)?.skill_bindings
  if (typeof bindings !== 'object' || bindings === null || Array.isArray(bindings)) {
    throw new Error('output-classes.yaml: expected a `skill_bindings` mapping')
  }
  const out = new Map<string, string>()
  for (const [skill, entry] of Object.entries(bindings as Record<string, unknown>)) {
    const outbound = (entry as { outbound?: unknown } | null)?.outbound
    out.set(skill, typeof outbound === 'string' ? outbound : '')
  }
  return out
}

export interface ArmingViolation {
  seat: string
  skill: string
  code: 'undeclared-render' | 'missing-template' | 'unknown-outbound'
  message: string
}

export interface ArmingInput {
  seat: string
  /** The seat's cron rows (all personas, already schema-validated upstream). */
  cron: readonly { skill: string }[]
  outbound: Map<string, string>
  renders: Map<string, RenderDecl>
  templateExists: (path: string) => boolean
}

/**
 * The three-file join. Only `outbound: derived` skills are gated: an
 * `outbound: none` routine sends nothing by construction, and gating it would
 * force declarations about bodies that cannot exist.
 */
export function armingViolations(input: ArmingInput): ArmingViolation[] {
  const violations: ArmingViolation[] = []
  const seen = new Set<string>()
  for (const row of input.cron) {
    if (seen.has(row.skill)) continue
    seen.add(row.skill)
    if (!input.outbound.has(row.skill)) {
      violations.push({
        seat: input.seat,
        skill: row.skill,
        code: 'unknown-outbound',
        message:
          `${input.seat}: cron arms "${row.skill}" but output-classes.yaml has no ` +
          'skill_bindings entry for it, so whether it sends cannot be evaluated ' +
          '(cannot-evaluate must never read as permitted)',
      })
      continue
    }
    if (input.outbound.get(row.skill) !== 'derived') continue
    const decl = input.renders.get(row.skill)
    if (decl === undefined) {
      violations.push({
        seat: input.seat,
        skill: row.skill,
        code: 'undeclared-render',
        message:
          `${input.seat}: "${row.skill}" is cron-armed and outbound: derived but ` +
          'operator/contracts/send-render.yaml does not declare it -- armed to send ' +
          'with no authored render declaration (declare it templated, slot-templated, ' +
          'or explicitly compositional)',
      })
      continue
    }
    if (
      (HASH_VERIFIED_MODES as readonly string[]).includes(decl.render) &&
      (decl.template === null || !input.templateExists(decl.template))
    ) {
      violations.push({
        seat: input.seat,
        skill: row.skill,
        code: 'missing-template',
        message:
          `${input.seat}: "${row.skill}" is declared render: ${decl.render} but its ` +
          `template artifact (${decl.template ?? 'unnamed'}) does not exist on disk`,
      })
    }
  }
  return violations
}

/**
 * Contract hygiene, independent of any seat: every hash-verified declaration's
 * template must exist. Checked by the merge gate so a template deletion cannot
 * strand a declaration.
 */
export function templateHygieneViolations(
  renders: Map<string, RenderDecl>,
  templateExists: (path: string) => boolean
): ArmingViolation[] {
  const violations: ArmingViolation[] = []
  for (const decl of renders.values()) {
    if (!(HASH_VERIFIED_MODES as readonly string[]).includes(decl.render)) continue
    if (decl.template === null || !templateExists(decl.template)) {
      violations.push({
        seat: '(contract)',
        skill: decl.skill,
        code: 'missing-template',
        message:
          `send-render.yaml declares "${decl.skill}" render: ${decl.render} but its ` +
          `template artifact (${decl.template ?? 'unnamed'}) does not exist on disk`,
      })
    }
  }
  return violations
}
