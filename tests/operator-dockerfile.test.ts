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
    // c6ef10d is overlay v0.4.25 (v0.4.24 + #74): THE inbound fix — AgentMail
    // delivers over Svix, which carries the event under `type` not the
    // `event_type` the gate assumed, so the webhook route never matched and the
    // recipient-lock origin was never recorded → relay never sent. Gate now
    // stamps event_type from Svix `type`; origin extraction reads the `data`
    // envelope. v0.4.24 (11bcdc5, #73) added address-keyed origin recovery.
    // v0.4.23 (90dd7f7, #72) classifies AgentMail MCP runtime tool names (P0 —
    // mcp_agentmail_* sends had defaulted to READ). v0.4.22 (8706af4) added #71
    // gate source-stamp + #57 reply relay (then fail-closed). Atop v0.4.21
    // (e0bc503, #69 calendar-read fences) and the #60–#68 security wave. v0.4.17
    // must never be re-pinned (fixed-epoch probe crash-loops the gate).
    // c410c52 (#78) carves standard not-legal-advice / attorney-client
    // disclaimer boilerplate out of the content-floor LEGAL category (clause-
    // local; genuinely sensitive content elsewhere still forces draft) — fixes
    // REPLY_HELD on a benign disclaimer. Atop ed96cebe.
    // 37a27aa (#79) exposes voice_corrections via memory_export (ADR 0048) — the
    // legible relationship surface reads the operator's taught style rules through
    // the runtime-read seam. Superset of c410c52.
    // e4d1f23 (#82) adds the relationship authored behavioral lane (ADR 0048 Phase 2):
    // translate.py materializes the customer.yaml `relationship:` block into SOUL.md +
    // config.yaml, and the config_export seam serves it to the admin surface. Atop 37a27aa.
    // b3294de (#81) adds live reconfiguration (ADR 0044): WS2 live reads, validator parity
    // + on-box secret scan, and the root-owned config_applier (pull → validate → safety →
    // atomic write of /opt/data/customer.yaml). Verified end-to-end on hermes-smd-staging.
    // Superset of e4d1f23 — merges and carries the relationship lane forward.
    // 8d6f1a95 (#85, ss-console #1408) exempts Clerk public IDs (user_/org_) from the
    // secret-scan high-entropy heuristic — fixes a customer-zero crash-loop. Superset of b3294de.
    // a548086 (overlay #87) adds the hermes-smd-peer-memory plugin (ADR 0048 learned lane:
    // per-peer working-preference memory — pre_llm_call sender stash + inject, record_peer_preference
    // tool, post_tool_call server-side attribution + taint-gate, peer_preferences on the agent-state
    // D1 binding + runtime_read seam). Carries overlay #86 (voice_corrections seam rip). Superset of 8d6f1a95.
    // 0e491f9 (#88) materializes wake_policy: pre_run_decides (ADR 0047 phase 2);
    // unblocks pilot-law / pilot-smokeball boot. Superset of a548086.
    // 5a1e3e7 (#92) is the security-audit remediation wave tip: classifies the full
    // Clio MCP surface (#93 — closes a live fail-open where Clio writes ran
    // autonomous on injection-tainted turns), the EFF-07 tool-classification
    // completeness gate (unmapped writes fail-closed), the SEC-05/13 AgentMail
    // inbox-read fence (#90), and the SEC-33 hook-parity guard (#91). Superset of 0e491f9.
    // 0f51821 (#89) emits Hermes' native `delegation` block from customer.yaml
    // `escalation_model`, renders the roster-conditional SOUL escalation instruction,
    // and reads the skill weight marker — the ADR 0049 two-tier (light main +
    // escalate-up) seam. Superset of 5a1e3e7.
    // 72fa21d (#96) wires the previously-orphaned transform_draft() into the
    // transform_llm_output hook — Voice Layer 2 structural reshape post-LLM.
    // 3dcef42 (#97) lands the MCP conversational channel: one ask_operator verb
    // (echo/fetch/store retired), principal-namespaced thread continuity, and
    // source==mcp turns fenced+tainted like inbound email — plus the Clerk OAuth
    // front door. Merging it to main is the durable fix for the reprovision-revert.
    // 8d633a4 (#98) fixes the Machine Clerk binding to authorize clerk_subjects
    // (plural — the authored form), not only the singular key, which had refused
    // every real token identity_not_authored (proven live on hermes-smd 2026-06-17).
    // d8c178e (#99) unfences workspace_gmail_search: it returns only {id, threadId}
    // metadata (no body), so fencing it tainted the result and blocked the agent
    // from reusing the ids as the message_id for the still-fenced body read —
    // making a list→get mailbox read impossible. Superset of 8d633a4; also carries
    // already-merged #95 (unmapped tool → REFUSED) and #94 (SOUL.md principal).
    // e93a3ff classifies native Hermes orientation reads and in-band session
    // writes so mission-critical reads do not get refused after the unknown-tool
    // fail-closed change.
    // a97013e (#101) adds /webhooks/handoff to webhook_gate.py — console→Machine
    // async task handoff (Phase 2, ADR 0043). HMAC bearer auth (WEBHOOK_SECRET_MCP),
    // stamps source=handoff, forwards to Hermes adapter. Enables operator_handoff_task
    // MCP tool (ss-console#1458). Superset of e93a3ff.
    // 1c2171f (#103) fixes cron reconciliation: a persona that drops ALL its cron
    // now has its orphaned managed job removed at boot (it was firing forever);
    // two-pass fail-closed across the reconcile set; HERMES_HOME snapshot/restore.
    // Also a pure ruff-format pass on webhook_gate.py (no logic change). Superset
    // of a97013e.
    // baa9495 (B1 staging): adds the durable task-execution overlay half (job
    // ledger client + hermes-smd-jobs plugin + in-gateway worker). Additive on
    // top of 1c2171f; the vendored adapter twins (and their overlaySha256) are
    // unchanged, so only overlayRef is re-pinned in overlay-pairs.json.
    // af20ecd (#105, ADR 0050 B0): taints the code-execution ingestion channel
    // (execute_code/terminal/process/computer_use). Additive on top of e8411ca;
    // twins unchanged.
    // 713a1e2 (#106): wraps overlay tool schemas under `parameters` so the model
    // can drive them — the 18 workspace_* tools shipped with empty params. Additive
    // on top of af20ecd; tracked twins unchanged.
    // 7f35eba6 (#107, ADR 0053 PR2): the author-built MCP connector platform seam —
    // additive McpConnectorSpec.auth_model + the `reference` synthetic self-test
    // registry entry + its mcp_reference_echo/record literal classification (surprise
    // left unmapped → fail-closed REFUSED). The range 713a1e2..7f35eba6 is exactly
    // this one commit; all four tracked twins verified unchanged.
    // a4db1154 (#108, ADR 0053): register mcp:smokeball — the first real author-built
    // connector — in MCP_CONNECTOR_REGISTRY so translate.py materializes it (its
    // mcp_smokeball_* classification already existed). The range 7f35eba6..a4db1154 is
    // exactly this one commit; all four tracked twins verified unchanged.
    // 3a75703 (#109, ADR 0053): smokeball per-seat env — env_secrets_optional on
    // McpConnectorSpec + the smokeball spec (required SMOKEBALL_ENVIRONMENT, optional
    // auth_mode/refresh_token/account_id) + translate.py optional-env staging loop, for
    // the firm-delegated authorization_code path. The range a4db1154..3a75703 is exactly
    // this one commit; all four tracked twins verified unchanged.
    // 96835fe (#110, ADR 0054): the Machine-hosted Smokeball OAuth callback —
    // shared/oauth_callback.py + a GET /oauth/smokeball/callback route on the gateway,
    // so the firm-delegated consent lands on the customer's own Machine, not a shared
    // Worker. The range 3a75703..96835fe is exactly this one commit; all four tracked
    // twins verified unchanged.
    // 1d6d5b2 (#111, ADR 0055): the reply channel — promotes the recipient-locked
    // autonomous reply to a production capability (plugin hermes-smd-reply) gated on
    // the organization roster (scope.inbound_allow_from), not a fenced switch. Security
    // logic byte-for-byte unchanged. Superset of 96835fe.
    // 33b58ad (#112, ADR 0055): inbound prompt drives create_draft (reply channel)
    // instead of the trust-refused reply_to_message. Superset of 1d6d5b2.
    // 97c59f3 (#114, ADR 0056): the entitlement hard-rebuild — persona exposure +
    // skill initiation replace the scalar trust_ceiling / scope+skill+mailbox
    // action_ceilings; enforce.py reads per-persona exposure from the trusted
    // customer.yaml (never tool args), fail-closed unauthored. Range 33b58ad..97c59f3
    // also includes #113 (smokeball calendar/task/folder classification); all four
    // tracked twins verified unchanged. Lockstep with ss-console #1523 (shared parity
    // hash). Superset of 33b58ad.
    // 22498d6 (#115): the Smokeball webhook gate verifier — webhook_gate.py gains
    // verify_smokeball_signature (raw-key hex HMAC over {Timestamp}|{RequestId}|
    // {ClientId}, body unsigned) + a fail-closed per-vendor dispatch registry +
    // an authoritative source stamp (fixes the Smokeball source="API" routing
    // collision) + a RequestId replay cache + a boot self-check; tests +
    // consumes.yaml. Range 97c59f3..22498d6 is exactly this one commit; all four
    // tracked twins verified unchanged. Pairs with ss-console #1529 (provisioning).
    // Superset of 97c59f3.
    // e1044f19 (#116): the Smokeball connect-triggered webhook reconcile —
    // shared/oauth_callback.py fires the egress reconciler (/app/webhook_reconcile.py
    // --trigger connect) after the OAuth token lands, so a newly-connected firm's
    // webhook subscriptions are ensured without a reboot. Range 22498d6..e1044f19 is
    // exactly this one commit; all four tracked twins verified unchanged. Pairs with
    // the ss-console egress reconciler (engine + orchestrator + boot backstop).
    // Superset of 22498d6.
    // 2b694947 (#117): the gate stamps the verified per-delivery id (RequestId) as
    // top-level event_id so the header-less webhook router has a replay key — fixes
    // the first real Smokeball matter.updated verifying (202) but the router
    // refusing "missing event id". Range e1044f19..2b694947 is exactly this one
    // commit; all four tracked twins verified unchanged. Superset of e1044f19.
    // 9b20a1ac (#118): translate gives non-email skill-routed webhook channels a
    // skill-driving prompt instead of the shared _INBOUND_EMAIL_PROMPT — a verified
    // Smokeball matter.updated reached the agent as an email-draft instruction (it
    // tried agentmail create_draft instead of running matter-memo-on-update). The
    // AgentMail email-reply channel keeps the email prompt; MCP route untouched.
    // 8db15f0 (#119): console-sole Claude door — the Machine retires the direct
    // public /mcp door (POST /mcp → 410; stub-bearer + Clerk-direct auth removed)
    // and adds the authenticated /mcp/turn console-proxy endpoint; the console is
    // now the sole public Claude door and enforces the ADR 0057 grant kill-switch
    // per request. Range 9b20a1ac..8db15f0 touched only webhook_gate.py +
    // test_mcp_channel.py + consumes.yaml; all four tracked twins verified unchanged.
    // d7ce7cc7 (#121): fabrication-gate + self-approval hardening (EFF-01/03,
    // SEC-36/16) — autonomous EXTERNAL_SEND routed through the fabrication/citation
    // gate, Unicode-normalized citation scan, forgeable _current_turn_approval
    // stripped. Changed outbound.py/__init__.py/relay.py/citation_filter.py/tests;
    // all four tracked twins verified unchanged.
    // 22eecbea (#122): Machine-side heartbeat emitter (ADR 0023 Wave 1) — new
    // shared/heartbeat.py runs a fail-soft ticker in the webhook-gate that POSTs
    // to the apex console /api/internal/heartbeat and pings healthchecks.io,
    // closing the gap where the console receiver + fleet_status + admin columns
    // were built but nothing phoned home. Range d7ce7cc7..22eecbea changed
    // heartbeat.py [new] + webhook_gate.py + consumes.yaml + tests; all four
    // tracked twins verified unchanged.
    // d97eb27f (#123): memory-mirror lane silence (ss-console#1643) — the
    // unconfigured Honcho lane (ADR 0016 Phase 2 deferred) no longer logs a
    // per-session 'degraded' WARNING; register() classifies the env contract
    // once at boot and a PARTIAL contract is a loud ERROR naming the missing
    // vars. Range 22eecbea..d97eb27f changed only the mirror plugin + its
    // tests; all four tracked twins verified unchanged.
    expect(DOCKERFILE).toContain('ARG OVERLAY_REF="d97eb27f5642ce0b90ac38e8b51eba729f275a7e"')
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
