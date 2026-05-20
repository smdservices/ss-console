# Cost Telemetry — Event Emission Specification

**Spec for issue #804.** How cost data is emitted and collected per the §15.1 cost drivers. Without emission spec, Phase 1's "Cost telemetry instrumented" milestone closes with empty tables and the §17.1 COGS/MRR ≤40% kill criterion is unfalsifiable.

Per PM R7, telemetry instrumentation is a **Phase 2 scope item**, not Phase 1 — it must be producing per-customer-per-day reports before beta-1 generates usage.

## Source

- platform-prd.md §15.1 (cost drivers + modeling), §17.1 (COGS/MRR kill criterion)
- `docs/pm/ai-employee/prd-contributions/round-1/technical-lead.md` Risk 6

## Contract

### Storage

All events land in the per-customer `cost_telemetry` D1 table per d1-schema.md:

```sql
cost_telemetry (
  date          TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  driver        TEXT NOT NULL,          -- enum below
  amount_cents  INTEGER NOT NULL,       -- integer cents
  units         REAL,                   -- e.g. tokens, calls, GB-hours
  unit_type     TEXT,                   -- enum below
  PRIMARY KEY (date, driver)
)
```

Rollup is one row per `(date, driver)` per customer. Insertion is UPSERT — multiple events for the same date+driver accumulate into a single row.

### Drivers + emission sources

| `driver` | Source | Emission cadence | `unit_type` |
|---|---|---|---|
| `claude_api_input_tokens` | Captured from Anthropic API response headers (`anthropic-input-tokens`) on every model call | Per-call, batched to D1 every 60s | `input_tokens` |
| `claude_api_output_tokens` | Same response headers (`anthropic-output-tokens`) | Per-call, batched 60s | `output_tokens` |
| `fly_machine_minutes` | Fly.io billing API; pulled by nightly Captain job at 02:00 UTC | Daily | `machine_minutes` |
| `d1_reads` | D1 metering query (`PRAGMA d1_metrics` or Cloudflare GraphQL Analytics) | Daily nightly | `api_calls` |
| `d1_writes` | Same source | Daily nightly | `api_calls` |
| `r2_storage_gb_hours` | Cloudflare R2 metering API | Daily nightly | `gb_hours` |
| `r2_class_a_ops` | Same source (writes, list operations) | Daily nightly | `api_calls` |
| `r2_class_b_ops` | Same source (reads) | Daily nightly | `api_calls` |
| `vectorize_queries` | Cloudflare Vectorize metering API | Daily nightly | `api_calls` |
| `vectorize_dimensions_stored` | Same source | Daily nightly | `dimensions` |
| `composio_actions` | Composio usage API; pulled by nightly job | Daily nightly | `api_calls` |
| `agentmail_messages` | AgentMail billing API | Daily nightly | `messages` |
| `agentmail_mailbox_days` | AgentMail subscription pull | Daily nightly | `mailbox_days` |
| `third_party_api_lawpay` | LawPay billing API (if cost model includes per-call fees) | Daily nightly | `api_calls` |
| `third_party_api_docusign` | DocuSign billing | Daily nightly | `envelopes` |
| `third_party_api_courtlistener` | CourtListener (free tier; logged as units only) | Daily nightly | `api_calls` |
| `captain_minutes` | Captain logs manually via `bin/captain-time.sh <slug> <minutes> "<reason>"` | On-demand by Captain | `captain_minutes` |

### Per-call emission (Claude API)

Adapter at `ai-employee/adapter/anthropic_client.py` wraps every Anthropic API call:

```python
async def chat_completion(prompt: ...) -> Response:
    resp = await self._anthropic.messages.create(...)
    in_tokens = resp.usage.input_tokens
    out_tokens = resp.usage.output_tokens
    in_cost_cents = in_tokens * MODEL_PRICING[self.model].input_per_million_cents // 1_000_000
    out_cost_cents = out_tokens * MODEL_PRICING[self.model].output_per_million_cents // 1_000_000
    _cost_event_buffer.add("claude_api_input_tokens", units=in_tokens, cents=in_cost_cents)
    _cost_event_buffer.add("claude_api_output_tokens", units=out_tokens, cents=out_cost_cents)
    return resp
```

A buffer flushes to D1 every 60s or 500 events, whichever comes first. Flushed via D1 UPSERT (`ON CONFLICT (date, driver) DO UPDATE SET amount_cents = amount_cents + excluded.amount_cents, units = units + excluded.units`).

Model pricing live in `ai-employee/adapter/anthropic_pricing.json`:

```json
{
  "claude-opus-4-7": { "input_per_million_cents": 1500, "output_per_million_cents": 7500 },
  "claude-sonnet-4-6": { "input_per_million_cents": 300, "output_per_million_cents": 1500 },
  "claude-haiku-4-5-20251001": { "input_per_million_cents": 80, "output_per_million_cents": 400 }
}
```

Captain updates this JSON on Anthropic price changes; CI test ensures every customer.yaml-declared `model` has a pricing entry.

### Nightly Captain job

A Cloudflare Worker scheduled cron `0 2 * * *` at `infra/workers/cost-telemetry/worker.ts` iterates every active customer:

