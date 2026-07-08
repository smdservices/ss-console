# Hermes v0.14.0 → v0.18.0 Fleet Upgrade Plan

**Status:** Proposed (awaiting Captain review)
**Date:** 2026-07-07
**Author:** agent session (Captain: Scott Durgan)
**Governs:** the first deliberate blessed-version promotion under [ADR 0024](../../adr/0024-hermes-consumption-and-update-cadence.md)
**Target:** `v2026.7.1@7c1a029553d87c43ecff8a3821336bc95872213b` (Hermes Agent **v0.18.0**, "The Judgment Release", 2026-07-01)

---

## TL;DR

- **Where we are:** the entire fleet (smd, ashton-price, pilot-smokeball, pilot-law, scott, smd-staging) is pinned to `v2026.5.16` = **Hermes v0.14.0**, ~7 weeks and **4 minor versions** behind. Latest stable is **v0.18.0**.
- **The headline risk is retired.** The scary part of a 0.14→0.18 jump was v0.15.0 collapsing `run_agent.py` from 16,083 lines to 3,821 across new `agent/*` modules, which killed every file:line citation our overlay's hook-surface doc carries. A static diff against upstream v0.18.0 proves this does **not** break us: all **9 hooks** our overlay binds still exist in `VALID_HOOKS`, the plugin API is unchanged, and the tool-hook kwargs are a backward-compatible **superset**. Our plugins bind by hook _name_, not line number, so the refactor is transparent to them.
- **One empirical gate remains:** the LLM/session-hook kwargs shapes, resolved by running the existing `hermes-smd-hook-probe` smoke plugin against a stock v0.18.0 container on staging. This is a gate we already have, not new work.
- **The real lesson is systemic.** We drifted 7 weeks because [ADR 0024](../../adr/0024-hermes-consumption-and-update-cadence.md)'s "keep current" automation was never built and the cadence stayed manual. The fix is right-sized: **a lightweight release-watch now** (a scheduled release check that pings on a new tag), and the full golden-image/tracking pipeline **deferred until fleet scale** — building a CI factory for a 3-seat fleet is the over-engineering we are avoiding. See §7.

---

## 1. Current state

| Fact                                    | Value                                                                                 | Source                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Fleet pin (all 6 customers)             | `v2026.5.16@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0` = v0.14.0                       | `operator/customers/*/customer.yaml`              |
| Latest upstream stable                  | `v2026.7.1` = v0.18.0 (2026-07-01)                                                    | `gh api repos/NousResearch/hermes-agent/releases` |
| Gap                                     | 4 minor versions (0.15, 0.16, 0.17, 0.18), ~5,000+ commits, ~50 security-tagged fixes | upstream release-note counters                    |
| Build shape                             | per-customer **from source** (`[build] dockerfile=`)                                  | `operator/templates/fly.toml.template:23`         |
| Overlay pin (decoupled)                 | `OVERLAY_REF=3294e909…`                                                               | `operator/templates/Dockerfile:257`               |
| ADR 0024 tracking/golden-image pipeline | **not built** (no CI workflow, no GHCR base image)                                    | `.github/workflows/`, tree                        |

Intervening releases we skip through: v0.15.0 (2026.5.28, "Velocity"), v0.15.1/.2 (5.29), v0.16.0 (6.5, "Surface"), v0.17.0 (6.19, "Reach"), v0.18.0 (7.1, "Judgment").

---

## 2. What the gap buys us (the deltas that touch SMD)

Not a changelog dump — only what bears on our product, security, or cost.

1. **Security backlog (the strongest reason to move).** ~50 security-tagged fixes across the window, including named ones: **CVE-2026-48710** (Starlette pin, v0.16), SSRF off-loop hardening, subprocess credential stripping, MCP-config attack-surface lockdown, cron `base_url` credential-exfil block, Slack app-token redaction, an aiohttp CVE floor (v0.17/0.18). For a product whose pitch is compliance-grade safe delivery, running 7 weeks behind on Hermes' security train is the least-defensible position.
2. **Promptware / Brainworm defense (v0.15.0).** Prompt-injection hardening dead-center on our threat surface: tool-output delimiter markers so a malicious inbound email/file cannot impersonate system content, recalled-memory scanning at load time, a `tools/threat_patterns.py` single source of truth. The Operator reads untrusted inbound mail and documents constantly. This is a capability we _want_.
3. **"Done means proven" (v0.18.0).** Completion contracts, a `pre_verify` hook, the agent verifying its own work by running project checks. Maps onto our own "Done means wired" doctrine; a candidate follow-on, not part of this upgrade (opt-in; a hook we do not currently register).
4. **Scale-to-zero + drain coordination (v0.17.0).** Production-grade hosting: dormant-when-idle gateway, clean quiesce before restart/migrate/auto-update without dropping in-flight turns. Directly relevant to Hosted Agent SKU economics and the active-seat cost plane.
5. **Curator aux-budget fix (v0.17.0).** The curator stopped spending aux-model budget on every routine run. **Moot for us** — we disable the curator per-profile (`ensure-curator-disabled.py`, boot-smoke `curator-disabled` check). Noted so we do not over-credit the upgrade.

