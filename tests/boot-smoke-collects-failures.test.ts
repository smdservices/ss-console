/**
 * boot-smoke-test.sh runs EVERY check and reports all of them (ss#2487).
 *
 * The script used to `exit 1` on the first red. On hermes-ashton-price, the
 * paying client's seat, check 6 sampled a directory property while the
 * provisioner was still writing to that directory. A race: a manual re-run
 * passed 42/42 four minutes later. But the abort meant checks 7 through 42 never
 * ran, and those include `matter-mixing-fence`, the three credential-stripping
 * assertions, and the four medchron gate-refusal probes. The operator saw
 * "FATAL: dependency chain is unhealthy", which reads identically whether the
 * seat is healthy or genuinely compromised.
 *
 * WHY THIS TEST EXISTS AT ALL. The defect being fixed is that a gate was not
 * trustworthy. Shipping the fix on a syntax check would be the same mistake in a
 * smaller package, so the script is EXECUTED here against a stubbed `fly`: one
 * named check is made to fail and the rest succeed, and the assertions are that
 * the run reached the far end, that the summary names exactly the failure, and
 * that the exit code is still non-zero. A fix that reported green on a red check
 * would be worse than the abort it replaced.
 *
 * The stub is a real executable on PATH, not a mock: the script shells out to
 * `fly`, so anything less would test a different program.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve('operator/bin/boot-smoke-test.sh')

/**
 * The stub dir plus a bare system PATH, and nothing else.
 *
 * Inheriting `process.env.PATH` would leave the developer's real `uv` reachable
 * behind the stub, so a local pass would say nothing about a runner that has no
 * `uv` at all. That is precisely the gap that let the first version of this file
 * pass here and fail all three cases in CI. Pinning the PATH makes the local run
 * the same run.
 */
function hermeticPath(stub: string): string {
  return [stub, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
}

// `SS_ENGAGEMENTS_DIR` is pointed at the stub dir on every run below.
//
// Step 14 reads the engagements checkout to decide whether the seat authors a
// medchron firm config, and a MISSING checkout is a precondition abort by
// design: Law 2's fail-closed rule applied to the expectation source, so that
// "cannot evaluate" never reads as "not expected". CI has no clone of a private
// repo, so without this the run FATALs at step 14 and never reaches the end --
// which is what it did on the second CI attempt.
//
// The stub dir exists and contains no medchron config, so the check evaluates
// honestly to "this seat does not author one" and the four gate probes are
// skipped. That is a real answer, not a bypass: the same branch a seat with no
// medchron authored would take.
const scratch: string[] = []
afterEach(() => {
  while (scratch.length) rmSync(scratch.pop() as string, { recursive: true, force: true })
})

/**
 * A `fly` on PATH that reports the Machine started and fails exactly the checks
 * whose command contains one of `failOn`.
 */
function stubDir(failOn: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'boot-smoke-stub-'))
  scratch.push(dir)
  // Needles go in a FILE, read by `grep -F -f`, never interpolated into the
  // stub's source. The check commands contain both quote characters, and an
  // earlier version pasted them into a double-quoted bash test: the embedded
  // `"` closed the quote, the stub became a syntax error, and it exited
  // non-zero for every check -- which presented as "the script failed all 36",
  // a far more alarming and completely wrong result. Fixed data, not code.
  writeFileSync(join(dir, 'needles.txt'), failOn.join('\n'))
  // `fly status --json` answers two questions here: is the Machine started, and
  // what guest is it running. The stub satisfies both, or
  // `guest-matches-authored-size` fails for a reason unrelated to what is under
  // test. pilot-smokeball authors shared-cpu-1x / 1024MB.
  const fly = `#!/usr/bin/env bash
for a in "$@"; do
  [ "$a" = "status" ] && {
    echo '{"Machines":[{"state":"started","config":{"guest":{"cpu_kind":"shared","cpus":1,"memory_mb":1024}}}]}'
    exit 0
  }
done
NEEDLES="$(dirname "$0")/needles.txt"
if [ -s "$NEEDLES" ] && printf '%s' "$*" | grep -qFf "$NEEDLES"; then exit 1; fi
exit 0
`
  writeFileSync(join(dir, 'fly'), fly)
  chmodSync(join(dir, 'fly'), 0o755)

  // A `uv` stub, and the reason it has to exist is itself the point.
  //
  // Step 1b refuses to run without `uv` on PATH, deliberately: the workstation
  // python3 has no pyyaml, and an earlier version swallowed that ImportError
  // into empty authored values and FATALed a healthy seat with nonsense. That
  // refusal is a PRECONDITION, so on a runner without `uv` the script aborts
  // before a single ssh check - which is exactly what happened when this test
  // passed locally and failed in CI on all three cases. A test that only runs
  // where uv happens to be installed is a test that does not run.
  //
  // The stub answers the two questions step 1b asks, by grepping the authored
  // file rather than parsing it. Narrow on purpose: it recognises only the two
  // programs the script sends, and exits non-zero on anything else, so a future
  // third parse cannot be silently answered with a wrong value.
  const uv = `#!/usr/bin/env bash
prog=""; file=""
for a in "$@"; do
  case "$a" in
    *machine*|*hermes_ref*) prog="$a" ;;
    */customer.yaml) file="$a" ;;
  esac
done
[ -n "$file" ] || exit 1
case "$prog" in
  *hermes_ref*) awk -F@ '/^hermes_ref:/{gsub(/[[:space:]]/,"",$2); print $2; exit}' "$file" ;;
  *memory_mb*)  awk '/^machine:/{m=1;next} m&&/memory_mb:/{print $2;exit} m&&/^[^ ]/{exit}' "$file" ;;
  *size*)       awk '/^machine:/{m=1;next} m&&/size:/{print $2;exit} m&&/^[^ ]/{exit}' "$file" ;;
  *)            exit 1 ;;
esac
`
  writeFileSync(join(dir, 'uv'), uv)
  chmodSync(join(dir, 'uv'), 0o755)
  return dir
}

