/**
 * Regression guard: the customer-Machine Dockerfile must pin the overlay and
 * fail CLOSED on a broken harness install.
 *
 * Two stacked bugs once shipped a silently harness-less Machine (first-boot
 * audit, 2026-05-29):
 *   1. OVERLAY_REF was pinned at v0.1.1, which predates `shared/outbound_gate.py`
 *      — the trust plugin's `from shared.outbound_gate import evaluate` would
 *      ImportError at runtime.
 *   2. The `hermes plugins install` step ended in `|| echo "WARN ...; continuing"`,
 *      swallowing that failure so the image built green and booted an agent with
 *      no trust/inbound/outbound harness.
 *
 * This is the exact fail-open antipattern the venture forbids (stub/NoOp default
 * reaches the live path and reports success). These assertions lock the fix.
 *
 * @see operator/templates/Dockerfile
 * @see docs/runbooks/operator/first-boot.md
 * @see docs/adr/0028-outbound-integrity-gates-provenance-and-voice.md
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const DOCKERFILE = readFileSync(resolve('operator/templates/Dockerfile'), 'utf8')
const BOOTSTRAP = readFileSync(resolve('operator/templates/bootstrap.sh'), 'utf8')

// Strip `#`-comment lines so NEGATIVE assertions (e.g. "no honcho.server")
// match executable content only — the Honcho-deferral comments deliberately
// NAME the removed commands to explain why they are gone.
const stripHashComments = (s: string): string =>
  s
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
const DOCKERFILE_CODE = stripHashComments(DOCKERFILE)
const BOOTSTRAP_CODE = stripHashComments(BOOTSTRAP)

describe('Operator customer Machine Dockerfile', () => {
  it('pins OVERLAY_REF to a release tag or a full commit SHA, never a branch', () => {
    // During a first-boot proof OVERLAY_REF is a 40-hex commit SHA on a feature
    // branch; after the boot is green it is repointed to a vX.Y.Z release tag
    // (see the plan's "tag last" sequencing). A bare branch name (e.g. `main`)
    // is never acceptable — it would let the pip-installed `shared` policy core
    // drift silently. The import assert below is the real harness-present gate.
    const m = DOCKERFILE.match(/ARG\s+OVERLAY_REF=["']?([^"'\s]+)["']?/)
    expect(m, 'OVERLAY_REF must be set').not.toBeNull()
    const ref = m![1]
    const isSemver = /^v\d+\.\d+\.\d+$/.test(ref)
    const isSha = /^[0-9a-f]{40}$/.test(ref)
    expect(
      isSemver || isSha,
      `OVERLAY_REF must be a vX.Y.Z tag or a 40-hex commit SHA, got "${ref}"`
    ).toBe(true)
  })

  it('pins the broker-capable overlay revision', () => {
    expect(DOCKERFILE).toContain('ARG OVERLAY_REF="5dd3ebb651b25d63a93846fc858613d20fbb0c39"')
  })

  it('does NOT swallow a failed plugin install (no fail-open `|| echo ... continuing`)', () => {
    // The specific regression: a `|| echo "WARN ...; continuing"` on the plugin
    // install line that let a harness-less image build green.
    expect(
      /plugins install[\s\S]{0,160}?\|\|\s*echo[^\n]*continuing/i.test(DOCKERFILE),
      'hermes plugins install must not fall through to a warning-and-continue'
    ).toBe(false)
  })

  it('hard-asserts the overlay policy core is importable at build time', () => {
    // The deterministic build gate that catches a stale/mis-pinned `shared`
    // package (the v0.1.1 ModuleNotFoundError) before the Machine ever boots.
    expect(
      DOCKERFILE.includes('import shared.outbound_gate'),
      'Dockerfile must assert `import shared.outbound_gate` succeeds in the venv'
    ).toBe(true)
    expect(DOCKERFILE).toMatch(/from shared\.outbound_gate import evaluate/)
  })
})

/**
 * Regression guard: the first-boot build/runtime fixes (first real boot,
 * 2026-05-30). Three stacked defects meant the Machine had never booted:
 *   1. `postgresql-16` is not in Debian 13 (trixie ships PG 17) — build exit 100.
 *   2. The uv-created venv has no `pip` binary; `.venv/bin/pip install` exits 127.
 *   3. The venv was not on PATH, so bare `python3 -m honcho.*` / `hermes-smd`
 *      resolved to /usr/bin and crashlooped at boot.
 */