---

## 3. The hook-surface risk — scoped and resolved

This is the section the "plan doc first" decision was about: scope the risk before spending a rebuild.

### 3.1 The concern

v0.15.0 shredded `run_agent.py` (16,083 → 3,821 lines) into 14 `agent/*` modules. Our overlay's `docs/hook-surface.md` is pinned to `v2026.5.16` and cites firing sites like `run_agent.py:12447`, `:15901`, `:16016` — all now dead. If our plugins bound to those locations, the upgrade would shatter them.

### 3.2 What we actually depend on (narrow)

Our overlay is now **12 plugins** (grown from the 4 in ADR 0015). Across all of them, the entire dependency surface is **9 hook names** plus exactly one context method, `ctx.register_hook`:

| Hook                    | Overlay consumer(s)           | Purpose                                              |
| ----------------------- | ----------------------------- | ---------------------------------------------------- |
| `pre_tool_call`         | hermes-smd-trust              | trust-ceiling + outbound provenance/fabrication gate |
| `post_tool_call`        | audit, peer-memory, reply, +3 | per-tool audit rows                                  |
| `transform_tool_result` | hermes-smd-inbound            | untrusted-inbound quarantine (ADR 0027)              |
| `transform_llm_output`  | hermes-smd-voice              | Layer-2 structural voice reshape                     |
| `pre_llm_call`          | voice, inbound, peer-memory   | voice injection + inbound quarantine                 |
| `post_llm_call`         | audit, voice, mcp-result-sink | per-turn LLM audit                                   |
| `on_session_end`        | memory-mirror, peer-memory    | Honcho conclusion mirror trigger                     |
| `subagent_stop`         | hermes-smd-audit              | one SUBAGENT_STOPPED row per delegated child         |
| `pre_gateway_dispatch`  | hermes-smd-webhook-router     | webhook routing + inbound envelope attach            |

Plugins register **by name** (`ctx.register_hook("pre_tool_call", …)`), not by line. `register_hook` warns-but-stores unknown names (forward-compatible). So the compatibility question reduces to: _do these 9 names still exist, still fire with compatible kwargs, and is the plugin API unchanged?_

### 3.3 Static diff against upstream v0.18.0 — the verdict

Fetched `hermes_cli/plugins.py` and `model_tools.py` from `NousResearch/hermes-agent` at tag `v2026.7.1` (git blobs API) and compared.

- **All 9 hooks present in `VALID_HOOKS`** (`hermes_cli/plugins.py:135`). None removed.
- **Plugin API intact:** `PluginContext` (`:337`), `register_hook` (`:1109`, still warns-but-stores unknown names), `invoke_hook` (`:1847`), manifest schema `requires_env` / `provides_hooks` (`:286`, `:288`). `hermes_cli/plugins.py` did **not** move in the refactor.
- **Tool-hook kwargs are a backward-compatible superset.** At v0.18.0 (`model_tools.py`), `post_tool_call` fires with every kwarg our audit plugin reads — `tool_name, args, result, task_id, session_id, tool_call_id, duration_ms` — **plus** new `turn_id, api_request_id`. `transform_tool_result` fires the same superset. `pre_tool_call` still runs through the single-fire `get_pre_tool_call_block_message()` helper with first-block-wins semantics. Our handlers all take `**kwargs`, so the additions are inert.

**Verdict: structural compatibility is proven.** The refactor moved firing sites (dead citations) but preserved the named-hook contract, which is the only thing our plugins bind to.

### 3.4 Residual risk — two gates, and the one that matters most

**(a) Signature gap (lower risk).** The static proof covers the 3 tool hooks' kwargs directly and all 9 hook _names_. The 6 LLM/session/gateway hooks fire from the refactored `agent/*` modules; their kwargs shapes (`sender_id`, `assistant_response`, `completed`/`interrupted`, the `pre_gateway_dispatch` `event/gateway/session_store` triple) are **high-confidence but not statically confirmed here**. Several of these (`pre_gateway_dispatch`, `on_session_end`, `subagent_stop`) only fire on a **provisioned Machine**, not a bare container — so they are closed on staging (§5 Step 3), not in the container probe.

