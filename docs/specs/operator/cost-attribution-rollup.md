# Cost Attribution Rollup

**Spec for issue [#884](https://github.com/venturecrane/ss-console/issues/884).** Per-customer monthly rollup over the `cost_telemetry` table that the [cost-telemetry-events.md](cost-telemetry-events.md) emitters write. The §17.1 COGS/MRR margin gate reads its totals from the function defined here.

## Source

- [cost-telemetry-events.md](cost-telemetry-events.md) — emitter spec; the row source this rollup reads
- [d1-schema.md](d1-schema.md) §6 — `cost_telemetry` shape; §6 also defines `captain_time_events`
- [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md) — per-customer database binding

## Why this exists

Emitters produce per-`(date, driver)` rows in `cost_telemetry`. The dashboard, the §17.1 COGS/MRR ratio computation, the decommission-final cost export, and the Captain control plane all need the same view: a single month, rolled up per customer, with totals grouped into the nine §15.1 cost categories.

Without a single rollup module, every consumer reimplements the GROUP BY and the driver-to-category mapping. That is how the driver enum drifts: two consumers map `r2_class_a_ops` differently and the COGS/MRR ratio gate stops being falsifiable.

This module is the single authoritative reader. Every consumer calls it.

## Contract

### Inputs

```python
async def compute_monthly_rollup(
    reader: RowReader,
    year_month: str,
) -> MonthlyRollup
```

- `reader` is an executor already bound to one customer's per-customer D1 database. The caller is responsible for picking the binding per ADR 0009. There is no `customer_id` parameter — isolation is the binding, not a row-level column.
- `year_month` is `YYYY-MM` UTC. The function validates the shape and rejects months outside `[2026-01, 2100-12]`.

### Output

```python
@dataclass(frozen=True)
class MonthlyRollup:
    year_month: str
    total_cents: int
    by_category_cents: Mapping[DriverCategory, int]
    by_category_basis_points: Mapping[DriverCategory, int]
    per_driver_detail_cents: Mapping[str, int]
    row_count: int
```

- `total_cents` is the sum of `amount_cents` across every `cost_telemetry` row in the month with `amount_cents >= 0`. Negative rows are filtered at the SQL layer and skipped at the Python layer (defense in depth).
- `by_category_cents` carries every `DriverCategory` key, even at zero, so consumers can render a stable column set.
- `by_category_basis_points` is the integer-basis-point share per category. Basis points are 1/100 of a percent; the §17.1 `> 0.40` kill threshold is 4000 bps. Integer arithmetic prevents float drift in the ratio gate.
- `per_driver_detail_cents` preserves the raw `cost_telemetry.driver` values so the Captain dashboard can drill into a category and surface unknown drivers from the `OTHER` bucket.
- `row_count` lets a consumer sanity-check that data was actually present.

### Driver categories

The categories match the §15.1 cost drivers:

| `DriverCategory`       | Raw drivers (from cost-telemetry-events.md)               |
| ---------------------- | --------------------------------------------------------- |
| `ANTHROPIC_LLM`        | `claude_api_input_tokens`, `claude_api_output_tokens`     |
| `FLY_COMPUTE`          | `fly_machine_minutes`                                     |
| `CLOUDFLARE_D1`        | `d1_reads`, `d1_writes`                                   |
| `CLOUDFLARE_R2`        | `r2_storage_gb_hours`, `r2_class_a_ops`, `r2_class_b_ops` |
| `CLOUDFLARE_VECTORIZE` | `vectorize_queries`, `vectorize_dimensions_stored`        |
| `AGENTMAIL`            | `agentmail_messages`, `agentmail_mailbox_days`            |
| `CAPTAIN_TIME`         | `captain_time`                                            |
| `OTHER`                | anything not in the explicit map above                    |

Adding a new driver requires editing `_DRIVER_TO_CATEGORY` in `operator/adapter/cost_rollup.py` in the same PR that adds the emitter. Drivers that arrive without a category land in `OTHER`; their raw name is preserved in `per_driver_detail_cents` so they surface in the dashboard for triage.

### COGS/MRR ratio

```python
rollup.cogs_mrr_basis_points(mrr_cents=200_000)  # returns Optional[int]
```

Returns `None` when `mrr_cents <= 0` (an unpriced customer; the ratio is undefined). Otherwise returns `(total_cents * 10_000) // mrr_cents`. The §17.1 alert seam is the Captain dashboard's responsibility — this module computes the value but does not fire notifications.

### Aggregation cadence

V1 implementation is **on-demand only**. Every call recomputes the rollup. A daily cron seam is documented for the future:

- A Cloudflare Worker scheduled cron could call `compute_monthly_rollup` per active customer and persist the result for the dashboard to read without recomputing.
- The persisted shape would mirror `MonthlyRollup` as a JSON blob or a per-`(customer, year_month, category)` table.
- The current contract does not write — adding a writer happens in a follow-on PR, not here.

On-demand is sufficient for v1 because `cost_telemetry` rows are bounded by `30 days × ~16 drivers = ~500 rows/customer/month`. A full-month aggregate on D1 takes single-digit milliseconds.

## Storage shape

`cost_telemetry` already exists from migration 0001:

```sql
CREATE TABLE cost_telemetry (
  date         TEXT NOT NULL,               -- YYYY-MM-DD (UTC)
  driver       TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  units        REAL,
  unit_type    TEXT,
  PRIMARY KEY (date, driver)
);
```

> **Amended 2026-07-03 (ADR 0062, #1660).** The storage location moved to the central ss-console D1; see the amendment under "Privacy posture". `operator/migrations/0006` remains as historical record; the live tables are created by `migrations/0083_central_cost_telemetry.sql`.

Migration `0006_cost_attribution_rollup.sql` adds:

1. `captain_time_events` — the per-event Captain time table referenced by cost-telemetry-events.md "Captain time logging" but not present in migration 0001. The `crane operator log-time` CLI writes one row here per invocation and pairs that with a same-day UPSERT into `cost_telemetry` under `driver='captain_time'`.
2. `idx_cost_telemetry_date` — a stand-alone date index for monthly-scan queries. The existing `(date, driver)` PK already covers exact-date reads; this index gives the planner an alternative for date-only scans.

Neither change touches existing rows. The migration is additive.

## Privacy posture

> **Amended 2026-07-03 (ADR 0062, #1660).** Superseded for the cost tables: `cost_telemetry` and `captain_time_events` now live in the central ss-console D1 (migration `0083_central_cost_telemetry.sql`) with a `customer_slug` tenant column. Cost rows are SMD's own spend metadata, not customer content, and ADR 0009 explicitly carves out control-plane billing reconciliation. Cross-customer aggregation is therefore a single query against the central table; per-customer readers scope by `customer_slug` and must exclude the reserved `_org` / `_unmapped` slugs. The original text is retained below as historical record.

Per [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md), `cost_telemetry` and `captain_time_events` live in the per-customer D1 database. No row-level `customer_id` column. No cross-customer aggregate query is possible at the database layer. The rollup module accepts a single executor bound to one customer's database; computing a cross-customer total requires N calls and an aggregation in the Captain control plane.

## Failure modes

- **Empty month.** Returns a zero `MonthlyRollup`. Not an error — a brand-new customer has no rows yet.
- **Negative `amount_cents`.** Filtered at the SQL layer (`WHERE amount_cents >= 0`). The Python layer also skips negative rows from non-SQL sources (a future in-memory reader) and logs a warning. A persistently-negative row signals a corrupt emitter and is a Captain triage item.
- **Unknown driver.** Bucketed into `DriverCategory.OTHER`. The raw driver name survives in `per_driver_detail_cents` so the dashboard can render it for triage.
- **Year out of `[2026, 2100]`.** `ValueError` raised before SQL executes. Defensive bound; the substrate did not exist before 2026.
- **Database error.** Surfaces as the underlying executor exception. The module does not swallow database failures.

## Verification

Unit tests at `operator/adapter/tests/test_cost_rollup.py` cover:

1. Year-month input validation (shape, month bounds, year bounds, non-string).
2. Empty-month rollup returns zero totals with every category key present.
3. Aggregation across multiple drivers + multiple days.
4. Per-category bucketing for all nine categories.
5. Unknown drivers bucket into `OTHER` and preserve their raw name in the per-driver detail map.
6. Basis-point shares sum to 10,000 for a non-empty month and are zero for an empty month.
7. Month-bound filter excludes adjacent months, including the December year roll.
8. Negative `amount_cents` is filtered at the SQL layer (positive-only sum) and skipped at the Python layer (warning).
9. `cogs_mrr_basis_points` returns `None` for unpriced customers and basis points for priced.
10. The UPSERT accumulation pattern from the emitter spec lands correctly when the rollup reads.

Run from repo root:

```
cd operator && python -m pytest adapter/tests/test_cost_rollup.py -v
```

## Implementation notes

- Module: `operator/adapter/cost_rollup.py`.
- Migration: `operator/migrations/0006_cost_attribution_rollup.sql`.
- The aggregate query uses a half-open date range (`date >= 'YYYY-MM-01' AND date < 'YYYY-MM+1-01'`) so the `(date, driver)` PK serves the scan without a function call per row.
- A production D1 HTTP reader is not implemented here. The `RowReader` Protocol accepts any async `fetch_rows(sql, params)`. The `SqliteRowReader` implementation ships for tests and local dev; the production wrapper around `HttpD1Executor` is a small wiring exercise that lives outside this module's scope.
- Cross-references:
  - [cost-telemetry-events.md](cost-telemetry-events.md) — the emitter side
  - [d1-schema.md](d1-schema.md) — the table shape this reads
  - [decommission-customer.md](decommission-customer.md) — final rollup before D1 deletion

[AMBIGUITY: Cron seam — should the on-demand rollup be paired with a nightly persist into a `cost_summary` table, or is on-demand sufficient through Phase 4? Captain decision.]

[AMBIGUITY: Cross-customer aggregation surface — the Captain control plane needs a portfolio-level COGS view across all customers. ADR 0009 forbids a cross-Machine query at the database layer. The control plane will fan out N rollups and aggregate in process; the API shape for this fan-out lives in a follow-on issue.]