function run(failOn: string[]): { out: string; code: number } {
  const dir = stubDir(failOn)
  try {
    const out = execFileSync('bash', [SCRIPT, 'pilot-smokeball'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: hermeticPath(dir), SS_ENGAGEMENTS_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { out, code: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status ?? -1 }
  }
}

describe('boot smoke reports every check, not just the first red (ss#2487)', () => {
  it('a failing early check does not hide the later ones', () => {
    // `customer-yaml-dir-not-agent-writable` is check 6, the one that raced on
    // the client seat. The needle ends at the closing quote so it cannot also
    // match check 5's `/var/lib/smd-config/customer.yaml` -- an early version
    // did, and turned a one-failure assertion into a two-failure run.
    const { out, code } = run(['test -w /var/lib/smd-config"'])
    expect(out).toContain('FAIL: customer-yaml-dir-not-agent-writable')
    // The far end of the run: this line only prints after the last check.
    expect(out).toContain('All checks executed')
    // Checks that live AFTER the failure must have run.
    expect(out).toMatch(/(PASS|FAIL): hermes-plugins-installed/)
    expect(out).toMatch(/(PASS|FAIL): matter-mixing-fence/)
    expect(out).toMatch(/(PASS|FAIL): msgraph-send-credential-stripped-from-agent/)
    // And it is still a failure.
    expect(code).not.toBe(0)
    expect(out).toContain('checks failed: 1')
  })

  it('the summary names every failure, not just a count', () => {
    const { out } = run(['test -w /var/lib/smd-config"', 'curator'])
    expect(out).toContain('checks failed: 2')
    expect(out).toContain('FAILED: customer-yaml-dir-not-agent-writable')
    expect(out).toContain('FAILED: curator-disabled')
  })

  it('a clean run still exits zero', () => {
    // The control. Without it, every assertion above would pass on a script that
    // failed everything, and "reports all failures" would be trivially true.
    const { out, code } = run([])
    expect(code).toBe(0)
    expect(out).toContain('checks failed: 0')
    expect(out).not.toContain('FAIL:')
  })

  it('a precondition abort still summarizes what had run', () => {
    // The Machine never reaching `started` is not a check result: every ssh
    // check after it would fail for one reason, which is a different way of
    // hiding the answer. It aborts, but not silently.
    const dir = mkdtempSync(join(tmpdir(), 'boot-smoke-stub-'))
    scratch.push(dir)
    writeFileSync(
      join(dir, 'fly'),
      `#!/usr/bin/env bash
for a in "$@"; do [ "$a" = "status" ] && { echo '{"Machines":[{"state":"stopped"}]}'; exit 0; }; done
exit 0
`
    )
    chmodSync(join(dir, 'fly'), 0o755)
    let out: string
    let code = 0
    try {
      out = execFileSync('bash', [SCRIPT, 'pilot-smokeball'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: hermeticPath(dir), SS_ENGAGEMENTS_DIR: dir },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number }
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`
      code = e.status ?? -1
    }
    expect(code).not.toBe(0)
    expect(out).toContain('FATAL: machine-state-started')
    expect(out).toContain('boot smoke summary')
  }, 90_000)
})
