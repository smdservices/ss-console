# Filevine connector -- PI vertical practice-management adapter v1

Status: v1 (issue [#851](https://github.com/venturecrane/ss-console/issues/851)). Filevine is the first PI-vertical PracticeManagement adapter per [ADR 0014](../../../docs/adr/0014-pi-vertical-adapter-build-priority.md). The capability-adapter pattern itself is locked in [ADR 0006](../../../docs/adr/0006-capability-adapter-pattern.md).

## What this connector covers

| Capability         | Methods implemented                                                                                             | TypeScript contract                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| PracticeManagement | `search_matters`, `get_matter`, `list_matter_documents`, `create_note`, `describe_capabilities`, `health_check` | [`src/lib/operator/capabilities/practice-management.ts`](../../../src/lib/operator/capabilities/practice-management.ts) |
| DocumentStorage    | `list_documents`, `get_document`, `get_document_bytes`, `describe_capabilities`, `health_check`                 | [`src/lib/operator/capabilities/document-storage.ts`](../../../src/lib/operator/capabilities/document-storage.ts)       |

Everything else on the TypeScript interfaces (e.g. `create_matter`, `upload_document`, `share_document_draft`, `list_versions`, time entries, contacts) is explicitly declared in `unsupported_methods` and raises `AdapterError(code="capability_not_supported")` if invoked. This satisfies the `UNSUPPORTED_METHODS_THROW` conformance invariant -- there are no silent stubs.

## Cross-language contract mapping

The capability interfaces are TypeScript; the runtime adapter is Python (lives in the Hermes Machine per [ADR 0007](../../../docs/adr/0007-per-customer-machine-isolation.md) / [ADR 0009](../../../docs/adr/0009-cross-machine-query-prohibition.md)). Both sides agree on:

| Concept              | TypeScript (`src/lib/operator/capabilities/`)      | Python (`operator/connectors/filevine/`)             |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| Capability interface | `interface PracticeManagement extends AdapterBase` | `class FilevinePracticeManagement`                   |
| Method names         | snake_case (`search_matters`, `create_note`)       | snake_case (identical)                               |
| Return shape         | `interface Matter { id, client_name, ... }`        | `@dataclass(frozen=True) class Matter`               |
| Error contract       | `class AdapterError` + `type AdapterErrorCode`     | `class AdapterError` + `Literal[...]` in `errors.py` |
| Capability set       | `interface CapabilitySet`                          | `@dataclass(frozen=True) class CapabilitySet`        |
| Error codes          | Closed union of 9 strings                          | `frozenset` of identical 9 strings (pinned by test)  |
| Capability names     | Closed union of 11 strings                         | `frozenset` of identical 11 strings (pinned by test) |

Drift between the two languages is a P0. `tests/test_errors.py` pins the closed unions; if anyone changes `types.ts`, that test fails immediately on the Python side and forces a paired update.

## Identity & Access seam

Filevine uses OAuth 2.0 (Authorization Code grant -- see Filevine API docs at https://developer.filevine.io/). The real Identity & Access layer for token storage, refresh, and per-customer scoping is being built in issues [#789](https://github.com/venturecrane/ss-console/issues/789) and [#822](https://github.com/venturecrane/ss-console/issues/822). Both issues are open when this connector ships.

This connector defines a Protocol -- `FilevineAuthProvider` -- that wraps token acquisition:

```python
class FilevineAuthProvider(Protocol):
    async def get_valid_token(self) -> TokenSet: ...
    def org_slug(self) -> str: ...
```

- **Production wiring** (post-#789/#822): The Identity & Access layer constructs an implementation backed by the per-customer secret bundle. The implementation handles refresh, rotation, and audit-logging. The connector itself sees only the protocol.
- **Test wiring** (today): `InMemoryFilevineAuth` is a stub that returns a fixed `TokenSet`. Tests use this; the unit-level smoke (`tests/test_smoke_unit.py`) uses this; the credentialed smoke script (`bin/smoke-test-filevine.py`) uses this with env-provided values.

When #789 / #822 land, they should:

1. Create an implementation of `FilevineAuthProvider` in their identity-layer module.
2. Wire it into the per-customer Machine bootstrap so `FilevinePracticeManagement` and `FilevineDocumentStorage` are constructed with the live provider.
3. Leave this connector untouched -- the only required code change is the construction site, not the connector internals.

The connector deliberately does NOT carry an OAuth dance (authorize-redirect-exchange) of its own. That belongs in the identity layer. The seam is what this connector ships.

## customer.yaml binding

The connector is bound per-customer via the `connectors:` map in `customer.yaml` ([schema spec](../../../docs/specs/operator/customer-yaml-schema.md)):

```yaml
connectors:
  PracticeManagement:
    adapter: filevine
    backend: build:filevine
    enabled: true
    scopes:
      - 'fv.api.read'
      - 'fv.api.write.notes'
    token_ref: 'infisical:/operator/{customer_id}/practice-management/filevine-oauth-refresh'

  DocumentStorage:
    adapter: filevine
    backend: build:filevine
    enabled: true
    # token_ref reuses the PracticeManagement OAuth token; the
    # provisioning script wires both bindings to the same auth
    # provider when the adapter slug matches.
    token_ref: 'infisical:/operator/{customer_id}/practice-management/filevine-oauth-refresh'
```

Notes on the binding shape:

- `adapter: filevine` -- the SMD-internal slug. The validator (`src/lib/operator/customer-yaml/validator.ts`) treats it as opaque; the boot-time conformance harness asserts the actual adapter class satisfies the interface.
- `backend: build:filevine` -- `build:` prefix means SMD-owned wrapper (this connector). Filevine has no acceptable first-party MCP, so a BUILD adapter is the binding.
- `token_ref:` -- Infisical reference; resolved by `bin/provision-customer.sh` and injected into the Hermes Machine as a Fly secret. Never a literal token here per the schema's secret-exclusion rules.
- `org_slug` is not in `customer.yaml` because the Identity & Access layer (#789/#822) owns customer-Filevine-tenant mapping. The provider's `org_slug()` returns the bound value at runtime.
- The same `adapter: filevine` slug appears in both bindings because Filevine serves both capabilities. The provisioning script wires them to the same `FilevineClient` instance so they share the auth provider and connection pool.

## Endpoint inventory

Filevine REST API v2 (https://developer.filevine.io/). Endpoints used:

| Capability method       | HTTP request                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| `search_matters`        | `GET /core/projects?orgUid=<org>&clientName=&status=&limit=&offset=` |
| `get_matter`            | `GET /core/projects/{projectId}`                                     |
| `list_matter_documents` | `GET /core/projects/{projectId}/documents`                           |
| `create_note`           | `POST /core/projects/{projectId}/notes`                              |
| `get_document`          | `GET /core/documents/{documentId}`                                   |
| `get_document_bytes`    | `GET /core/documents/{documentId}/download`                          |
| `health_check`          | `GET /core/projects?orgUid=<org>&limit=0` (cheapest probe)           |

Filevine vocabulary -> capability vocabulary translation lives in `capabilities.py`:

- Filevine `project` = capability `matter`
- Filevine `status` (Open / Closed / Pending / Intake) -> capability `MatterStatus` ("open" / "closed" / "pending" / "intake"); unknown vendor statuses preserve the original in `custom_fields._vendor_status_raw` rather than fabricating a translation.
- All non-mapped Filevine fields land verbatim in `Matter.custom_fields` so the dashboard sourcing block ("what Marcus used to write this") can disclose them per [ADR 0006](../../../docs/adr/0006-capability-adapter-pattern.md).

## Fabrication discipline

Per the no-fabrication rule (Platform PRD invariant #8 + CLAUDE.md project policy):

- Optional fields on the Filevine record that are missing return `None` (or `""` for required-by-contract strings).
- The only synthesized field is `StoredDocument.path` -- Filevine has no folder concept, so `path` is constructed as `projects/<projectId>/<filename>`. This synthesis is declared in `describe_capabilities().field_coverage["list_documents"].derived` so the dashboard discloses the synthesis to the human reviewer.
- No vendor status, ID, or attribution is invented. If Filevine returns a record with no `projectId`, the adapter raises `AdapterError(code="unknown")` rather than synthesizing one.

## ADR 0005 -- reviewer-as-sender attribution

`create_note` is the only mutating method. Per ADR 0005:

- The note's `authorAccountId` is the reviewer's Filevine account, not "Operator" and not the persona name.
- The note body is the drafted content verbatim. No "[Drafted by Marcus]" prefix.
- The `metadata.drafted_by_skill` field carries the audit trail for the dashboard sourcing block.
- The `metadata.draft: true` flag distinguishes connector-created notes from hand-typed ones, so a future Filevine review surface (or the dashboard) can render them with the right affordance.

There is no autonomous-send method anywhere in this connector. Filevine has an outbound email surface (via its UI) -- the connector deliberately does not expose it. The reviewer-as-sender boundary is enforced by the `BANNED_METHOD_NAMES` list in the conformance harness; the corresponding Python test (`tests/test_conformance.py::test_adapter_has_no_banned_method_names`) asserts neither adapter exposes any banned method name.

## Per-customer isolation

Per [ADR 0007](../../../docs/adr/0007-per-customer-machine-isolation.md) and [ADR 0009](../../../docs/adr/0009-cross-machine-query-prohibition.md):

- The connector is instantiated per-customer in the Hermes Machine.
- No tenant ID appears on any row; isolation is enforced at the deployment layer (one Machine per customer, one auth provider per Machine).
- The `FilevineAuthProvider` instance is scoped to one customer; the connector cannot accidentally hit another customer's Filevine tenant.

## Testing

Unit tests live in `tests/`. From the repo root:

```bash
cd operator && python -m pytest connectors/filevine/tests/ -v
```

Coverage:

| File                         | Asserts                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `tests/test_errors.py`       | AdapterError code + capability union pinned against the TypeScript contract                           |
| `tests/test_client.py`       | HTTP status code -> AdapterError code translation table                                               |
| `tests/test_capabilities.py` | Each capability method's happy path; field-mapping fidelity; validation; unsupported-method behavior  |
| `tests/test_smoke_unit.py`   | CI-runnable end-to-end smoke covering every supported method through the adapter                      |
| `tests/test_conformance.py`  | Python mirror of the eight conformance invariants from `src/lib/operator/capabilities/conformance.ts` |

### Live sandbox smoke (NOT in CI)

`bin/smoke-test-filevine.py` exercises the connector against a real Filevine tenant. Requires env vars:

```bash
export FILEVINE_ORG_SLUG=<org>
export FILEVINE_API_BASE=https://api.filevine.io     # or sandbox host
export FILEVINE_ACCESS_TOKEN=<oauth token>
export FILEVINE_REFRESH_TOKEN=<oauth refresh token>  # currently unused; reserved for #789/#822
export FILEVINE_SMOKE_PROJECT_ID=<test project>
export FILEVINE_REVIEWER_ACCOUNT_ID=<test reviewer>  # required for --write mode

python operator/connectors/filevine/bin/smoke-test-filevine.py
python operator/connectors/filevine/bin/smoke-test-filevine.py --write
```

Defaults to read-only. `--write` exercises the `create_note` mutating method; gate this behind a designated test project.

## What ships next

- [ADR 0014](../../../docs/adr/0014-pi-vertical-adapter-build-priority.md) sequences: **Filevine -> CASEpeer (v2) -> SmartAdvocate (v3)**. Both follow the same shape: one Python package per vendor, capability adapters per file, conformance tests next door.
- Real Identity & Access wiring (#789 / #822) replaces `InMemoryFilevineAuth` in production. The connector itself is untouched.
- Optional capability methods (`create_matter`, `upload_document`, `share_document_draft`, etc.) ship behind named follow-on issues when a skill actually needs them -- not speculatively.