**(b) Semantic gap (the real risk) — resolved at source, runtime-confirmed on staging.** Structural compatibility is not behavioral compatibility. The v0.15+ promptware/Brainworm defenses could in principle **wrap tool-result content in delimiter markers, quarantine it, or scan recalled memory** before it reaches the model, silently feeding our `transform_tool_result` (ADR-0027 quarantine) and audit/voice plugins mangled bytes — signature-green, semantics-broken, on a live law firm. A source diff of the firing sites (`model_tools.py` at both tags + `agent/tool_dispatch_helpers.py` + `tools/threat_patterns.py` at v0.18) closes it:

- `transform_tool_result` fires on the **raw** `result` at the same pipeline point in both versions (`v0.14:849` == `v0.18:1204`); our returned string still replaces it.
- The new untrusted-delimiter defense (`_maybe_wrap_untrusted`, `tool_dispatch_helpers.py:435`) has **no call site in the dispatch path** — it runs downstream at message-assembly, on whatever our hook returns. It wraps `mcp_*` tools only, defangs only its **own** literal `untrusted_tool_result` token (not arbitrary fences/nonces), and never strips content. Our quarantine nonce is a different token, untouched; worst case is a harmless double-wrap (our fence + `<untrusted_tool_result>`), which is aligned defense-in-depth.
- `scan_for_threats()` **detects and returns findings — it never mutates content.**

Verdict: no adverse change to what our overlay plugins consume. (`crane_verify` vfy_01KWZGFWTGKR…) The `pre/post_llm_call` content path (voice injection, recalled-memory) is lower-risk and gets **runtime confirmation** via the probe on staging (§5 Step 3), not more source archaeology.

### 3.5 Overlay housekeeping (no functional code change expected)

Because the hooks are compatible, the overlay should need **no functional code change** for v0.18.0 — only:

- Re-pin `docs/hook-surface.md` header to `v2026.7.1` and refresh the (now-informational) file:line citations.
- Record the hook-probe smoke output at v0.18.0 as the new re-verification artifact.
- `OVERLAY_REF` stays where it is unless the semantic gate (§3.4b) surfaces a real gap.

---

## 4. Other upgrade surfaces (lower risk, still checked)

- **Honcho:** not baked into the Phase-1 image (`operator/templates/Dockerfile:353` — in-container Honcho server removed; real server deferred to Phase 2). ADR 0024's "add a Honcho integrity assertion" is therefore **moot for this upgrade** — there is no Honcho to pin.
- **From-source rebuild — determinism is mostly handled.** Upstream ships `uv.lock` at both the v0.14 and v0.18 tags, and the Dockerfile runs `uv sync --frozen` (`operator/templates/Dockerfile:348`), so the **Python** env is reproducible per-pin — a v0.14 rebuild today reproduces today's running Python tree. The residual non-determinism is the **npm/Playwright layer only**: `npm install` (not `npm ci`) at `Dockerfile:336-339` and `npx playwright install ... chromium` at `:337`. Consequence: capture the running seat's env as the rollback reference (§5 Step 0), and assert a browser launch in boot-smoke (§5 Step 3), rather than assuming a byte-identical rebuild. Building a vendored requirement manifest is **not** warranted — `uv.lock` + `--frozen` already covers the Python surface.
- **Flat-file memory:** Phase 1 runs on Hermes' `MEMORY.md`/`USER.md` per-profile core (`operator/templates/README.md:106`). Format has been stable across the release train; low risk, but confirm on staging that existing `/opt/data` volume memory loads cleanly after the bump.
- **The hardcoded-pin gotcha list** (a bump must update **all** of these, or the pin silently drifts back to v0.14.0):
  - `operator/customers/<slug>/customer.yaml` → `hermes_ref` (per customer being promoted)
  - `operator/bin/provision-customer.sh:138` → the `.get('hermes_ref', 'v2026.5.16@…')` fallback default
  - `operator/templates/Dockerfile:40` → `ARG HERMES_REF=`
  - `operator/templates/Dockerfile:43` → `ARG HERMES_UPSTREAM_TAG=`
  - `operator/templates/Dockerfile:49` → `ARG HERMES_UPSTREAM_SHA=`
  - `operator/bin/fixtures/smd/customer.yaml` and `_template` / `_hosted-template` / `customer-no-pm-system.yaml` placeholders (as appropriate)

  The Dockerfile ARGs are overridden by build args passed from `provision-customer.sh`, so they are fallbacks — but leaving them at v0.14.0 is a latent trap for any direct `fly deploy`. Update them in the same PR.