```
for customer in list_customers():
    fly_minutes = fly_api.minutes_for_machine(f"hermes-{customer}", yesterday)
    d1_metrics  = cloudflare_api.d1_metrics(f"hermes-{customer}-d1", yesterday)
    r2_metrics  = cloudflare_api.r2_metrics(f"hermes-{customer}-r2", yesterday)
    vec_metrics = cloudflare_api.vectorize_metrics(f"hermes-{customer}-vault", yesterday)
    composio    = composio_api.usage_for_account(customer_account_id, yesterday)
    agentmail   = agentmail_api.usage_for_mailbox(customer_mailbox_id, yesterday)
    upsert all into customer's cost_telemetry (date=yesterday)
```

Failures (single source fails): log to Captain alerting; do NOT block other sources. Captain-only dashboard surfaces stale-source warnings.

### Captain time logging

```bash
bin/captain-time.sh <customer-slug> <minutes> "<reason>"
```

Writes one row: `date=today, driver=captain_minutes, amount_cents=minutes*200*100/60, units=minutes, unit_type=captain_minutes` (assumes $200/hr Captain rate; rate configurable in `bin/captain-time.sh`).

### Per-customer rollup view

The Captain control plane dashboard reads per-customer per-day cost via:

```sql
SELECT date, SUM(amount_cents) AS total_cents,
  SUM(CASE WHEN driver = 'claude_api_input_tokens' THEN amount_cents END) AS claude_in,
  SUM(CASE WHEN driver = 'claude_api_output_tokens' THEN amount_cents END) AS claude_out,
  ...
FROM cost_telemetry
WHERE date >= ?
GROUP BY date ORDER BY date DESC;
```

Surfaced in the Captain dashboard at `admin.smd.services/ai-employee/cost/{customer}`. Phase 4 ships a customer-facing version.

### COGS/MRR ratio computation

```
month_cogs_cents = SUM(amount_cents) for the month
mrr_cents        = customer's flat-monthly SKU price in cents
ratio            = month_cogs_cents / mrr_cents
```

Alert fires when `ratio > 0.40` for two consecutive months. Audit event `COGS_RATIO_HIGH` written. Captain decides: re-price the customer, impose usage cap, or absorb temporarily.

## Failure modes

- **Anthropic API response missing usage headers**: log warning; record zero-token row with `units=null`; Captain alerted weekly on cumulative null rate.
- **Fly/Cloudflare metering API rate-limited**: nightly job retries with exponential backoff (1m/5m/15m); skips after 3 fails; Captain alerted.
- **Composio API down for >24h**: composio row stays zero for those days; data backfills when API recovers (composio returns historical usage in their API per their docs).
- **Pricing changes mid-month**: cost_telemetry stores `amount_cents` computed at emission time using the pricing in effect then. No retroactive recomputation. Per PRD §15.1 the pricing-strategy doc explicitly covers month-of-change recomputation.
- **Captain forgets to log time**: row stays empty. Weekly automated reminder via Slack DM to Captain summarizing untagged Captain hours.

## Verification

1. **Per-call emission test** at `tests/ai-employee/cost-telemetry-emission.test.ts`: drive 100 mocked Anthropic calls, assert exactly 200 events written (1 in_tokens + 1 out_tokens per call), assert correct cents math against the pricing JSON.
2. **Nightly job test**: stub all source APIs; run the worker; assert exactly N rows per customer written for `yesterday` date; assert source failures don't block other sources.
3. **Pricing-update CI guard**: every customer.yaml's `model` must have an entry in `anthropic_pricing.json`.
4. **COGS ratio computation test**: seed cost_telemetry with a known total; assert ratio matches expected % to 4 decimal places.

## Implementation notes

- Buffer module: `ai-employee/adapter/cost_event_buffer.py` (Python; flushes via aiohttp to D1 HTTP API). TS twin if/when adapters port.
- Wrap every Anthropic call via `anthropic_client.py` rather than skill code touching the raw SDK; CI grep blocks direct SDK imports outside this wrapper.
- Nightly Worker: `infra/workers/cost-telemetry/worker.ts`; cron `0 2 * * *` UTC; lives in main repo so it ships with platform code.
- Captain dashboard view: `src/pages/admin/ai-employee/cost/[customer].astro` reads from per-customer D1.
- Captain time helper: `bin/captain-time.sh` (bash, calls D1 via wrangler).
- Cross-references:
  - d1-schema.md (cost_telemetry table)
  - decommission-drain.md (final cost_telemetry export before D1 deletion)

[AMBIGUITY: Composio managed connectors (Gmail, Slack, GitHub) charge per-action; their per-action prices vary by toolkit and aren't published as a static JSON. Either (a) hardcode per-toolkit pricing in a manual file we update when Composio changes prices, or (b) pull pricing dynamically per their API if available. Captain decision.]

[AMBIGUITY: D1 metering doesn't currently expose per-database read/write counts via a simple API — Cloudflare GraphQL Analytics is the mechanism. Validate access pattern against the live Cloudflare account before committing to the nightly pull approach.]
