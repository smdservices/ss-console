# Demo-fixture loader

**Spec for issue [#890](https://github.com/venturecrane/ss-console/issues/890).** Tool that seeds a customer's Hermes Machine substrate with realistic-looking demo data (the 8 synthetic PI matters from PR #832 plus generated communications, calendar items, and synthetic voice samples) as if it were live operations. Tagged for clean removal post-meeting.

## Source

- [Platform PRD](../../pm/operator/platform-prd.md) §16 (demo-flow requirements)
- [Law Firm PRD](../../pm/operator/law-firm-prd.md) §11, §12.5 (demo readiness)
- [PR #832](https://github.com/venturecrane/ss-console/pull/832) — 8 synthetic PI matter fixtures
- [PR #944](https://github.com/venturecrane/ss-console/pull/944) — memory ingestion pipeline (substrate writer the loader composes with)
- [PR #951](https://github.com/venturecrane/ss-console/pull/951) — voice ingestion pipeline (substrate writer the loader composes with)
- [Decommission spec](./decommission-customer.md) — the unload path is a focused subset of the decommission flow

## Scope

The loader is one of three related demo-prep surfaces:

| Tool                                    | Issue | Purpose                                                |
| --------------------------------------- | ----- | ------------------------------------------------------ |
| `prepare-demo-firm.sh`                  | #819  | Verifies a customer is demo-ready (READ-ONLY)          |
| `load-demo-fixtures.sh`                 | #890  | Seeds demo rows into a customer's substrate (THIS DOC) |
| Customer-zero rehearsal pipeline (#889) | #889  | End-to-end rehearsal flow that calls both              |

The loader's invariants are tighter than the prep tool's. The prep tool reads state; the loader writes state. Every loader contract documented below exists because a write tool that touches the wrong customer is unrecoverable.

## CLI

```bash
operator/bin/load-demo-fixtures.sh <customer-slug> <vertical>
operator/bin/load-demo-fixtures.sh <customer-slug> <vertical> --unload
```

### Arguments

- `<customer-slug>` — the per-customer directory name under `operator/customers/`. Must match `^[a-z0-9][a-z0-9-]{0,31}$` and must NOT begin with `_` (reserved for `_template/`).
- `<vertical>` — currently `pi` for personal-injury. The structure supports additional verticals registered in `bin/lib/demo_fixtures.VERTICAL_REGISTRY`. Unknown verticals exit with code 2.
- `--unload` — optional. Removes every row tagged `is_demo_fixture: true` from the per-customer substrate. Idempotent.

### Exit codes

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| `0`  | Load or unload completed (including idempotent re-runs)         |
| `2`  | Preflight failure (bad slug / missing customer / fixtures gone) |
| `4`  | Safety refusal: customer holds non-demo rows                    |

Code `3` is deliberately not used. The loader's correctness model is binary at the substrate level: either every demo row is written or none are. There is no partial-success state to resume from. The unload path provides the clean rollback when a load needs to be redone.

## Tagging contract

Every row written by this loader carries:

```json
{
  "metadata": {
    "is_demo_fixture": true,
    "watermark": "[SYNTHETIC FIXTURE — NOT A REAL MATTER]"
  }
}
```

The `is_demo_fixture` key is the load / unload uniqueness selector. The `watermark` is the human-readable label the dashboard renders on the synthetic-data banner. The two are written together; the loader does not write one without the other.

## Substrate writers

The loader writes through two storage Protocols (`MemorySubstrateWriter`, `VoiceSubstrateWriter`) so test fakes, file-backed defaults, and production D1 + R2 wirings all interoperate.

### Default file-backed writer

`FilesystemMemoryStore` and `FilesystemVoiceStore` write to a single per-customer JSON document under:

```
operator/customers/{slug}/.demo-fixtures-state.json
```

This keeps the loader useful from any workstation, mirroring the snapshot pattern `demo_prep.py` uses for readiness checks. The state file is gitignored at the customer-directory level (the `_template/` is the only checked-in customer dir) and is removed on `--unload`.

### Production D1 + R2 writer (follow-on)

The production writer composes with:

- `adapter/memory/state.SourceStateStore` for `memory_ingested_items` rows
- `adapter/voice/state.VoiceSourceStateStore` for `voice_ingestion_items` rows
- An `R2StorageClient` implementation for synthetic voice-sample bodies

The production writer is filed as a follow-on. The Protocol surface in `demo_fixtures.py` is the contract that follow-on implements. The decommission hook in `adapter/memory/state.decommission_source` already knows how to sweep by `(source_kind, source_id)` — the loader's `demo_fixtures` source kind is removable by the decommission tool without modification.

## Idempotency

Re-running the load on a customer that already has demo data:

- Does NOT insert duplicate rows. Uniqueness is keyed by `(source_kind, external_id)` for memory rows and `content_digest` for voice rows.
- Refreshes the `ingested_at` timestamp on every existing row.
- Returns `outcome: refreshed` in the report.

Re-running the unload after removal:

- Removes nothing.
- Returns `outcome: noop` in the report.

This matches the pattern established by `bin/lib/decommission.py` (issue #820) and `bin/lib/demo_prep.py` (issue #819).

## Safety refusal

Before writing the first row, the loader scans the per-customer memory and voice stores for any row whose metadata does NOT carry `is_demo_fixture: true`. If any such row exists, the loader:

1. Exits with code 4
2. Prints `SAFETY REFUSAL: ...` to stderr
3. Writes NOTHING

This invariant holds on both `load` and `--unload`. The unload path enforces it because a demo tool should never be the last code path that touched a real customer's data, even if the intent is to delete only demo rows.

The refusal is keyed on per-row metadata rather than on the customer.yaml or directory naming. Renaming a customer or repurposing a directory does not bypass the check; the data itself decides.

## Dashboard banner

The dashboard renders a "DEMO DATA" banner when the customer's substrate is being driven by this loader. The flag the dashboard reads is:

```yaml
demo:
  is_demo_substrate: true
```

This is an OPTIONAL extension to the `customer.yaml` schema (see `customer-yaml-schema.md`). Validator behavior:

- Field is OPTIONAL. Defaults to `false` when absent.
- When `true`, the validator does NOT modify any other field. The flag is a render hint, not a runtime guard. The substrate-level guard is the `is_demo_fixture` row tag enforced by this loader.

**This loader does NOT modify customer.yaml.** Setting the flag is a separate step (a human edit or a future provisioning hook) outside the loader's blast radius. This is intentional: a tool that writes both rows AND configuration is harder to reason about than one that writes only rows.

The dashboard implementation is OUT OF SCOPE for this spec. The flag is documented here so the loader's data + the dashboard's renderer agree on the contract before the dashboard work begins.

## Vertical extension

A new vertical adds itself to `bin/lib/demo_fixtures.VERTICAL_REGISTRY`:

```python
VERTICAL_REGISTRY["real-estate"] = VerticalConfig(
    name="real-estate",
    corpus_subpath="real-estate/transaction",
    matters_subdir="transactions",
    communications_subdir="emails",
    intake_subdir="lead-intake",
    billing_subdir="settlements",
)
```

The PI matter parser is currently hard-coded for the markdown envelope shipped by PR #832. Verticals using a different envelope (JSON, plain text) supply their own parser; the loader's row-builder shape is vertical-agnostic.

The `_demo_manifest.md` file at `operator/fixtures/_demo_manifest.md` is the canonical list of what gets loaded; it is updated when a vertical is added.

## What this loader does NOT do

- Does not modify `operator/fixtures/` (read-only at runtime).
- Does not modify `operator/customers/{slug}/customer.yaml`.
- Does not invoke `bin/provision-customer.sh`, the Fly Machine, Composio, AgentMail, SignWell, or any outbound service.
- Does not generate new synthetic content. The synthesized calendar items and voice cohorts derived from the corpus are deterministic functions of corpus state, not LLM output.
- Does not write outside the per-customer directory + (in production) the per-customer D1 namespace + the per-customer R2 prefix.

## Cross-references

- [`customer-yaml-schema.md`](./customer-yaml-schema.md) — `demo.is_demo_substrate` flag (this loader contributes the contract; the schema doc adopts it in a follow-on)
- [`memory-ingestion.md`](./memory-ingestion.md) — production memory substrate the file-backed writer mirrors
- [`voice-ingestion.md`](./voice-ingestion.md) — production voice substrate the file-backed writer mirrors
- [`decommission-customer.md`](./decommission-customer.md) — the loader's `demo_fixtures` source kind is sweepable by `decommission_source`
- [`day-1-onboarding.md`](./day-1-onboarding.md) — describes when the loader is used in the pre-meeting flow
- [ADR 0008](../../adr/0008-customer-owned-memory.md) — customer-owned memory invariants the loader respects
- [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md) — cross-Machine query prohibition (the loader writes only to the target customer's substrate)
