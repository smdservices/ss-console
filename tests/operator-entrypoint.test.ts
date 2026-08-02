/**
 * Regression guard: the customer-Machine entrypoint must launch the Workspace
 * broker under a ROOT respawn supervisor (OP-P1-4 follow-up).
 *
 * The broker is the second principal that BOTH the Google capability path AND the
 * append-only audit_append path depend on. If it dies mid-run with no supervisor,
 * audit silently fails OPEN and Google capability stops — with no signal. Only a
 * root process can re-`setpriv` a fresh broker to uid workspace-broker, so the
 * supervisor MUST be forked while the entrypoint is still root, before it
 * exec-drops to the hermes gateway.
 *
 * These assertions lock that shape so a future edit can't quietly regress the
 * broker back to an un-supervised one-shot background launch.
 *
 * @see operator/templates/entrypoint.sh
 * @see docs/security/operator-threat-model.md  (§9 — WS5 / OP-P1-4)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ENTRYPOINT = readFileSync(resolve('operator/templates/entrypoint.sh'), 'utf8')

// Strip `#`-comment lines so assertions match executable content only — the
// supervisor's rationale comments deliberately NAME the failure mode.
const ENTRYPOINT_CODE = ENTRYPOINT.split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n')

describe('Operator customer Machine entrypoint — broker respawn supervisor', () => {
  it('defines the broker launch once, as a reusable function', () => {
    expect(ENTRYPOINT_CODE).toMatch(/launch_broker\(\)\s*\{/)
    // The broker module is referenced exactly once (inside the function), so the
    // supervisor is the sole launch site — no parallel un-supervised copy.
    const hits = ENTRYPOINT_CODE.match(/-m\s+workspace_broker\.server/g) ?? []
    expect(hits.length, 'broker should be launched from exactly one site').toBe(1)
  })

  it('runs the broker under a backgrounded while-true respawn loop', () => {
    // A subshell loop that re-invokes launch_broker forever, backgrounded so the
    // parent can proceed to the socket-wait and the exec-drop.
    expect(ENTRYPOINT_CODE).toMatch(/while\s+true;?\s*do[\s\S]*?launch_broker[\s\S]*?done\s*\)\s*&/)
    expect(ENTRYPOINT_CODE).toMatch(/SUPERVISOR_PID=\$!/)
  })

  it('never launches the broker as an un-supervised one-shot background job', () => {
    // The exact regression this guards: `... workspace_broker.server &` outside
    // the supervised loop, which can't be respawned after death.
    expect(
      /workspace_broker\.server\s*&/.test(ENTRYPOINT_CODE),
      'broker must not be backgrounded directly; only the supervisor subshell is backgrounded'
    ).toBe(false)
  })

  it('forks the supervisor while still root, BEFORE dropping to the hermes gateway', () => {
    const supervisorIdx = ENTRYPOINT_CODE.indexOf('SUPERVISOR_PID=$!')
    const hermesExec = ENTRYPOINT_CODE.search(/exec\s+setpriv[\s\S]*?--reuid=hermes/)
    expect(supervisorIdx, 'supervisor must be present').toBeGreaterThan(-1)
    expect(hermesExec, 'hermes exec-drop must be present').toBeGreaterThan(-1)
    expect(
      supervisorIdx < hermesExec,
      'the supervisor must be forked before the exec-drop to hermes (else it would not be root)'
    ).toBe(true)
  })

  it('preserves the gateway PID into each respawn (SO_PEERCRED gate survives)', () => {
    // The broker admits only the gateway PID; respawns must carry the same
    // SMD_GATEWAY_PID (the entrypoint PID, preserved across the exec).
    expect(ENTRYPOINT_CODE).toMatch(/SMD_GATEWAY_PID=["']?\$\{SMD_GATEWAY_PID\}/)
  })

  it('tears down the supervisor (not a stale broker PID) if the socket never appears', () => {
    expect(ENTRYPOINT_CODE).toMatch(/kill\s+"\$\{SUPERVISOR_PID\}"/)
    // The old BROKER_PID variable is gone — the supervised loop owns the lifecycle.
    expect(/BROKER_PID=/.test(ENTRYPOINT_CODE)).toBe(false)
  })
})

/**
 * Regression guard: the ADR 0085 establishment spool and root intake launch
 * (ss#2161/#2162).
 *
 * The spool is the trust boundary an admin-instructed voice/shape submission
 * crosses: broker-written staging/runs, root-written results, hermes denied at
 * every level. Every directory must be EXPLICITLY owned and moded — a
 * default-moded ancestor silently widens the whole tree (the spec_applier
 * _harden_ancestors incident). The intake launch must be import-gated so a
 * lagging overlay pin degrades to a loud "not launched" line, never a broken
 * boot.
 */
