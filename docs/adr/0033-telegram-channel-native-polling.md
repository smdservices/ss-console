---
title: Telegram Channel via Hermes Native Polling Adapter (env-enabled)
date: 2026-06-01
status: accepted
captain: Scott Durgan
related-adr: 0020-connector-strategy.md, 0021-leverage-hermes-native-primitives.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0032-inbound-webhook-architecture.md
related-issue: '#1166'
---

# ADR 0033 — Telegram Channel via Hermes Native Polling Adapter

**Status:** Accepted (Captain decision, 2026-06-01). **Proven live on customer-zero:** Scott DM'd the bot ("Who's there?") and Crane replied autonomously ("Crane — your Chief of Staff. What do you need?"), recipient-locked to Scott, no operator, witnessed via screenshot.

## Context

The AI Employee needs to be reachable on the channels customers actually use. Email inbound was solved in [ADR 0032](0032-inbound-webhook-architecture.md) via a public webhook + front-door gate (AgentMail pushes). Telegram is the next channel and has a fundamentally simpler shape, verified against the pinned Hermes ref (`v2026.5.16@a91a57fa…`):

- **Hermes ships a robust native Telegram adapter** (`gateway/platforms/telegram.py`) that uses **long-polling (`getUpdates`)** — the gateway makes outbound calls to Telegram. **No public URL, no webhook, no signature gate needed** (unlike email). The per-customer Machine already runs always-on, so it simply polls.
- Setting **`TELEGRAM_BOT_TOKEN`** in the environment **auto-enables** the platform (`gateway/config.py:_apply_env_overrides`). `hermes … gateway run` launches it alongside the existing webhook platform — no bootstrap launch change.
- **Two gotchas, both verified in source (not docs):**
  1. **The image did not ship the Telegram SDK.** The Dockerfile installed `uv sync --extra all`, and `all` deliberately **excludes** the `messaging` extra that carries `python-telegram-bot`. Without it the adapter imports fail (`TELEGRAM_AVAILABLE=False`) and a `TELEGRAM_BOT_TOKEN` env would silently do nothing.
  2. **The pinned ref fails OPEN on an empty allowlist.** `telegram.py`'s env-fallback authorizer is `if not allowed_csv: return True` — i.e. with `TELEGRAM_ALLOWED_USERS` unset, the bot answers **anyone** who finds it. (The published docs claim "denies all by default"; the pinned source does the opposite. Verify against source.) Setting the allowlist closes the risk under every code path.

## Decision

Wire Telegram as an **env-enabled native polling platform**, no new public surface:

1. **Image:** add `--extra messaging` to the Dockerfile `uv sync` so `python-telegram-bot==22.6` (lock-governed) is present. Lean alternative (targeted single-package install) was considered; the lock-governed extra was chosen as it is also forward-aligned with the Slack/Discord channels the product will offer, and the build image already carries the toolchain (`build-essential`/`gcc`/`libffi-dev`) the extra's native deps need.
2. **Credentials → Fly secrets:** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USERS` are set as Fly secrets on the customer Machine (piped from Infisical `/ss/ai-employee/customer-zero/telegram/`, never displayed). The token auto-enables the platform; the allowlist (`7367659986`, Scott; DM-only) is **mandatory** to defeat the fail-open default.
3. **No webhook, no gate, no overlay change** for Telegram. The overlay stays at its current ref; the channel is purely env + SDK.

## Consequences

- Crane is reachable on Telegram and replies autonomously, under the same trust-gate + content floor (ADR 0025/0031) as every other channel. Email inbound (ADR 0032) is unaffected — both run in one gateway.
- The `--extra messaging` Dockerfile change is **load-bearing**: without it on `main`, any future rebuild silently drops the SDK and breaks Telegram. That is the reason this is committed rather than left as a one-off deploy.
- Continuing always-on Fly cost (shared with the email-inbound requirement).
- **Auxiliary-model note (non-blocking):** the live test surfaced `temperature is deprecated for this model` (HTTP 400) from the auxiliary title-generator, and openrouter/nous "payment/credit" errors. These are _auxiliary_ side-calls (chat-title generation); the primary agent (Anthropic Opus) is unaffected. Fix = top up / disable the aux providers or drop the deprecated `temperature` param.

## Evolution (deferred, documented — not built now)

The token+allowlist live as Fly secrets, which works but keeps the allowlist out of the reviewable config-as-source-of-truth. The product-grade shape, when a second customer needs it:

- **`translate.py` `_materialize_telegram_platform`** (overlay repo) — emit a `telegram:` block (`allow_from`, `require_mention: false`, `reactions`) into the profile config from an authored `customer.yaml` `telegram:` section, mirroring `_materialize_webhook_platform`. The native-polling-platform seam; Slack/Discord reuse it.
- **Fail-closed launch guard** in `bootstrap.sh` — if `TELEGRAM_BOT_TOKEN` is set but no allowlist is resolvable, refuse to launch, making the fail-open branch structurally unreachable in our deployment.
- **Validator rule** — `telegram.allow_from` required + non-empty when the block is present (catches the fail-open trap pre-merge).
- **`/sethome`** — set the Telegram home channel so cron/scheduled triage (#1166) can deliver into the chat.

## Operational record (so the next session doesn't re-hunt)

The Telegram credentials are in Infisical **prod** at **`/ss/ai-employee/customer-zero/telegram/`** (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_USERS`), captured by a VC-session agent on 2026-05-26 (handoff `[vc/venturecrane/crane-console] 2026-05-26T20:31Z`). Standing it up cost an hour of path-hunting because the handoff store was queried with a bare repo name (returns empty) instead of `venture` + full `owner/repo`, and the record was **cross-venture** (captured in VC, needed by SS). Lesson: at session start, read recent handoffs across both of a venture's repos before probing infrastructure.
