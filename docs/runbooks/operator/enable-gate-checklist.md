# Enable-gate checklist — before turning on autonomous send or code execution

**Status:** active runbook. **Owner:** Operator platform. **Source:** 2026-07-02 security re-audit (issue [#1634](https://github.com/venturecrane/ss-console/issues/1634)) + the 2026-06-15 audit.

## Why this exists

The Operator is fail-closed by default (ADR 0056): an unconfigured capability is a safety state, not an identity. Almost every hardening item the re-audit surfaced is **defense-in-depth for a capability no current pilot uses** — the A&P pilot runs `draft_for_review`, and the config-ownership root cause (a code-executing agent cannot raise its own ceiling) is closed. So these are not a work queue to grind now.

They become **required** the moment a customer's `customer.yaml` authors one of two high-risk postures:

- **`external_send: autonomous`** — the Operator sends outbound (email/reply/etc.) without a human reviewing the draft.
- **`code_execution` initiation authored** — a persona is exposed to `execute_code` autonomously (not read-only / not draft-gated).

This checklist is the gate. **Do not merge a `customer.yaml` change that authors either posture for a customer until the corresponding items below are green for that customer.** Each item names what "green" means and where the fix lives.

The point is honesty: shelving these is legitimate _because_ they're gated here, not forgotten.

---

## Gate A — before `external_send: autonomous` for any customer

### A1. SEC-05/12 — empty-session turns must not be able to autonomously send

- **Risk.** The taint gate refuses autonomous sensitive actions on a turn tainted by untrusted content. Today an **empty `session_id` reads as `TRUST_CLASS_INTERNAL`** (`shared/inbound.py` `trust_class("")`), so an injection-fed turn that arrives with no session id is treated as clean and an autonomous send is not blocked.
- **Why it's dormant now.** The pilots draft; an autonomous send never happens, so the fail-open path is unreachable. It also only bites if a real flow can present an empty `session_id` — the MCP route sets `webhook:mcp:<correlation_id>` and inbound reads the gateway-supplied id, so prod may never actually hit empty. **First step is to confirm whether prod can produce an empty `session_id` at all** — if it provably cannot, this item is closed by observation.
- **Green.** Either (a) prove empty `session_id` is unreachable in prod for the send paths, or (b) the taint gate treats an empty/unauthenticated session as tainted for send classes without breaking the authored-autonomous-clean-send path (the naive default-taint broke `test_autonomous_clean_send_is_allowed` — the real fix is a session-independent recovery index, which needs a key to exist at `pre_tool_call`; design open).
- **Where.** `hermes-smd-overlay/shared/inbound.py`, `plugins/hermes-smd-trust/`.

### A2. EFF-12 — memory-poisoning fence

- **Risk.** Recalled memory re-enters future turns; a planted preference could steer a later autonomous send.
- **Current state (2026-07-03 scoping).** Lower-severity than the audit implied. The overlay peer-memory **capture path is already taint-fenced** (ADR 0048 §2f — a preference cannot be written from an injected/tainted turn; only a trusted roster peer on a clean turn). The injected block _is_ framed as a directive (`store.py render_preference_block`), but the resulting action is still bounded by ADR 0056 entitlements + `draft_for_review`, so under the pilots' posture the worst case is a biased draft a human reviews. The audit's literal target — native Hermes `MEMORY.md` recall — is upstream and may not be used by the Operator at all (unconfirmed).
- **Green (only needed before autonomous send).** (a) Confirm whether native Hermes memory recall is used; if so, fence or disable it. (b) Reframe injected preferences as untrusted-provenance data the agent weighs, not a directive it obeys.

---

## Gate B — before `code_execution` initiation is authored for any customer

### B1. SEC-10 — egress allowlist inside `execute_code`

- **Risk.** An autonomous code-executor has unbounded network egress and can exfiltrate to any host.
- **Why it's dormant now.** No pilot authors `code_execution` autonomously; the account-wide R2 key is already stripped from the agent (SEC-23), shrinking what is reachable to exfiltrate.
- **Green.** Egress from the code-execution sandbox is bound to an allowlist; a blocked host is denied and audited. (WS6 — not built.)
- **Where.** Overlay code-execution path; ADR 0050 B-class.

### B2. 0045 — Smokeball token behind the broker

- **Risk.** For a Smokeball-connected customer, the refresh token is hermes-readable on the Fly volume; a code-executor could read it.
- **Why it's dormant now.** Reachable only via `code_execution`, which the Smokeball pilot does not author.
- **Green.** The Smokeball token moves behind the uid-split broker (like the Google DWD creds), so the agent process cannot read it.
- **Where.** `operator/templates/entrypoint.sh` broker stage; `hermes-smd-overlay` connector.

---

## Gate C — cross-machine binding isolation (before any second paying customer on shared control-plane paths)

### C1. SEC-22 — wire `verify_at_boot`

- **Risk.** A provisioning bug could bind a Machine to another tenant's storage; nothing at runtime catches it. The boot self-check exists but is **not wired** — `invariant_7.run()` is hardcoded to slug `"smoke"`, so it validates nothing real.
- **Note.** ADR 0009's claim that this is wired is **false** — a doc-honesty fix routed to the doctrine review (Review 4).
- **Green.** Staged rollout: Phase 1 non-fatal (warn + audit row on mismatch), pointed at the real slug; observe on the fleet; Phase 2 flip to fatal `sys.exit(3)`. Fatal wiring is crash-loop-risky, hence staged.
- **Where.** `operator/safety-substrate/invariants/invariant_7.py`.

### C2. SEC-31 — root-own `run_invariants.py`

- **Depends on C1.** Only meaningful once the invariant check it protects is live.
- **Risk.** The runner is agent-writable — because of `__pycache__`, not a boot log (the Dockerfile comment claiming "boot log" is wrong).
- **Green.** `PYTHONDONTWRITEBYTECODE=1` for the check + root ownership so the agent cannot tamper with the isolation check.

---

## What is NOT on this list (already shipped)

For reference, the audit items that were **not** deferred and are already live: console-sole MCP door (ADR 0057 amendment), fabrication-gate on autonomous `EXTERNAL_SEND` (EFF-01), Unicode-normalized citation scan (EFF-03), `_current_turn_approval` self-approval strip (SEC-36/16), account-wide R2 key strip from the agent (SEC-23), runtime-read seam + heartbeat key strips from the agent (SEC-28, ADR 0023), and the ADR 0023 heartbeat emitter.

## SEC-21 note

The CI test that asserts `R2_SKILL_BODIES_ACCESS_KEY_ID` and `R2_ACCESS_KEY_ID` hold **different values** is worth adding (cheap, catches a real misconfiguration). The proposed runtime "widening check" is **not** — because the agent cannot write R2, all config is Captain-authored, so a blanket reject would block legitimate Captain changes. Do not build the widening check.
