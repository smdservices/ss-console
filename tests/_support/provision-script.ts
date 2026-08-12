/**
 * Read derivations out of `operator/bin/provision-customer.sh` so cross-side
 * parity tests execute the SCRIPT'S OWN TEXT rather than a transcription of it.
 *
 * Why this exists (ss#2313, from the #2280 audit). The original cross-side HMAC
 * test executed real `bash` + `openssl` — correct instinct — but against a
 * hand-written copy of the pipeline inlined in the test file. That pins a
 * transcription, not the script: editing `provision-customer.sh` (swapping
 * `printf '%s'` for `echo`, changing the `sed` extractor, dropping a quote)
 * left the test green while every derived bearer on every Machine changed. The
 * failure presents as an empty portal page, not an error, because both the
 * runtime-read and MCP-handoff transports fail closed.
 *
 * The contract these helpers enforce: the bytes the test runs come from the
 * file on disk, and a rename or refactor that makes the derivation unfindable
 * throws loudly instead of silently skipping the check.
 *
 * SECRET DISCIPLINE. Inputs are supplied through the child process ENVIRONMENT,
 * never interpolated into the command string. Two consequences, both
 * deliberate: the executed text stays byte-identical to the script's, and no
 * caller can smuggle a real secret into a shell command line (visible in `ps`)
 * or into a test failure message. Callers must pass fixed, non-secret test
 * values.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const PROVISION_SCRIPT = resolve('operator/bin/provision-customer.sh')

/**
 * Extract the command-substitution body of a `VAR="$(...)"` assignment from
 * the provisioner, verbatim.
 *
 * Throws unless exactly one such assignment exists. Zero means the derivation
 * was renamed or removed; more than one means it is ambiguous. Both are states
 * in which this test can no longer certify what it claims, and a test that
 * cannot observe its subject must fail rather than pass (Law 12).
 */
export function scriptDerivation(varName: string): string {
  const open = `${varName}="$(`
  const close = `)"`
  const hits = readFileSync(PROVISION_SCRIPT, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(open) && line.endsWith(close))
    .map((line) => line.slice(open.length, -close.length))
  if (hits.length !== 1) {
    throw new Error(
      `expected exactly one \`${varName}="$(...)"\` assignment in ${PROVISION_SCRIPT}, found ${hits.length}.\n` +
        `The cross-side parity check cannot run without it. If the derivation moved or was ` +
        `renamed, point this test at the new name — do not delete the parity check.`
    )
  }
  return hits[0]
}

/** The provisioner's full text, for asserting how a derived value is staged. */
export function provisionScriptSource(): string {
  return readFileSync(PROVISION_SCRIPT, 'utf-8')
}

/**
 * Execute a script-extracted pipeline under `bash` with fixed, non-secret test
 * inputs supplied via the environment, and return its trimmed stdout.
 *
 * `vars` MUST contain only throwaway test values. The environment is built from
 * scratch (PATH only) so the surrounding process's real operator secrets cannot
 * leak into the derivation and quietly make a broken parity check pass.
 */
export function runDerivation(pipeline: string, vars: Record<string, string>): string {
  return execFileSync('bash', ['-c', pipeline], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...vars },
  })
    .toString()
    .trim()
}
