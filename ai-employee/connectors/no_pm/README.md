# no_pm connector -- synthetic PracticeManagement adapter for customers without an external PM system

Status: v1 (issue [#853](https://github.com/venturecrane/ss-console/issues/853)). Most target-buyer firms operate without a working practice-management vendor (paper + Outlook + OneDrive + QuickBooks for billing). The PI PRDs assume Filevine / Clio / CASEpeer; this adapter is the matching capability binding for the no-PM-system reality. The capability-adapter pattern itself is locked in [ADR 0006](../../../docs/adr/0006-capability-adapter-pattern.md).

## What this connector covers

| Capability         | Methods implemented                                                                                                                               | TypeScript contract                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| PracticeManagement | `search_matters`, `get_matter`, `create_matter`, `update_matter`, `list_matter_documents`, `create_note`, `describe_capabilities`, `health_check` | [`src/lib/ai-employee/capabilities/practice-management.ts`](../../../src/lib/ai-employee/capabilities/practice-management.ts) |

The adapter implements the full read + create/update matter surface plus matter-scoped note + document listings -- the minimum needed to drive the demo flow without an external PM vendor. Methods the synthetic store cannot honestly serve (`search_contacts`, `get_contact`, `create_contact`, `list_time_entries`, `create_time_entry_draft`, `upload_matter_document`) are declared in `unsupported_methods` and raise `AdapterError(code="capability_not_supported")` if invoked. This satisfies the UNSUPPORTED_METHODS_THROW conformance invariant -- there are no silent stubs.

The adapter binds to PracticeManagement only. Document storage, email, calendar, signatures, and accounting are bound to their own first-class capability adapters (OneDrive, Microsoft Graph, DocuSign, QuickBooks) in the same `customer.yaml`.

## Cross-language contract mapping

The capability interfaces are TypeScript; the runtime adapter is Python (lives in the Hermes Machine per [ADR 0007](../../../docs/adr/0007-per-customer-machine-isolation.md) / [ADR 0009](../../../docs/adr/0009-cross-machine-query-prohibition.md)). Both sides agree on:

| Concept              | TypeScript (`src/lib/ai-employee/capabilities/`)   | Python (`ai-employee/connectors/no_pm/`)             |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| Capability interface | `interface PracticeManagement extends AdapterBase` | `class NoPmPracticeManagement`                       |
| Method names         | snake_case (`search_matters`, `create_note`)       | snake_case (identical)                               |
| Return shape         | `interface Matter { id, client_name, ... }`        | `@dataclass(frozen=True) class Matter`               |
| Error contract       | `class AdapterError` + `type AdapterErrorCode`     | `class AdapterError` + `Literal[...]` in `errors.py` |
| Capability set       | `interface CapabilitySet`                          | `@dataclass(frozen=True) class CapabilitySet`        |
| Error codes          | Closed union of 9 strings                          | `frozenset` of identical 9 strings (pinned by test)  |
| Capability names     | Closed union of 11 strings                         | `frozenset` of identical 11 strings (pinned by test) |

Drift between the two languages is a P0. `tests/test_errors.py` pins the closed unions; if anyone changes `types.ts`, that test fails immediately on the Python side and forces a paired update -- the same shape Filevine uses.

## Storage seam

The no_pm adapter persists matters, notes, and matter-document indexes to a `MatterStore`:

```python
class MatterStore(Protocol):
    async def list_matters(self, *, client_name=None, matter_type=None,
                           status=None, limit=50, offset=0) -> list[StoredMatter]: ...
    async def get_matter(self, matter_id: str) -> Optional[StoredMatter]: ...
    async def create_matter(self, matter: StoredMatter) -> StoredMatter: ...
    async def update_matter(self, matter_id, *, client_name=None,
                            matter_type=None, status=None,
                            custom_fields=None) -> StoredMatter: ...
    async def list_matter_documents(self, matter_id) -> list[StoredMatterDocument]: ...
    async def create_matter_note(self, note: StoredMatterNote) -> StoredMatterNote: ...
```

- **Production wiring (planned).** A `D1MatterStore` implementation is the follow-on issue. It maps onto per-customer D1 tables `no_pm_matters` and `no_pm_matter_notes`; documents live in the per-customer R2 vault at `vaults/{customer_id}/no_pm/matters/{matter_id}/documents/`. Per [ADR 0008](../../../docs/adr/0008-customer-owned-memory-artifact.md), every artifact the adapter writes lands in customer-owned storage that decommission can drain. Per [ADR 0009](../../../docs/adr/0009-cross-machine-query-prohibition.md), no tenant ID is ever passed in -- isolation is structural via the per-Machine binding.
- **Test wiring (today).** `InMemoryMatterStore` is a dict-backed reference implementation; tests inject it directly. The adapter's `__init__` defaults to `InMemoryMatterStore()` so a no-arg `NoPmPracticeManagement()` boots cleanly for the conformance harness.

## customer.yaml binding

The connector is bound per-customer via the `connectors:` map in `customer.yaml` ([schema spec](../../../docs/specs/ai-employee/customer-yaml-schema.md)):

```yaml
connectors:
  PracticeManagement:
    adapter: no_pm
    backend: build:no_pm
    enabled: true
    # No token_ref -- the synthetic store has no external OAuth surface.
    # Persistence binds to the per-customer D1 + R2 wiring at provision time.
```

Notes on the binding shape:

- `adapter: no_pm` -- the SMD-internal slug. The validator (`src/lib/ai-employee/customer-yaml/validator.ts`) treats it as opaque; the boot-time conformance harness asserts `NoPmPracticeManagement` satisfies the interface.
- `backend: build:no_pm` -- `build:` prefix means SMD-owned implementation (this connector). There is no external vendor; the substrate is in-process per-customer D1 + R2.
- No `token_ref` -- the synthetic store does not authenticate against an external API. The per-customer D1 + R2 binding is wired at provision time (see `bin/provision-customer.sh`).
- The companion `customer-no-pm-system.yaml` template at `ai-employee/templates/customer-no-pm-system.yaml` ships the full default binding set (MS Graph for email + calendar, DocuSign for signatures, OneDrive for documents, QuickBooks for accounting, no_pm for practice management).

## ADR 0005 -- reviewer-as-sender attribution

`create_note` is the only mutating method that produces user-visible content. Per [ADR 0005](../../../docs/adr/0005-reviewer-as-sender.md):

- The note's `author_account_id` is the reviewer's account, not "AI Employee" and not the persona name.
- The note body is the drafted content verbatim. No "[Drafted by Marcus]" prefix.
- The `drafted_by_skill` field rides on the note for the dashboard sourcing block.
- There is no autonomous-send method anywhere in this connector. The synthetic store writes only to per-customer storage; nothing leaves the Machine.

The `tests/test_capabilities.py::test_adapter_has_no_banned_method_names` test asserts the adapter exposes no method name from the banned-method-name list.

## Fabrication discipline

Per the no-fabrication rule (Platform PRD invariant #8 + CLAUDE.md project policy):

- The store-to-capability translation is 1:1. Field values from `StoredMatter` are copied to `Matter` without invention; missing optional fields stay as `None`.
- The adapter synthesizes two fields when the caller omits them on `create_matter`: a fresh `matter_id` (`mat_<hex>`) and a current ISO `opened_at`. Both are disclosed in `describe_capabilities().field_coverage["create_matter"].derived` so the dashboard sourcing block can show "synthesized by no_pm adapter".
- Same for `create_note`: `id` and `created_at` are derived; both are disclosed.
- Unknown matter statuses raise `validation_failed` rather than silently falling back to `"open"`.

## Per-customer isolation

Per [ADR 0007](../../../docs/adr/0007-per-customer-machine-isolation.md) and [ADR 0009](../../../docs/adr/0009-cross-machine-query-prohibition.md):

- The connector is instantiated per-customer in the Hermes Machine.
- No tenant ID appears on any row; isolation is enforced at the deployment layer (one Machine per customer, one `MatterStore` per Machine).
- The `MatterStore` instance is scoped to one customer's D1 + R2 binding; the adapter cannot accidentally read another customer's matters.

## Demo flow this adapter enables

| Demo scene                                                 | What it exercises                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Operator creates a new matter from an Outlook intake email | `create_matter` writes to the synthetic store; matter shows up in the dashboard matters tab |
| Marcus drafts a status-update note                         | `create_note` records reviewer attribution + drafted-by-skill metadata                      |
| Matter is closed                                           | `update_matter(status="closed")` records `closed_at` from the server clock                  |
| Dashboard matters tab                                      | `search_matters` lists local matters; `list_matter_documents` lists per-matter R2 docs      |

The spec at [`docs/specs/ai-employee/no-pm-system-mode.md`](../../../docs/specs/ai-employee/no-pm-system-mode.md) walks each demo scene through the full no-PM-system binding set.

## Testing

Unit tests live in `tests/`. From the repo root:

```bash
cd ai-employee && python -m pytest connectors/no_pm/tests/ -v
```

Coverage:

| File                         | Asserts                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/test_errors.py`       | AdapterError code + capability union pinned against the TypeScript contract                                                           |
| `tests/test_store.py`        | `InMemoryMatterStore` honors the `MatterStore` protocol (list / get / create / update / docs / notes)                                 |
| `tests/test_capabilities.py` | `NoPmPracticeManagement` happy paths; unsupported-method behavior; ADR 0005 attribution; no banned method names; end-to-end demo flow |

There is no live-sandbox smoke test -- the no_pm adapter has no external vendor to smoke against. The in-memory store IS the smoke test.

## What ships next

- A `D1MatterStore` implementation backed by the per-customer D1 + R2 substrate (follow-on issue against this PR).
- Boot-time wiring in `bin/provision-customer.sh` so customers with `adapter: no_pm` get the D1 schema applied and the store wired automatically.
- If the customer later signs with a real PM vendor, the binding flips in `customer.yaml` -- no skill code changes.
