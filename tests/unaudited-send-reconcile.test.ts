/**
 * ss#2309. The sibling of ss#2307, in the control that guards audit
 * completeness for the ss#2258 P0 — a message leaving an Operator mailbox with
 * no audit row.
 *
 * `operator/bin/reconcile-sends.py:367` returns `1 if any(r.is_finding ...)`,
 * and its exit-code contract is deliberate and unit-tested on the python side:
 * 0 is clean OR a hold, 1 is a finding. The WORKFLOW STEP consuming it threw
 * that contract away. GitHub runs `run:` bodies under `bash -e`, so the
 * reconciler exiting 1 — the findings code, the only non-zero path that is not
 * an error — aborted the step before `cat reconcile.txt` and before `status`
 * reached GITHUB_OUTPUT, leaving `Open an issue when a send has no audit record`
 * (gated on `status == '1'`) unreachable. A finding would produce a red run with
 * no report and no issue: mute in precisely the case the control exists for.
 *
 * These tests execute the REAL step body extracted from the YAML, under the
 * shell GitHub uses, against a `python3` stub that exits the findings code.
 * Asserting on the body's text would only restate the fix; running it is what
 * can fail.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'unaudited-send-reconcile.yml')

describe('the reconcile step reports what the reconciler found (ss#2309)', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  /** The `run:` body of the reconcile step, dedented, exactly as GitHub runs it. */
  const stepBody = (): string => {
    const source = readFileSync(WORKFLOW, 'utf8')
    const start = source.indexOf('      - name: Reconcile every inbox')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(source.indexOf('run: |', start) + 'run: |\n'.length)
    const lines: string[] = []
    for (const line of body.split('\n')) {
      if (line.trim() !== '' && !line.startsWith('          ')) break
      lines.push(line.slice(10))
    }
    return lines.join('\n')
  }

  /**
   * Run a step body the way the runner does: `bash -e <file>`, with `python3`
   * replaced by a stub on PATH that prints a report and exits `code`.
   */
  const runStep = (body: string, code: number) => {
    dir = mkdtempSync(join(tmpdir(), 'step-2309-'))
    const bin = join(dir, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      join(bin, 'python3'),
      `#!/usr/bin/env bash\necho "UNAUDITED: ops@smdurgan.com 1 send with no audit row"\nexit ${code}\n`
    )
    chmodSync(join(bin, 'python3'), 0o755)
    const outputs = join(dir, 'github_output')
    writeFileSync(outputs, '')
    writeFileSync(join(dir, 'step.sh'), body)
    let stdout: string
    let failed = false
    try {
      stdout = execFileSync('bash', ['-e', join(dir, 'step.sh')], {
        cwd: dir,
        encoding: 'utf-8',
        env: { ...process.env, GITHUB_OUTPUT: outputs, PATH: `${bin}:${process.env.PATH ?? ''}` },
      })
    } catch (err) {
      failed = true
      stdout = String((err as { stdout?: string }).stdout ?? '')
    }
    return { stdout, failed, outputs: readFileSync(outputs, 'utf-8') }
  }

  it('prints the report and records status=1 when a send has no audit row', () => {
    const run = runStep(stepBody(), 1)
    // Without this the finding exists only in an exit code nobody can read.
    expect(run.stdout).toContain('UNAUDITED: ops@smdurgan.com 1 send with no audit row')
    // The issue-opening step is gated on exactly this.
    expect(run.outputs).toContain('status=1')
    // A finding is not an error: the next step handles it, so the step succeeds.
    expect(run.failed).toBe(false)
  })

  it('passes the report through untouched on a clean run or a hold', () => {
    const run = runStep(stepBody(), 0)
    expect(run.failed).toBe(false)
    expect(run.stdout).toContain('UNAUDITED: ops@smdurgan.com 1 send with no audit row')
    expect(run.outputs).toContain('status=0')
  })

  it('still fails the run when the reconciler itself broke (exit 2)', () => {
    const run = runStep(stepBody(), 2)
    expect(run.failed).toBe(true)
    // Even a broken control must not be silent — the output still reaches the log.
    expect(run.stdout).toContain('UNAUDITED: ops@smdurgan.com 1 send with no audit row')
  })

  /**
   * The falsifier. Reintroduce the pre-fix body and confirm this harness
   * reports the defect — otherwise the tests above are green for a reason
   * nobody has established.
   */
  it('detects the regression if the `|| STATUS=$?` guard is removed', () => {
    const regressed = stepBody().replace(/ \|\| STATUS=\$\?/, '\n          STATUS=$?')
    expect(regressed).not.toEqual(stepBody())
    const run = runStep(regressed, 1)
    expect(run.stdout).not.toContain('UNAUDITED')
    expect(run.outputs).not.toContain('status=1')
  })
})
