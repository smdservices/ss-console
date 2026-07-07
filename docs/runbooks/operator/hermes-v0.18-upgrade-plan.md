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
- **The real lesson is systemic.** The reason we drifted 7 weeks behind is that [ADR 0024](../../adr/0024-hermes-consumption-and-update-cadence.md)'s tracking-and-golden-image automation (its Decisions 2, 3, 5) was **never built**. This upgrade should be run in a way that builds that muscle by hand once, then we should decide whether to automate it so we do not land here again in September. See §7.

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

### 3.4 Residual risk (the one empirical gate)

The static proof covers the 3 tool hooks' kwargs directly and all 9 hook _names_. The 6 LLM/session/gateway hooks fire from the refactored `agent/*` modules; their kwargs shapes (`sender_id`, `assistant_response`, `completed`/`interrupted`, the `pre_gateway_dispatch` `event/gateway/session_store` triple) are **high-confidence but not statically confirmed here**. The right tool to close them is empirical and already exists: run `hermes-smd-hook-probe` against a stock v0.18.0 container and diff the observed kwargs against the documented contract. This is Step 0 of §5.

### 3.5 Overlay housekeeping (no functional code change expected)

Because the hooks are compatible, the overlay should need **no functional code change** for v0.18.0 — only:

- Re-pin `docs/hook-surface.md` header to `v2026.7.1` and refresh the (now-informational) file:line citations.
- Record the hook-probe smoke output at v0.18.0 as the new re-verification artifact.
- `OVERLAY_REF` can stay where it is unless the probe surfaces a kwargs gap (see §8 open decision on lockstep).

---

## 4. Other upgrade surfaces (lower risk, still checked)

- **Honcho:** not baked into the Phase-1 image (`operator/templates/Dockerfile:353` — in-container Honcho server removed; real server deferred to Phase 2). ADR 0024's "add a Honcho integrity assertion" is therefore **moot for this upgrade** — there is no Honcho to pin.
- **From-source rebuild:** the per-customer Dockerfile re-runs `git clone` + `uv sync` + `playwright install` + overlay install. A new upstream SHA means new transitive deps resolve; watch the build for `uv sync` / Playwright surprises. (This is exactly the non-determinism ADR 0024's golden image was meant to remove.)
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

Honors the standing rule: **fixtures → pilot-smokeball → ashton-price, never straight to a paid seat.**

**Step 0 — Prove the overlay on v0.18.0 (before any pin bump).**
Build a stock v0.18.0 container, run `hermes-smd-hook-probe`, capture the observed kwargs for all 9 hooks, diff against `docs/hook-surface.md`. Gate: every hook fires; no consumed kwarg missing. Re-pin `hook-surface.md`. **If a kwarg gap appears, stop and patch the overlay before proceeding.**

**Step 1 — Bump the pins (staging only, first).**
Set `smd-staging` `hermes_ref` → `v2026.7.1@7c1a029553d87c43ecff8a3821336bc95872213b`; update the Dockerfile/provision defaults per §4. PR + verify.

**Step 2 — Staging reprovision + boot-smoke + live-turn.**
`operator/bin/reprovision-staging.sh` (isolated creds), then `operator/bin/boot-smoke-test.sh smd-staging` (all 8 checks incl. overlay-plugins-installed, curator-disabled, overlay-pack-root-owned), then a real inbound→draft turn with an audit-row check. Gate: boot-smoke green + `crane_verify` live-turn record.

**Step 3 — pilot-smokeball (fixtures gate first).**
Run the fixtures path, then reprovision pilot-smokeball, boot-smoke, and a discovery-lane run. Gate: same as Step 2 + a grading run that matches the pre-upgrade baseline.

**Step 4 — ashton-price (paid seat, canary).**
Promote only after Steps 2–3 are green. Reprovision, boot-smoke, live-turn on a low-stakes real path. The **per-customer pin is the rollback lever**: if a regression hits A&P, revert `hermes_ref` to `v2026.5.16@a91a…` and `reprovision.sh ashton-price` restores the prior image.

**Rollback (any gate):** revert the customer's `hermes_ref` to the v0.14.0 pin and reprovision. Machine secrets persist across deploy, so rollback is a pin flip, not a rebuild-from-nothing.

---

## 6. Verification / done criteria

1. `hermes-smd-hook-probe` fires all 9 hooks on a v0.18.0 container; no consumed kwarg missing (`crane_verify`, fresh_process).
2. `boot-smoke-test.sh` passes all checks on each promoted seat (`crane_verify`, live_state per seat).
3. A real inbound→draft turn on each seat emits the expected audit rows (`crane_verify`, live_state).
4. `docs/hook-surface.md` re-pinned to `v2026.7.1` with refreshed citations.
5. No hardcoded `v2026.5.16` default remains for a promoted path (grep clean).
6. Fleet view: all promoted seats on v0.18.0; any seat held back carries a recorded reason (ADR 0024 Decision 6).

---

## 7. The systemic fix (why we were 7 weeks behind)

ADR 0024 (2026-05-28) already designed the "keep current" strategy and even predicted this drift: "a quarterly rebase against a weekly release train leaves us structurally ~12 versions behind at all times." Its Steps 1–2 (SHA-pin, de-fork, first boot) landed. **Step 3 — the CI→GHCR golden base image and the automated tracking job — was never built**, and we sailed past its trigger ("before first real customer"; A&P is live). The manual, Captain-noticed-via-Discord cadence is exactly the bottleneck ADR 0024 named, and it is why nobody bumped the pin for 7 weeks.

This upgrade forces us to do, by hand, once, the two things Step 3 automates: build an image at a new SHA, and prove the overlay against it. That hand-run is the raw material for the automation. **Recommendation:** at minimum, build ADR 0024's _tracking job_ this cycle — a CI job that, on each upstream release, builds a candidate, runs the overlay tests + hook-probe + safety invariants, and emits a green/red signal plus a hook-surface diff. That converts "are we compatible with the latest Hermes?" from a manual dig into a standing signal, and blessing a new version becomes a deliberate pin bump instead of an archaeology project. The golden GHCR image (Step 3's other half) can follow. Without this, we will be back here in September.

