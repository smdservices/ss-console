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
    // a6c8e3fb (#124): cost circuit breaker + inbound wake guard (ADR 0062,
    // ss-console #1661) — vendored sticky_stop twin, cost_breaker glue
    // (Machine-local sqlite + broker-ledger audit sink), job-path exact-cents
    // cap (HARD_STOP dead-letters needs_review), webhook-gate InboundWakeGuard
    // (parks at HARD_STOP / authored inbound_daily_cap), heartbeat gains
    // sticky_stop_level. Range d97eb27f..a6c8e3fb changed shared/{sticky_stop,
    // cost_breaker,gate_inbound_cap}[new] + job_* + webhook_gate + heartbeat +
    // customer_config + consumes.yaml + tests; all four tracked twins verified
    // unchanged.
    // 5b4c99e1 (#125): Captain clear surface (ADR 0062 §6) — gate POST
    // /sticky-stop/clear (console-proxy bearer) clears non-OK sticky_stop rows
    // via the state machine's clear() with audited AGENT_RESUMED; the un-trip
    // path the live trip-fire probe requires. Range a6c8e3fb..5b4c99e1 changed
    // cost_breaker.py + webhook_gate.py + tests; all four tracked twins
    // verified unchanged.
    // 378fd82d (#126): seam exposes persisted cron next_run_at/last_run_at
    // (ss-console#1691) — makes wrong-timezone first fires observable from
    // /runtime/config right after reprovision instead of as a surprise fire.
    // Range 5b4c99e1..378fd82d changed shared/config_snapshot.py + tests;
    // all four tracked twins verified unchanged.
    // 8df1992a (#128): interactive-turn cost metering (option C, ADR 0062 §4
    // amendment, #1701) — shared/interactive_cost_meter.py estimates each
    // interactive turn's cents at the post_llm_call hook and feeds the same
    // sticky_stop ladder, closing the gap the trip probe found. Range
    // 378fd82d..8df1992a changed interactive_cost_meter.py[new] + the audit
    // plugin + tests + vendored pricing; all four tracked twins verified
    // unchanged.
    // 3b2481b8 (#129): ship anthropic_pricing.json in the wheel — the
    // interactive cost meter was dark in prod (pricing excluded from the
    // wheel; alarmed model_unpriced every turn). Range 8df1992a..3b2481b8
    // changed pyproject.toml + a guard test; all four tracked twins unchanged.
    // 122ee0a2 (#130): gate clear succeeds without a Machine audit row —
    // the broker PID-gates appends to the gateway process (OP-P1-4), so
    // the gate can't write the ledger; the resume is audited console-side.
    // 7e70b376 (#131+#132, ss#1686): audit hash chain — CREATE/ensure gain
    // prev_hash/row_hash, audit_export serves them, shared/audit_chain.py
    // lands as the new tracked twin of workspace_broker/chain.py. emit.py
    // twin changed (ensure applies CHAIN_COLUMN_ALTERS) and is re-pinned in
    // overlay-pairs; the broker stamps the chain, writers untouched.
    // c85b0ddb (#133, ss#1701): cost-breaker boot self-probe — the
    // gateway:startup activation handler drives run_boot_probe (throwaway db,
    // ladder trips HARD_STOP + assert_allowed refuses, os._exit(1) if inert),
    // the recurring negative-fire check that earns sticky_stop_cost_cap its
    // `enforced` status. Range 7e70b376..c85b0ddb is a fast-forward touching
    // only handler.py + shared/cost_breaker.py + tests; no tracked twin moved.
    // 50a6545e (#136, L2 DISC-1): mcp_smokeball_read_document mapped READ and
    // FENCED as a tainting content-read — the connector's new server-side
    // document fetch+extraction returns externally-authored text (served
    // discovery, opposing responses), so reading a matter document taints the
    // session like an inbound email. Range c85b0ddb..50a6545e touches only
    // shared/action_classes.py + the inbound fence + tests; no tracked twin moved.
    // (That range ALSO carried #134/#135, the Sentry init + PII scrub — see the
    // Sentry-on-Machines memory; likewise no tracked twin.)
    // 3e5b8a9b (#137, ss#0023): Sentry boot marker — init_sentry now sends one
    // info capture_message("boot: monitoring active") per process, the direct
    // in-Sentry confirmation the gateway init fired (its INFO log is filtered by
    // Hermes' root=WARNING) + a per-boot restart signal. Range 50a6545e..3e5b8a9b
    // touches only shared/sentry_init.py + tests; no tracked twin moved.
    // c081223b (#138, ss#1742/#1744): digest.home_matter_id materializes as a
    // '## Digest home' SOUL section (unauthored = fail-closed, byte-identical);
    // mcp_smokeball_file_attachment_to_matter mapped INTERNAL_WRITE (the
    // credential-free cross-connector attachment transfer). Range
    // 3e5b8a9b..c081223b touches only translate.py + action_classes + tests;
    // no tracked twin moved.
    // 7c10fd61 (#140, ss#1758): caption provenance allowlist for the tier-2
    // citation gate — captions harvested from READ results into the session
    // register; only provenance-verified bare case-name hits are exempt
    // (reporter cites/statutes/rules/tier-1 never relax; empty register =
    // fail-closed). Vendored citation_filter synced from ss#1764 (allowlist +
    // Cal ordinal reporter false-negative fix) and now drift-tracked as a
    // SEC-32 pair in overlay-pairs.json.
    // 07c7a516 (#142 + #138): authored webhook-trigger exceptions — the gate
    // suppresses excluded (matter/actor) deliveries per customer.yaml
    // webhook_triggers[].exclude with a WEBHOOK_SUPPRESSED audit row, fail-open
    // to forward; plus the #1742 digest-home SOUL materializer +
    // mcp_smokeball_file_attachment_to_matter INTERNAL_WRITE mapping (#1744).
    // Range 7c10fd61..07c7a516 touches webhook_gate.py + shared/
    // gate_trigger_exclusions.py + translate.py + action_classes + tests; no
    // tracked twin moved.
    // 3294e909 (#143, ss#1758/#141): the provenance SESSION RESOLVER — core's
    // pre_tool_call fire sites drop session_id, so the register was never
    // consulted under its real key (111/111 tier3 rows empty-register); the
    // trust plugin now notes the real id (new pre_llm_call hook +
    // post_tool_call) and resolves at a single pre-hook choke point. Unblocks
    // the #140 caption exemption + A1 identifier gate. No tracked twin moved.
    // 95fc269f (#144): exclusion matching checks ANY candidate key — the live
    // Smokeball envelope carries a foreign top-level id that defeated first-
    // present-wins precedence (proven by signed probes against the running
    // gate); fail-open config reads now log. Range 3294e909..95fc269f touches
    // shared/gate_trigger_exclusions.py + tests; no tracked twin moved.
    // 6e685b03 (#145): exclusion matching searches the NESTED payload level —
    // the verbatim live envelope (session transcript, 2026-07-07) puts the
    // matter at payload.id with only userId top-level; both prior attempts
    // assumed flat. Regression test pins the verbatim envelope. Range
    // 95fc269f..6e685b03 touches shared/gate_trigger_exclusions.py + tests;
    // no tracked twin moved.
    // af895354 (#146, ss #1791): the webhook gate records WEBHOOK_SUPPRESSED via
    // a new uid-gated broker verb (webhook_suppressed_append) instead of the
    // gateway-PID-gated audit_append that was silently refusing the write —
    // proven live on pilot-smokeball (suppression stood, audit row never
    // persisted). Range 6e685b03..af895354 touches webhook_gate.py +
    // shared/audit_client.py + tests; no tracked twin moved.
    // 138c10a (#147, ss #1796): wire mcp:brave — shared web-search connector
    // (ADR 0070). Range af895354..138c10a touches bootstrap/mcp_registry.py +
    // shared/action_classes.py + tests; no tracked twin moved (every
    // overlaySha256 unchanged, only overlayRef).
    // b9391d8 (#148, ss #1796): fix the Brave runtime tool name to
    // mcp_brave_brave_web_search — live pilot-smokeball verification of #147
    // caught the single-brave name was unmapped -> REFUSED. Range
    // 138c10a..b9391d8 touches shared/action_classes.py + test; no tracked twin.
    // 9189224 (#149, ss #1822, ADR 0072): recipient-aware proactive send —
    // external_send_internal class + recipient_classifier (NEW byte-identical
    // pair) + outbound_recipient registry + evaluate_tool_call reclassification.
    // Range b9391d8..9189224 adds shared/recipient_classifier.py (tracked as a
    // new pair) and touches action_classes.py/enforce.py/__init__.py/validate.py/
    // translate.py (not tracked twins).
    // 539f42c7 (#150, ss #1796, ADR 0070 native cut): retire the mcp:brave
    // connector for Hermes' NATIVE web_search provider. translate._materialize_web_search
    // (native:<provider> -> web.search_backend), mcp_registry brave spec removed,
    // action_classes web_search READ, validate accepts native:. Range
    // 9189224..539f42c7 touches bootstrap/{translate,mcp_registry,validate}.py +
    // shared/action_classes.py + tests; no tracked twin moved (overlaySha256 unchanged).
    // 0c9d165 (#151, ss #1804, ADR 0071): add `confirm` ceiling value +
    // external_send enforcement to plugins/hermes-smd-trust/enforce.py (mirrors
    // the in-tree operator/adapter/trust_ceiling.py). Range 539f42c7..0c9d165
    // touches enforce.py + test; no tracked twin moved (overlaySha256 unchanged).
    // d5187194 (#152, ss ADR 0073): remove the law-firm external_send entry from
    // VERTICAL_FLOORS — outside-send is the firm's authored dial; the floor
    // machinery stays (empty) for future regulation-compelled floors. Range
    // 0c9d165..d5187194 touches shared/action_classes.py + enforce.py +
    // config_applier/safety.py + tests — NOT tracked twins, so every
    // overlaySha256 is unchanged; only overlayRef. Superset of 0c9d165.
    // 8806099 (#153, ADR 0028 §2 / #855 voice live-gate): fail-closed voice
    // gate on allowed autonomous OUTSIDE external_send for voice_library-authored
    // seats — samples + per-turn transform-applied marker (shared/voice_status.py)
    // required, else draft + VOICE_GATE_TRIGGERED. Range d5187194..8806099
    // touches plugins/hermes-smd-trust/{enforce.py,voice_gate.py} +
    // plugins/hermes-smd-voice/__init__.py + shared/voice_status.py + tests —
    // NOT tracked twins, so every overlaySha256 is unchanged; only overlayRef.
    // 78064d3 (#154, ss #1805, ADR 0071): bootstrap/validate.py accepts the
    // `confirm` exposure ceiling for external_send (rejects it off the send
    // classes) — keeps the on-box config_applier validator in lockstep with the
    // console. Range 8806099..78064d3 touches bootstrap/validate.py + contract
    // tests — NOT tracked twins, so every overlaySha256 is unchanged; only overlayRef.
    // 17d33d7 (#156, ADR 0075): recipient-class enrichment — RecipientClass gains
    // CLIENT/VENDOR, typed outbound roster, external_send_client/_vendor action
    // classes wired through enforce/validate/translate. Range 3724e78..17d33d7
    // moves ONE tracked twin (shared/recipient_classifier.py), so that pair's
    // overlaySha256 is re-recorded in overlay-pairs.json alongside this bump.
    // 5b7318cb (#158, ss ADR 0073): authored-exposure SOUL section — the agent
    // acts AT its authored ceiling instead of defaulting below it. translate.py
    // + tests only; no tracked twin moved. Superset of 17d33d7.
    // f3e48d6b (#157, ss #1806, ADR 0071): confirm-over-channel approval stamp —
    // shared/pending_send.py + plugins/hermes-smd-trust/{approval,enforce,__init__}.py
    // + tests. None are tracked twins, so every overlaySha256 is unchanged; only
    // overlayRef. Superset of 5b7318cb.
    // ba5b8179 (#159): stop tracking the repo's .worktrees/ gitlinks — #158 committed
    // live worktree checkouts with no .gitmodules, breaking `uv pip install git+@sha`
    // (git submodule update failed) on EVERY seat rebuild. Untracks + gitignores them.
    // 63a3bca (#162, ADR 0075): proactive outbound relay to rostered client/vendor.
    // fdf8870a (#163, ss #1806, ADR 0071 harden): out-of-band send of the approved
    // confirm payload — the overlay dispatches the send itself (the LLM does not
    // reliably re-invoke on "yes"), re-authorized through the same evaluate_tool_call
    // gate + CONFIRM_SEND_DISPATCHED/FAILED audit rows. Child of #162; carries it.
    // No tracked twin moved; overlayRef-only. Superset of 63a3bca (#162).
    // 36fa158d (#165 + #167, ss #1915/#1916): hermes-smd-escalation mediated
    // ledger tools (escalation_append via the broker verb + escalation_state
    // over the ledger twin — replaces the refused execute_code append snippet
    // found dead by the WP-D live proof) + durable-job tool mappings (the same
    // unmapped ⇒ REFUSED class). NEW tracked twin pair
    // shared/escalation_ledger.py <-> operator/workspace_broker/
    // escalation_ledger.py (sha c4882668). Superset of d6739132 (#164).
    expect(DOCKERFILE).toContain('ARG OVERLAY_REF="36fa158d46209f211eb8653462758888280846c7"')
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