describe('Operator Machine first-boot build/runtime fixes', () => {
  it('installs postgresql-17 (Debian 13 default), never postgresql-16', () => {
    expect(
      /apt-get install[\s\S]*?postgresql-17 postgresql-client-17/.test(DOCKERFILE),
      'apt must install postgresql-17 / postgresql-client-17'
    ).toBe(true)
    expect(
      /apt-get install[\s\S]*?postgresql-16 postgresql-client-16/.test(DOCKERFILE),
      'postgresql-16 is not in Debian 13 trixie repos — build fails with exit 100'
    ).toBe(false)
    expect(DOCKERFILE, 'Postgres bin PATH must target /17/, not /16/').not.toMatch(
      /usr\/lib\/postgresql\/16\/bin/
    )
  })

  it('installs into the venv via `uv pip`, never the absent `.venv/bin/pip`', () => {
    expect(
      /\.venv\/bin\/pip install/.test(DOCKERFILE),
      'uv venvs ship no pip binary; `.venv/bin/pip install` exits 127 — use `uv pip install`'
    ).toBe(false)
  })

  it('bootstrap.sh puts the Hermes venv on PATH', () => {
    expect(
      /export PATH="\/opt\/hermes\/\.venv\/bin:/.test(BOOTSTRAP),
      'bootstrap.sh must prepend the venv to PATH so bare hermes/hermes-smd resolve to it'
    ).toBe(true)
    // Postgres is no longer started in bootstrap (Honcho deferred), so the
    // PG_BIN/17 reference moved out of bootstrap.sh — see the Honcho-deferral
    // suite below. Postgres 17 stays INSTALLED in the Dockerfile (asserted above).
  })
})

/**
 * Regression guard: Honcho is deferred to Phase 2 (ADR 0016, revised
 * 2026-05-30). The never-booted Machine died at the fictional Honcho steps —
 * `python -m honcho.{migrations,server}` against `honcho-ai`, which is the
 * client SDK, not the server. These lock the deletion + the correct launch
 * verb so the boot path can't regress back into the fiction.
 *
 * Assertions run against comment-stripped content: the deferral comments
 * intentionally name the removed commands.
 */
describe('Operator Machine: Honcho deferred, flat-file core (ADR 0016 revised)', () => {
  it('Dockerfile does not install the fictional honcho-ai client SDK', () => {
    expect(
      /honcho-ai/.test(DOCKERFILE_CODE),
      'honcho-ai is the Honcho CLIENT SDK, not the server — it must not be installed'
    ).toBe(false)
    expect(/HONCHO_PIP_SPEC/.test(DOCKERFILE_CODE)).toBe(false)
  })

  it('bootstrap.sh does not run the fictional honcho migrations/server', () => {
    expect(
      /python3?\s+-m\s+honcho\.(migrations|server)/.test(BOOTSTRAP_CODE),
      '`python -m honcho.{migrations,server}` never existed — the boot died here'
    ).toBe(false)
  })

  it('bootstrap.sh launches the active-persona gateway daemon, not the default profile or the chat REPL', () => {
    // Must run `hermes gateway run` (daemon) targeting a persona profile via
    // `-p <slug>`. A bare `hermes gateway run` runs Hermes' built-in `default`
    // profile — no model, SOUL.md, skills, or connector wiring — i.e. not the
    // customer's agent. The `-p` flag is the regression guard for that bug.
    expect(
      /exec\s+\S*hermes\s+-p\s+\S+\s+gateway\s+run/.test(BOOTSTRAP_CODE),
      'an unattended Machine must `exec hermes -p <profile> gateway run`'
    ).toBe(true)
    expect(
      /exec\s+\S*hermes\s+chat\b/.test(BOOTSTRAP_CODE),
      '`hermes chat` is an interactive REPL — wrong for PID-1 with no TTY'
    ).toBe(false)
  })

  it('bootstrap.sh does not require the Honcho secrets at boot', () => {
    // HONCHO_API_KEY / SMD_D1_OBSERVATIONS_BINDING moved to OPTIONAL_ENV; a
    // Phase-1 boot must not fail-closed on their absence.
    const required = stripHashComments(BOOTSTRAP.match(/REQUIRED_ENV=\(([\s\S]*?)\n\)/)?.[1] ?? '')
    expect(/HONCHO_API_KEY/.test(required), 'HONCHO_API_KEY must not be required in Phase 1').toBe(
      false
    )
    expect(
      /SMD_D1_OBSERVATIONS_BINDING/.test(required),
      'SMD_D1_OBSERVATIONS_BINDING must not be required in Phase 1'
    ).toBe(false)
  })
})