---

## 5. Execution plan — staged rollout with gates

Honors the standing rule: **never straight to a paid seat.** Because there is no local Docker, the "stock container" proof runs against the isolated, from-source **staging Machine** (Fly remote build) rather than a synthetic local container — more faithful, not a cut corner. `smd-staging` is a permanent, credential-isolated seat that exists to absorb exactly this.

**Step 0 — Capture the v0.14 baseline + rollback reference (before any pin bump).**
From the running v0.14 `smd-staging` Machine: capture the resolved env as the concrete rollback artifact (`uv.lock` confirmed at `a91a57fa…`, Playwright pkg + chromium rev, Hermes SHA, live `OVERLAY_REF`) and a **semantic baseline** — the payload bytes each overlay plugin consumes for a fixed input via `hermes-smd-hook-probe`. This baseline is what the v0.18 snapshot diffs against.

**Step 1 — Prove the overlay at v0.18 (signatures + semantics).**
On the reprovisioned staging Machine (or a throwaway build if Docker becomes available), run `hermes-smd-hook-probe`:

- **Presence gate:** every hook fires; no consumed kwarg missing.
- **Semantic gate (§3.4b):** snapshot the payload each plugin consumes for `transform_tool_result` and `pre/post_llm_call`; diff against the Step-0 v0.14 baseline. Read the v0.15–v0.18 security/CHANGELOG notes for tool-result delimiter/quarantine and recalled-memory-scan changes and assert each. Confirm ADR-0027 quarantine does not double-wrap native fencing.
- If any gap → stop and patch the overlay before promoting further. Re-pin `hook-surface.md` to `v2026.7.1`.

**Step 2 — Bump the per-seat pin (staging only).**
Set `operator/customers/smd-staging/customer.yaml` `hermes_ref` → `v2026.7.1@7c1a029553d87c43ecff8a3821336bc95872213b`. **Leave the global defaults (`provision-customer.sh:138`, `Dockerfile:40/43/49`, templates) at v0.14 until the blessing step (§5 Step 6)** — all 6 seats carry explicit pins, so the default only affects new provisions/fixtures; bumping it early is a latent footgun on any mid-rollout reprovision.

**Step 3 — Staging reprovision + hardened boot-smoke + real webhook turn.**
`operator/bin/reprovision-staging.sh` (isolated creds). First **harden** `boot-smoke-test.sh` (it currently only greps plugin presence and its comment still says "four"; there are 12): assert (a) loaded overlay SHA == intended `OVERLAY_REF`, (b) expected plugin count registered, (c) target hooks registered at runtime (fail-closed harness-ON, not file-presence), (d) Playwright launches a headless browser. Then trigger a **real webhook-originated** inbound (Svix → overlay gate → Hermes adapter) so `pre_gateway_dispatch` + `on_session_end` kwargs are captured on a Machine. Gate: hardened boot-smoke green + `crane_verify` live-turn + the semantic snapshot confirmed on real machinery.