describe('Operator customer Machine entrypoint — ADR 0085 establishment spool + intake', () => {
  it('creates every spool directory with an explicit owner and mode (no mkdir -p defaults)', () => {
    expect(ENTRYPOINT_CODE).toMatch(
      /install -d -o root -g workspace-broker -m 0750 "\$\{ESTABLISH_SPOOL_DIR\}"/
    )
    for (const child of ['staging', 'runs', 'results']) {
      expect(ENTRYPOINT_CODE).toMatch(
        new RegExp(
          `install -d -o root -g workspace-broker -m 0770 "\\$\\{ESTABLISH_SPOOL_DIR\\}/${child}"`
        )
      )
    }
    // The spool must never be created by a bare mkdir, whose mode is umask luck.
    expect(/mkdir[^\n]*establish-spool/.test(ENTRYPOINT_CODE)).toBe(false)
  })

  it('exports the spool path and carries it into the broker env allowlist', () => {
    expect(ENTRYPOINT_CODE).toMatch(/export SMD_ESTABLISH_SPOOL_DIR="\$\{ESTABLISH_SPOOL_DIR\}"/)
    // launch_broker runs env -i with a fixed allowlist; the spool var must be
    // named there or the broker boots establishment-disabled forever.
    const launchFn = ENTRYPOINT_CODE.slice(
      ENTRYPOINT_CODE.indexOf('launch_broker()'),
      ENTRYPOINT_CODE.indexOf('-m workspace_broker.server')
    )
    expect(launchFn).toMatch(/SMD_ESTABLISH_SPOOL_DIR="\$\{SMD_ESTABLISH_SPOOL_DIR\}"/)
  })

  it('launches the root intake under an import-gated respawn loop, before the exec-drop', () => {
    // Gated: a lagging overlay (no establish_intake module) must degrade to
    // "not launched", never a broken boot.
    expect(ENTRYPOINT_CODE).toMatch(/python -c "import establish_intake"/)
    expect(ENTRYPOINT_CODE).toMatch(
      /while\s+true;?\s*do[\s\S]*?-m establish_intake[\s\S]*?done\s*\)\s*&/
    )
    const launchIdx = ENTRYPOINT_CODE.indexOf('-m establish_intake')
    const hermesExec = ENTRYPOINT_CODE.search(/exec\s+setpriv[\s\S]*?--reuid=hermes/)
    expect(launchIdx).toBeGreaterThan(-1)
    expect(
      launchIdx < hermesExec,
      'the intake must be forked while still root (it holds the R2 write credential)'
    ).toBe(true)
  })

  it('says so loudly when the intake is NOT launched', () => {
    expect(ENTRYPOINT_CODE).toMatch(/Root establishment intake NOT launched/)
  })
})

/**
 * Regression guard: the entrypoint must run the ADR 0009 cross-machine
 * isolation boot check (invariant_7 `verify_at_boot`) before it hands off to
 * the agent runtime, and must fail closed — including when the invariant module
 * itself is missing or unimportable (SEC-22).
 *
 * @see operator/safety-substrate/invariants/invariant_7.py
 * @see docs/adr/0009-cross-machine-query-prohibition.md
 */
describe('Operator customer Machine entrypoint — ADR 0009 / SEC-22 isolation boot check', () => {
  it('invokes the invariant_7 boot check', () => {
    expect(ENTRYPOINT_CODE).toMatch(/safety-substrate\/invariants\/invariant_7\.py/)
    // Runs the module directly (its __main__ shim == verify_at_boot).
    expect(ENTRYPOINT_CODE).toMatch(/python3\s+"\$\{INVARIANT7_BOOT_CHECK\}"/)
  })

  it('fails closed on a missing invariant module (degraded substrate is a refusal, not a skip)', () => {
    // `[ ! -f "${INVARIANT7_BOOT_CHECK}" ]` -> exit 3, before the check can run.
    expect(ENTRYPOINT_CODE).toMatch(
      /\[\s*!\s+-f\s+"\$\{INVARIANT7_BOOT_CHECK\}"\s*\][\s\S]*?exit 3/
    )
  })

  it('refuses the boot (exit 3) on any non-zero check result — violation OR import error', () => {
    // The if/else around the python invocation must exit 3 in the else branch,
    // so an unimportable module (non-zero exit, no verify_at_boot pass) also
    // fails closed rather than falling through to the exec-drop.
    expect(ENTRYPOINT_CODE).toMatch(
      /if\s+\/opt\/hermes\/\.venv\/bin\/python3\s+"\$\{INVARIANT7_BOOT_CHECK\}";\s*then[\s\S]*?else[\s\S]*?exit 3[\s\S]*?fi/
    )
  })

  it('runs the boot check BEFORE the exec-drop to the hermes gateway', () => {
    const checkIdx = ENTRYPOINT_CODE.indexOf('INVARIANT7_BOOT_CHECK=')
    const hermesExec = ENTRYPOINT_CODE.search(/exec\s+setpriv[\s\S]*?--reuid=hermes/)
    expect(checkIdx, 'the boot check must be present').toBeGreaterThan(-1)
    expect(hermesExec, 'hermes exec-drop must be present').toBeGreaterThan(-1)
    expect(
      checkIdx < hermesExec,
      'isolation must be verified before the Machine serves any agent turn'
    ).toBe(true)
  })
})
