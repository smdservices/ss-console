# Hermes Runtime Status — AI Employee customer-zero spike

**Issue:** [#821](https://github.com/venturecrane/ss-console/issues/821)
**Date:** 2026-05-20
**Author:** hermes-spike (autonomous agent)
**Audience:** Captain — PI law firm meeting 2026-06-02 → 06-09

## Verdict

**EXISTS upstream as an external product. Integration surface is PARTIAL — Phase A stub registered but not wired to Hermes' dispatch hook. Customer-zero CAN boot the Hermes runtime against PR #812's `customer.yaml`; trust-ceiling enforcement (the SMD-owned glue) cannot yet act on tool calls.**

The Hermes runtime is not vapor. It is a mature, MIT-licensed open-source product at `NousResearch/hermes-agent` (159k stars, 13 release lines, pinned at `v2026.5.7` SHA `e19fc91c`). What is incomplete is the **AIEmployee adapter** that wraps Hermes' tool dispatch with SMD's trust-ceiling enforcement (invariant #5). Without that wrapper, Hermes will run as vanilla Hermes — all skills execute at whatever ceiling they'd run at without code-level enforcement. For a CLI-gateway demo this is acceptable; for any meeting framing claiming "the trust ceiling is enforced in code, not prompt," it is not.

## Evidence

### 1. Hermes runtime — upstream external product

- **Repo:** [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) — Python, MIT-licensed, 159k stars, last pushed 2026-05-20.
- **Tagged release pinned in `customer.yaml`:** `v2026.5.7` resolves to SHA `e19fc91cb82cb4e0dc74f6d63a89d9b6c2135241`. Next two newer tags exist (`v2026.5.16`, `v2026.4.30`).
- **Surface area at v2026.5.7:** Python 3.11+ package `hermes-agent` v0.13.0 with pyproject-declared deps (`anthropic`, `openai`, `prompt_toolkit`, `croniter` for built-in cron, MCP optional extra). Top-level binary `hermes` plus subcommands; `cli.py` is the CLI entry point. Built-in features include cron scheduler, MCP client integration, multi-provider adapters (`anthropic_adapter.py`, `bedrock_adapter.py`, `gemini_native_adapter.py`, etc.), and `tool_guardrails.py`.
- **Already in production at SMD:** `crane-console` runs Hermes on `mini` for fleet updates (`tools/hermes/systemd/`, `scripts/provision-hermes-fleet-update.sh`). This is a separate deployment shape (systemd-on-bare-metal, not Fly Machine), but it confirms Hermes itself is a runnable artifact the org has booted before.

Hermes is not custom code we owe; it is a dependency.

### 2. Customer-zero integration surface — PR #812

PR #812 (`ai-employee-smd-customer-zero` branch) ships everything needed to **boot** Hermes inside a per-customer Fly Machine:

| Artifact | Path | Status |
|---|---|---|
| Dockerfile | `ai-employee/templates/Dockerfile` | Complete — clones Hermes at `${HERMES_REF}`, `uv sync --frozen`, builds web + ui-tui, installs Playwright |
| Provisioner | `ai-employee/bin/provision-customer.sh` | Complete — validates yaml, renders `fly.toml`, creates app + volume, stages secrets via `pbpaste`, deploys, smokes |
| Boot entrypoint | `ai-employee/templates/bootstrap.sh` | Complete — env-check, skill-pin resolution, safety-substrate gate, then `exec gosu hermes:hermes tail -f /dev/null` (containers stays alive for `fly ssh console` interactive Hermes sessions) |
| Customer config | `ai-employee/customers/smd/customer.yaml` | Complete (178 lines). `hermes_ref: v2026.5.7`, `gateway: cli`, 8 skills declared (all `version: pending`), 18 connectors declared |
| Safety substrate | `ai-employee/safety-substrate/run_invariants.py` + 6 test files | Complete — invariants 1-6 covered with pytest-style `run()` callables; bootstrap.sh runs in `--strict` mode |
| Trust-ceiling adapter | `ai-employee/adapter/aie_adapter.py` | **Phase A stub** — `register()` is documented but does nothing |
| Skill loader | `ai-employee/adapter/resolve_skill_pins.py` | Complete — verifies declared skill versions vs `/app/skills/` content hashes |
| customer.yaml validator | `ai-employee/adapter/validate_customer_yaml.py` | Complete |

### 3. What "EXISTS but PARTIAL" specifically means

The boot path `provision-customer.sh → Dockerfile → bootstrap.sh → Hermes` is end-to-end implemented. A clean run will:

1. Render `fly.toml`, create `hermes-smd` app + 1GB volume in `lax`.
2. Stage `ANTHROPIC_API_KEY`, `COMPOSIO_API_KEY`, `AGENTMAIL_API_KEY` via `fly secrets`.
3. Build image: stage 1 git-clones Hermes v2026.5.7, stage 2 layers in `ai-employee/adapter/`, `skills/`, `connectors/`, `customers/smd/customer.yaml` → `/app/customer.yaml`, and `safety-substrate/`.
4. `tini → bootstrap.sh` runs: env check → `resolve_skill_pins.py` → `run_invariants.py --strict` (the six safety invariants must pass) → `exec gosu hermes:hermes tail -f /dev/null`.
5. Captain SSHes in and runs `/opt/hermes/.venv/bin/hermes chat` or `hermes cron` interactively.

What does **not** happen in this path: the AIEmployee adapter does not register a tool-dispatch middleware. `aie_adapter.py:register()` is explicitly a Phase A stub — it loads `customer.yaml`, logs a registration message, and returns. The docstring acknowledges the gap and names the Phase A.5 work:

> Phase A.5 will hook trust_ceiling.enforce() into Hermes' tool dispatch.
> 1. Import Hermes' tool dispatch hook (agent/tool_router.py)

**Risk:** Hermes v2026.5.7 has `agent/tool_guardrails.py` and per-provider adapters, but **no `agent/tool_router.py`**. The exact hook surface assumed by `aie_adapter.py`'s docstring does not exist at that path. Phase A.5 will need to either find the equivalent in `tool_guardrails.py` / the cron + MCP dispatch path, monkey-patch a higher-level wrapper, or fork Hermes. The integration is not as drop-in as the comment implies.

### 4. Implication for customer-zero — can it ship by 2026-05-31?

**Yes for a boot-and-chat demo. Not yet for a "trust ceiling is enforced in code" demo.**

What works as of HEAD of PR #812:

- Hermes boots in a per-customer Fly Machine.
- `customer.yaml` validates and skill pins resolve.
- Safety substrate gate runs on every boot (invariants 1-6, including law-firm citation-refusal). Tests are present and `run_invariants.py` is `--strict`.
- Captain can `fly ssh console -a hermes-smd` and run `hermes chat` / `hermes cron` / `hermes mcp list` interactively.

What does not work yet:

- Trust ceiling per skill (invariant #5) is **prompt-declared, not code-enforced**. Skills can declare `trust_ceiling: draft_for_review` in `customer.yaml`, but no middleware intercepts tool calls to route or refuse them. The adapter's `enforce()` function exists at `ai-employee/adapter/trust_ceiling.py`, but nothing calls it during a real tool dispatch.
- Sticky-stop survival across compaction (invariant #4) — the adapter is named as the hook owner; without registration, no compaction handler is wired.
- Audit log writes per tool call — same blocker.
- Composio + MCP connector wiring at runtime — the SMD `customer.yaml` declares Composio backends for Gmail / Calendar / Drive / GitHub / QuickBooks, but the rendered `fly.toml` does not yet inject `COMPOSIO_*` per-connector tokens. The provisioner stages `COMPOSIO_API_KEY` (one tenant-wide key); per-connection auth happens out-of-band.

For the **2026-05-31 pre-provisioning deadline** (customer-zero up and reachable), HEAD of PR #812 is sufficient — Hermes boots, the safety floor is enforced at startup, the gateway is `cli` so no external surface needs to be wired. For the **2026-06-02 → 06-09 PI law firm meeting**, the demo can credibly show "this is Marcus, running on SMD's customer-zero instance, here is a draft," but cannot credibly claim "the trust ceiling is enforced in code" — because it is not yet, and a sophisticated prospect (or their counsel) will ask.

### 5. Pre-existing operational hooks in this repo

- [`docs/runbooks/ai-employee-customer-onboarding.md`](./ai-employee-customer-onboarding.md) — written before the Dockerfile lands; references `/hermes/skills`, `/hermes/data`, `/hermes/logs` mount layout. The Dockerfile in PR #812 uses `/opt/hermes` and `/opt/data` instead — runbook is out of sync and should be updated in Phase A.5.
- [`docs/infra/token-registry.md`](../infra/token-registry.md) in `crane-console` documents the `nous hermes` GitHub PAT used to clone Hermes during customer provisioning — but PR #812's Dockerfile uses an unauthenticated public clone (`https://github.com/NousResearch/hermes-agent.git`), which is fine because the repo is public. The PAT is not on the critical path for customer-zero.

## Recommended next step

**Boot test now, then Phase A.5 adapter wiring in parallel with skills 4-8.**

Two work-streams, both startable today, do not block each other:

1. **Boot test (1-2 hr)** — run `ai-employee/bin/provision-customer.sh smd` against the real Fly account, verify the Hermes container starts, safety substrate passes, `hermes chat` opens an REPL inside the container. This validates that the +20k LOC in PR #812 actually composes. If it fails (build error, missing dep, fly.toml typo), we surface that now, not the night before the meeting. This is the single highest-leverage thing to verify before the 2026-05-31 deadline.
2. **Phase A.5 adapter integration (estimate: 2-4 days of focused work)** — locate Hermes' actual tool dispatch hook (likely a combination of `agent/tool_guardrails.py` and the cron/MCP loop in `cron/` and `mcp_serve.py`), implement `aie_adapter.register()` against the real hook, wire `trust_ceiling.enforce()` into every tool call, write integration tests that drive a tool call through the adapter and verify draft/refuse/allow routing. This is the highest-risk unknown remaining — the upstream surface does not match what `aie_adapter.py`'s docstring assumes, so the first 4-8 hours are spent finding the right seam, not writing code.

Do not delay #1 waiting for #2. If the boot fails, that is a blocker for both. If it passes, customer-zero is provisionable today and the meeting demo has a real running instance behind it.

## Decision the Captain owes the team

For the 2026-06-02 → 06-09 meeting, pick one:

- **(a) Boot-and-chat demo.** Marcus exists on `hermes-smd`, drafts a sample triage, Captain shows the audit log entry from skill execution. Trust ceiling is described as "enforced at the safety substrate today, with per-skill ceiling enforcement landing in the next sprint." Honest and shippable.
- **(b) Wait for Phase A.5.** Spend the next 5-7 working days closing the adapter gap, then demo with full code-enforced ceiling. Higher integrity, but loses a meeting window if Phase A.5 blocks on the upstream Hermes hook surface.

My recommendation: **(a) + parallel A.5 work.** The meeting outcome is "do you want this in your firm," not "show me your codebase." A working customer-zero with honest framing of what is and is not yet code-enforced will land better than an unbookable demo waiting for perfection. Phase A.5 still ships before the next prospect cycle.

## Files referenced in this report

All paths in [`venturecrane/ss-console` PR #812](https://github.com/venturecrane/ss-console/pull/812) unless noted:

- `ai-employee/customers/smd/customer.yaml` — customer-zero config
- `ai-employee/templates/Dockerfile` — Hermes container build
- `ai-employee/templates/bootstrap.sh` — boot entrypoint
- `ai-employee/templates/fly.toml.template` — Fly app shape
- `ai-employee/bin/provision-customer.sh` — provisioner
- `ai-employee/adapter/aie_adapter.py` — **the Phase A stub** (Hermes integration point)
- `ai-employee/adapter/trust_ceiling.py` — enforcement logic (not yet wired)
- `ai-employee/safety-substrate/run_invariants.py` — boot gate (wired)

Upstream:

- [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) at tag `v2026.5.7` (SHA `e19fc91c`)
- [`agent/tool_guardrails.py`](https://github.com/NousResearch/hermes-agent/blob/v2026.5.7/agent/tool_guardrails.py) — closest analog to the missing `tool_router.py` referenced in `aie_adapter.py`

Platform PRD: `docs/pm/ai-employee/platform-prd.md` on branch `docs/ai-employee-prds` (PR #813), §7.1-§7.5 + §7.8.