---

## 8. Open decisions for Captain

1. **Automation scope this cycle.** Build ADR 0024's tracking job now (bundled with the upgrade), or do the manual v0.18.0 upgrade first and file the automation as a follow-on? (Recommendation: build at least the tracking job now — the manual run is the prototype.)
2. **Overlay lockstep.** Hold `OVERLAY_REF` fixed and only re-pin `hook-surface.md`, or cut a fresh overlay tag alongside the Hermes bump? (Recommendation: hold `OVERLAY_REF`; the hooks are compatible, so no overlay code change is expected — only re-verify.)
3. **New-capability follow-ons.** File issues to adopt v0.18.0's `pre_verify` / completion contracts (maps to "Done means wired") and evaluate v0.17.0 scale-to-zero for the Hosted Agent cost plane, or defer both? (Recommendation: file, do not block this upgrade on them.)

---

## References

- [ADR 0024 — Hermes Consumption and Update Cadence](../../adr/0024-hermes-consumption-and-update-cadence.md) (the strategy this upgrade executes; its Step 3 is the unbuilt piece)
- [ADR 0015 — Hermes Fork Posture](../../adr/0015-hermes-fork-vs-upstream.md) (plugin-only-overlay half, still in force)
- [ADR 0007 — Per-customer Machine isolation](../../adr/0007-per-customer-machine-isolation.md) (per-customer pin = rollback/canary lever)
- `hermes-smd-overlay/docs/hook-surface.md` (the contract diffed in §3)
- Upstream at `v2026.7.1`: `hermes_cli/plugins.py` (`VALID_HOOKS`, `PluginContext`, `register_hook`, `invoke_hook`), `model_tools.py` (tool-hook kwargs)
- Build wiring: `operator/templates/Dockerfile`, `operator/bin/provision-customer.sh`, `operator/bin/reprovision-staging.sh`, `operator/bin/boot-smoke-test.sh`