**Step 4 — pilot-smokeball (real-connector proof of the load-bearing path).**
Bump pin, reprovision, hardened boot-smoke, then an explicit **real inbound-email → recipient-locked-draft** round-trip (real creds) asserting recipient-lock correctness + the expected audit row, plus a discovery-lane run matching the pre-upgrade baseline. This is the only real-connector proof before the paying seat; recipient-lock correctness is an explicit gate (wrong recipient on a law firm's mail = incident).

**— CHECKPOINT —** Stop and report: probe (signatures + semantics), both seats' hardened-boot-smoke + live-turn evidence, recipient-lock proof. Wait for the Captain's explicit go before Step 5.

**Step 5 — ashton-price (paid seat, last, canary).** _(only after the checkpoint go)_
Bump pin, reprovision, hardened boot-smoke, one low-stakes real inbound→draft turn with recipient-lock + audit assertion. **Rollback lever:** revert `hermes_ref` to `v2026.5.16@a91a…` and `reprovision.sh ashton-price` against the Step-0 captured reference (Python deterministic via `--frozen`; the captured env checks the npm/Playwright layer). Machine secrets persist across deploy, so rollback is a pin flip.

**Step 6 — Bless v0.18 + release-watch.**
Only after A&P is green: bump the global defaults (`provision-customer.sh:138`, `Dockerfile:40/43/49`, `_template`/`_hosted-template`, fixtures) to the target pin, make the pilot-law/scott call (fold in or record a dated hold), and add the lightweight release-watch (§7).

---

## 6. Verification / done criteria

1. `hermes-smd-hook-probe` fires all 9 hooks (container + Machine); no consumed kwarg missing **and consumed content semantically unchanged or handled** (`crane_verify`, fresh_process).
2. Hardened `boot-smoke-test.sh` green on each promoted seat: overlay SHA matches `OVERLAY_REF`, plugin count + runtime hook registration asserted, Playwright launches (`crane_verify`, live_state per seat).
3. A **real webhook** inbound on staging + a **real recipient-locked** round-trip on pilot-smokeball — correct recipient + expected audit rows (`crane_verify`, live_state).
4. `docs/hook-surface.md` re-pinned to `v2026.7.1`; the v0.14 rollback reference captured and confirmed reproducible.
5. Per-seat pins bumped during rollout; global defaults bumped only at the blessing step; pilot-law/scott disposition recorded.
6. Release-watch live. Fleet view: all promoted seats on v0.18.0; any seat held back carries a recorded reason (ADR 0024 Decision 6).

---

## 7. The systemic fix (why we were 7 weeks behind)

ADR 0024 (2026-05-28) already designed the "keep current" strategy and even predicted this drift: "a quarterly rebase against a weekly release train leaves us structurally ~12 versions behind at all times." Its Steps 1–2 (SHA-pin, de-fork, first boot) landed. **Step 3 — the CI→GHCR golden base image and the automated tracking job — was never built**, and we sailed past its trigger ("before first real customer"; A&P is live). The manual, Captain-noticed-via-Discord cadence is exactly the bottleneck ADR 0024 named, and it is why nobody bumped the pin for 7 weeks.

**The right-sized fix is a habit, not a factory.** Building ADR 0024's full CI→GHCR golden-image + candidate-build tracking pipeline for a **3-active-seat fleet** — where this entire compatibility audit took one session by hand — is building a machine to change a lightbulb. The golden-image pipeline earns its keep at fleet scale; we are not at fleet scale, so it is **deferred until seat count or upgrade pain demands it**.

What we adopt now is the minimum that actually prevents recurrence: a **lightweight release-watch** — a scheduled `gh api` check on `NousResearch/hermes-agent/releases` that pings / opens an issue when a new tag ships, so the pin can never silently rot for 7 weeks again. Ten lines, not a subsystem. The reason we drifted was a missing _signal_, not a missing pipeline; we build the signal now and the pipeline the day it pays for itself.

---

## 8. Decisions (resolved 2026-07-07)

1. **Automation scope.** Cut the golden-image / tracking-CI pipeline as over-engineering at 3 seats; ship a lightweight release-watch instead. Revisit the pipeline at fleet scale. (§7)
2. **Overlay lockstep.** Hold `OVERLAY_REF`; hooks are compatible, so no overlay code change is expected — only re-verify and re-pin `hook-surface.md`. Cut a fresh overlay tag only if the semantic gate (§3.4) surfaces a real gap.
3. **New-capability follow-ons.** File — do not block. v0.18 `pre_verify` / completion-contracts ("Done means wired"); v0.17 scale-to-zero for the Hosted Agent cost plane.
4. **Rollout depth.** Captain checkpoint after pilot-smokeball; the paying seat (A&P) is promoted only on explicit go.

---

## References

- [ADR 0024 — Hermes Consumption and Update Cadence](../../adr/0024-hermes-consumption-and-update-cadence.md) (the strategy this upgrade executes; its Step 3 is the unbuilt piece)
- [ADR 0015 — Hermes Fork Posture](../../adr/0015-hermes-fork-vs-upstream.md) (plugin-only-overlay half, still in force)
- [ADR 0007 — Per-customer Machine isolation](../../adr/0007-per-customer-machine-isolation.md) (per-customer pin = rollback/canary lever)
- `hermes-smd-overlay/docs/hook-surface.md` (the contract diffed in §3)
- Upstream at `v2026.7.1`: `hermes_cli/plugins.py` (`VALID_HOOKS`, `PluginContext`, `register_hook`, `invoke_hook`), `model_tools.py` (tool-hook kwargs)
- Build wiring: `operator/templates/Dockerfile`, `operator/bin/provision-customer.sh`, `operator/bin/reprovision-staging.sh`, `operator/bin/boot-smoke-test.sh`
