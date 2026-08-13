/**
 * The msgraph channel refuses to provision on ONE Graph app registration.
 *
 * WHY THIS IS A REFUSAL AND NOT A WARNING. A Microsoft Graph app-only token is
 * always `/.default` — every application permission the registration already
 * holds, with no per-request scope-down. One registration is therefore one
 * permission set: if it can read the mailbox it can also send from it the moment
 * `Mail.Send` is granted. So the read/send split this channel needs cannot be
 * expressed inside a single app; it needs two, and the agent process must hold
 * only the read-only one. Captain decision 2026-08-13 made that REQUIRED, which
 * turned the previous "warn and continue on the read app's values" fallback into
 * a defect: while it was taken, the broker's key WAS the agent's key, so only the
 * governed path was fenced and a rogue in-agent path could still mint its own
 * token and POST /sendMail — the shape of the ss#2258 incident.
 *
 * WHAT THIS TEST DRIVES. The real fence text, extracted from
 * `operator/bin/provision-customer.sh` between its `msgraph-two-app-fence`
 * sentinels and executed in a harness that stubs only `die` and the surrounding
 * variables. Extracting rather than restating is the point: a copy of the logic
 * would keep passing after the script stopped refusing. The block sits at step 6
 * of a script that has already talked to R2, Fly, and git by the time it runs, so
 * driving the whole script here is not on the table — but the fence itself is
 * pure string comparison and needs none of that.
 *
 * The four arms are all driven, including the pass-through, because a refusal
 * that refuses everything is not a fence.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../operator/bin/provision-customer.sh', import.meta.url))

function fenceSource(): string {
  const text = readFileSync(SCRIPT, 'utf8')
  const start = text.indexOf('# >>> msgraph-two-app-fence')
  const end = text.indexOf('# <<< msgraph-two-app-fence')
  expect(start, 'opening fence sentinel missing from provision-customer.sh').toBeGreaterThan(-1)
  expect(end, 'closing fence sentinel missing from provision-customer.sh').toBeGreaterThan(start)
  const block = text.slice(start, end)
  // The fence must still be able to refuse. A block with no `die` measures nothing.
  expect(block).toContain('die ')
  return block
}

type Env = Record<string, string>

interface Outcome {
  status: number
  output: string
}

/**
 * Run the extracted fence with the variables the script would have in scope.
 * `die` is stubbed to print and exit 1 — the same contract the real one has
 * (`die() { log "FATAL: $*"; exit 1; }`).
 */
function runFence(env: Env): Outcome {
  const harness = [
    'set -euo pipefail',
    'die() { echo "FATAL: $*"; exit 1; }',
    'CUSTOMER_ID="${CUSTOMER_ID}"',
    'CUSTOMER_YAML="/tmp/customer.yaml"',
    fenceSource(),
    'echo "FENCE-PASSED client=${_MSG_SEND_CLIENT} tenant=${_MSG_SEND_TENANT}"',
  ].join('\n')
  try {
    const output = execFileSync('bash', ['-c', harness], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...env },
    })
    return { status: 0, output }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/** A seat whose READ app is authored and whose SEND app is staged distinctly. */
function baseEnv(): Env {
  return {
    CUSTOMER_ID: 'acme-law',
    _MSG_TENANT: 'tenant-guid',
    _MSG_CLIENT: 'read-app-guid',
    _MSG_SECRET_VALUE: 'read-app-secret',
    _MSG_MAILBOX: 'operator@acmelaw.com',
  }
}

describe('msgraph two-app fence (provision-customer.sh)', () => {
  it('provisions when the send app is a genuinely distinct registration', () => {
    const result = runFence({
      ...baseEnv(),
      MSGRAPH_SEND_CLIENT_ID__ACME_LAW: 'send-app-guid',
      MSGRAPH_SEND_CLIENT_SECRET__ACME_LAW: 'send-app-secret',
    })
    expect(result.output).toContain('FENCE-PASSED client=send-app-guid')
    expect(result.status).toBe(0)
    // The tenant is shared on purpose: both registrations live in the client's
    // own tenant, so that one field alone still falls back to the read app's.
    expect(result.output).toContain('tenant=tenant-guid')
  })

  it('refuses a seat with no send credential staged at all, naming both variables', () => {
    const result = runFence(baseEnv())
    expect(result.status).toBe(1)
    expect(result.output).toContain('has no SEND app credential')
    expect(result.output).toContain('MSGRAPH_SEND_CLIENT_ID__ACME_LAW')
    expect(result.output).toContain('MSGRAPH_SEND_CLIENT_SECRET__ACME_LAW')
  })

  it('refuses a seat whose send client id equals the read app (the old fallback)', () => {
    const result = runFence({
      ...baseEnv(),
      MSGRAPH_SEND_CLIENT_ID__ACME_LAW: 'read-app-guid',
      MSGRAPH_SEND_CLIENT_SECRET__ACME_LAW: 'send-app-secret',
    })
    expect(result.status).toBe(1)
    expect(result.output).toContain('SAME Graph app for read and send')
    expect(result.output).toContain('MSGRAPH_SEND_CLIENT_ID__ACME_LAW')
  })

  it('refuses a half-staged seat: two client ids but one client secret', () => {
    const result = runFence({
      ...baseEnv(),
      MSGRAPH_SEND_CLIENT_ID__ACME_LAW: 'send-app-guid',
      MSGRAPH_SEND_CLIENT_SECRET__ACME_LAW: 'read-app-secret',
    })
    expect(result.status).toBe(1)
    expect(result.output).toContain('same client secret for read and send')
    expect(result.output).toContain('MSGRAPH_SEND_CLIENT_SECRET__ACME_LAW')
  })

  it('does not silently fall back to the read app when only the global name is set', () => {
    // A global MSGRAPH_SEND_CLIENT_ID is still honoured (single-tenant operator
    // envs predate the per-seat names), but it must name a DIFFERENT app.
    const sameApp = runFence({
      ...baseEnv(),
      MSGRAPH_SEND_CLIENT_ID: 'read-app-guid',
      MSGRAPH_SEND_CLIENT_SECRET: 'read-app-secret',
    })
    expect(sameApp.status).toBe(1)

    const distinct = runFence({
      ...baseEnv(),
      MSGRAPH_SEND_CLIENT_ID: 'send-app-guid',
      MSGRAPH_SEND_CLIENT_SECRET: 'send-app-secret',
    })
    expect(distinct.status).toBe(0)
  })
})