describe('Operator Machine profile guards', () => {
  it('installs and enables the overlay inside the active profile Hermes home', () => {
    expect(
      BOOTSTRAP.includes('PROFILE_HERMES_HOME="${HERMES_HOME}/profiles/${ACTIVE_PROFILE}"'),
      'bootstrap.sh must name the Hermes home selected by `hermes -p <profile>`'
    ).toBe(true)
    expect(
      BOOTSTRAP.includes(
        'PROFILE_OVERLAY_PLUGIN_DIR="${PROFILE_HERMES_HOME}/plugins/hermes-smd-overlay"'
      ),
      'profiled plugin discovery must receive the pinned overlay pack'
    ).toBe(true)
    expect(
      BOOTSTRAP_CODE.includes('hermes -p "${ACTIVE_PROFILE}" plugins enable hermes-smd-overlay'),
      'the overlay must be enabled in the active profile config'
    ).toBe(true)
  })

  it('seeds and hard-gates the activation hook inside the active profile', () => {
    expect(
      BOOTSTRAP.includes('PROFILE_HOOKS_DIR="${PROFILE_HERMES_HOME}/hooks"'),
      'HookRegistry resolves hooks from the profiled Hermes home'
    ).toBe(true)
    expect(
      BOOTSTRAP.includes('ACTIVATION_HOOK_DIR="${PROFILE_HOOKS_DIR}/smd-overlay-activation"'),
      'the boot gate must validate the hook path the profiled gateway scans'
    ).toBe(true)
    expect(
      BOOTSTRAP.indexOf('ACTIVATION_HOOK_DIR="${PROFILE_HOOKS_DIR}') <
        BOOTSTRAP.indexOf('exec /opt/hermes/.venv/bin/hermes -p "${ACTIVE_PROFILE}" gateway run'),
      'the live activation hook must be installed before gateway startup'
    ).toBe(true)
  })

  it('packages and runs the disabled-skills guard before the gateway starts', () => {
    expect(
      DOCKERFILE.includes(
        'COPY operator/templates/ensure-disabled-skills.py /app/ensure-disabled-skills.py'
      ),
      'Dockerfile must package the disabled-skills guard'
    ).toBe(true)
    expect(
      BOOTSTRAP.includes('/app/ensure-disabled-skills.py "${CUSTOMER_YAML}" "${HERMES_HOME}"'),
      'bootstrap.sh must enforce persona skills_disabled after profile materialization'
    ).toBe(true)
    expect(
      BOOTSTRAP.indexOf('/app/ensure-disabled-skills.py') <
        BOOTSTRAP.indexOf('exec /opt/hermes/.venv/bin/hermes -p "${ACTIVE_PROFILE}" gateway run'),
      'disabled-skills guard must run before the Hermes gateway exec'
    ).toBe(true)
  })

  it('packages and runs the operator identity guard before the gateway starts', () => {
    expect(
      DOCKERFILE.includes(
        'COPY operator/templates/ensure-operator-identity.py /app/ensure-operator-identity.py'
      ),
      'Dockerfile must package the operator identity guard'
    ).toBe(true)
    expect(
      BOOTSTRAP.includes('/app/ensure-operator-identity.py "${CUSTOMER_YAML}" "${HERMES_HOME}"'),
      'bootstrap.sh must write customer-owned identity facts into SOUL.md'
    ).toBe(true)
    expect(
      BOOTSTRAP.indexOf('/app/ensure-operator-identity.py') <
        BOOTSTRAP.indexOf('exec /opt/hermes/.venv/bin/hermes -p "${ACTIVE_PROFILE}" gateway run'),
      'operator identity guard must run before the Hermes gateway exec'
    ).toBe(true)
  })
})
