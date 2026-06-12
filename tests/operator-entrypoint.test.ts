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
