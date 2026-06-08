# No-PM-System Mode

**Spec for issue [#853](https://github.com/venturecrane/ss-console/issues/853).** The "no practice-management system" capability binding set -- a `customer.yaml` template + capability-adapter configuration that runs the onboarding flow for customers without an external PM vendor (Filevine, Clio, CASEpeer, SmartAdvocate, etc.).

## Source

- **Business-analyst finding.** The most common state at the target-buyer profile is no working PM system at all -- paper + Outlook + Dropbox + PracticeMaster for billing, or Clio bought-but-unused. The platform PRD and law-firm PRD assume Filevine/Clio; reality differs.
- **Capability-adapter pattern.** [ADR 0006](../../adr/0006-capability-adapter-pattern.md) -- skills bind to capability interfaces, not vendors. The no-PM-system mode is implemented by swapping the `PracticeManagement` adapter, not by rewriting skills.
- **Customer-owned memory artifact.** [ADR 0008](../../adr/0008-customer-owned-memory-artifact.md) -- every artifact the synthetic store persists is per-customer and drains on decommission, the same as memory ingestion artifacts from PR #944.

## What this spec covers

- The default capability-binding set for a no-PM-system customer.
- The `no_pm` PracticeManagement adapter and its synthetic matter store.
- The flow scene-by-scene: how each surface that the dry-run #889 expects works without an external PM vendor.

## What this spec does not cover

- The vendor adapters this template binds to outside `PracticeManagement` (Microsoft Graph, DocuSign, QuickBooks, OneDrive). Each ships under its own adapter-build issue and follows the same shape Filevine does. This spec assumes those adapters exist or are clearly named TBD; the template references them by capability slug.
- The per-customer D1 schema for the synthetic store tables (`no_pm_matters`, `no_pm_matter_notes`). The schema follow-on lands against the same issue once Captain approves this spec.
- Switching a customer from `no_pm` to a real vendor mid-engagement. Per ADR 0006 that is a `customer.yaml` edit; the migration runbook is a separate spec.

## Stack assumption

The target-buyer reality the no-PM-system template assumes:

| Capability         | Adapter slug      | Vendor / source                         |
| ------------------ | ----------------- | --------------------------------------- |
| PracticeManagement | `no_pm`           | synthetic store -- per-customer D1 + R2 |
| Email              | `microsoft_graph` | Microsoft Graph (Outlook)               |
| Calendar           | `microsoft_graph` | Microsoft Graph (Outlook calendar)      |
| DocumentStorage    | `onedrive`        | Microsoft Graph drive API               |
| ESign              | `docusign`        | DocuSign                                |
| Accounting         | `quickbooks`      | QuickBooks Online                       |

If a specific firm uses Xero instead of QuickBooks, or Gmail instead of Outlook, the assessment-call flow swaps the binding in their `customer.yaml`. The skill catalog runs unchanged either way.

## The `no_pm` PracticeManagement adapter

Implementation: [`operator/connectors/no_pm/`](../../../operator/connectors/no_pm/). Conforms to the `PracticeManagement` interface from [`src/lib/operator/capabilities/practice-management.ts`](../../../src/lib/operator/capabilities/practice-management.ts) via the same Python-mirrors-TypeScript shape Filevine uses.

### Supported methods

| Method                  | Behavior                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `describe_capabilities` | Returns capability + supported / unsupported method declarations and per-method `field_coverage` (with `id` + `opened_at` disclosed as derived on `create_matter`) |
| `health_check`          | Pings the underlying `MatterStore` -- healthy when the store responds                                                                                              |
| `search_matters`        | Filters by `client_name` (substring), `matter_type` (exact), `status` (enum); paginates by `limit` / `offset`                                                      |
| `get_matter`            | Returns the matter row or `null` (per NULL_FOR_ABSENT); raises `validation_failed` on empty id                                                                     |
| `create_matter`         | Persists a new matter; synthesizes `mat_<hex>` id and ISO `opened_at` when omitted; defaults `status` to `"open"`                                                  |
| `update_matter`         | Merges `custom_fields`; auto-records `closed_at` from server clock when status flips to `"closed"`; `not_found` if id is unknown                                   |
| `list_matter_documents` | Returns the matter's per-customer R2 document index entries in insertion order                                                                                     |
| `create_note`           | Records a reviewer-attributed note per [ADR 0005](../../adr/0005-reviewer-as-sender.md); `drafted_by_skill` rides on the row for the dashboard sourcing block      |

### Unsupported methods (raise `capability_not_supported`)

| Method                                             | Why                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_contacts`, `get_contact`, `create_contact` | The customer keeps contacts in Outlook. Skills that need contacts bind to the `IntakeCRM` capability (or read the Outlook contacts surface via `Email`).      |
| `list_time_entries`, `create_time_entry_draft`     | The customer keeps time + billing in QuickBooks. Skills that need billing bind to the `Accounting` capability.                                                |
| `upload_matter_document`                           | The synthetic store does not own document bytes. Skills upload to OneDrive via the `DocumentStorage` capability and reference the file by R2 / OneDrive path. |

There are no silent stubs. Every unsupported method raises `AdapterError(code="capability_not_supported")` with a message that points at the capability the caller should bind to instead.

### Storage seam

The adapter binds to a `MatterStore` Protocol that abstracts persistence:

- **Tests + local dev:** `InMemoryMatterStore` -- dict-backed reference implementation. The conformance + capability tests use this directly; `NoPmPracticeManagement()` with no args defaults to it so the boot-time conformance harness boots cleanly.
- **Production (planned):** `D1MatterStore` -- backed by per-customer D1 tables `no_pm_matters` and `no_pm_matter_notes`. Documents live in the per-customer R2 vault at `vaults/{customer_id}/no_pm/matters/{matter_id}/documents/` (same naming convention the memory pipeline already uses per [`r2-vectorize-naming.md`](r2-vectorize-naming.md)). The store records the R2 key in the matter document index; `list_matter_documents` reads against that index. Per [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md), no tenant id is ever passed in -- isolation is structural via the per-Machine binding.

## Demo flow

How each scene from the dry-run [#889](https://github.com/venturecrane/ss-console/issues/889) plays through the no-PM-system stack. The scenes are pulled from the dashboard tab layout the Captain dashboard renders today.

### Scene 1: Drafts list shows real drafts written from real Outlook emails

| Component      | Binding                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inbound        | `Email.list_threads()` -> Microsoft Graph -> Outlook Inbox. The agent reads incoming threads.                                                                                                                                                                                                                                                    |
| Reasoning      | Persona skill runs against the thread + relevant matter context (read from the synthetic store via `get_matter` if the thread is linked to a matter).                                                                                                                                                                                            |
| Outbound       | `Email.create_draft()` -> Microsoft Graph -> reviewer's Outlook Drafts folder, under the **authored** reviewer-as-sender posture ([ADR 0005](../../adr/0005-reviewer-as-sender.md), one option). Under an authored autonomous `EXTERNAL_SEND` ceiling the agent sends directly; the modality is configured per engagement (ADR 0035), not fixed. |
| Sourcing block | Dashboard renders "what the Operator used to write this" by reading `field_coverage` from each adapter the skill touched, including the no_pm adapter when matter context was used.                                                                                                                                                              |

No `no_pm` write happens in this scene -- the synthetic store is read-only for draft creation. The drafts list is the same surface a Filevine customer sees.

### Scene 2: Matters tab shows synthetic matters created locally

| Component | Binding                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read      | `PracticeManagement.search_matters()` -> `NoPmPracticeManagement` -> the customer's D1 `no_pm_matters` table.                                          |
| Create    | Operator clicks "New matter" -> dashboard calls `PracticeManagement.create_matter()` -> the synthetic store persists the row.                          |
| Detail    | `PracticeManagement.get_matter()` + `list_matter_documents()` populate the matter detail view. Documents are listed from the per-customer R2 vault.    |
| Update    | Status changes (close, intake -> open) hit `PracticeManagement.update_matter()`; `closed_at` is set from the server clock when status flips to closed. |

A Filevine customer's matters tab calls the same capability methods against `FilevinePracticeManagement` -- skills and dashboard code are untouched. The only difference is the adapter binding.

### Scene 3: Calendar tab shows real Outlook events

| Component | Binding                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------ |
| Read      | `Calendar.list_events()` -> Microsoft Graph -> Outlook calendar. Same auth as the Email binding. |
| Draft     | `Calendar.create_invitation_draft()` -> Microsoft Graph -> reviewer's draft event surface.       |

No `no_pm` involvement -- calendar is its own capability and the binding is real. Matter context for calendar events is read from the synthetic store when relevant (e.g. "deposition for Smith matter, opened 2026-01-15" is enriched from `get_matter`).

### Scene 4: Documents tab shows OneDrive folders + matter-attached files

| Component          | Binding                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browse             | `DocumentStorage.list_folder()` -> OneDrive (Microsoft Graph drive API). Renders the customer's actual OneDrive folder tree.                                                                            |
| Per-matter listing | `PracticeManagement.list_matter_documents()` -> the synthetic store's per-matter index. Documents linked to a matter are returned here, with the OneDrive / R2 path.                                    |
| Upload             | `DocumentStorage.upload_document()` -> OneDrive. The synthetic store records the resulting OneDrive path in the matter document index (operator action wires this -- the adapter does not auto-attach). |

The per-matter view and the global folder view both work; they are two different capability bindings serving two different surfaces.

### Scene 5: Signatures tab shows DocuSign envelopes + status

| Component | Binding                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read      | `ESign.list_envelopes()` -> DocuSign API. Status (sent / delivered / partial_signed / completed) renders in the dashboard.                               |
| Draft     | `ESign.create_reminder_draft()` -> reviewer's Outlook Drafts folder via the `Email` capability. Per ADR 0005, the agent does not chase signers directly. |
| Match     | The dashboard cross-references envelope `matter_ref` against the synthetic store's matter ids when possible. When not, the envelope renders standalone.  |

### Scene 6: Billing tab shows QuickBooks invoices + AR

| Component  | Binding                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Read       | `Accounting.list_invoices()` -> QuickBooks Online API.                                                                     |
| Draft      | `Accounting.create_invoice_draft()` -> QuickBooks draft surface. Per ADR 0005 + invariant #3, the agent never posts to GL. |
| Per-matter | The dashboard cross-references invoice `matter_ref` against the synthetic store's matter ids.                              |

## Validation

The template is validated by the same runtime validator every `customer.yaml` runs through (`src/lib/operator/customer-yaml/validator.ts`). The bracketed-fields shape means an unedited template fails validation -- the customer slug pattern, infisical token_ref pattern, and memory invariants will all reject the placeholder values. This is intentional: the validator forces the operator to fill in real values before provisioning.

To validate after copying + filling (canonical TS validator per ADR 0019):

```bash
npx tsx scripts/validate-customer-yaml.ts \
  operator/customers/{firm-slug}/customer.yaml
```

## Failure modes

| Condition                                                                                             | Adapter behavior                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caller invokes an unsupported method                                                                  | `AdapterError(code="capability_not_supported")` with message pointing at the right capability binding                                                                                                   |
| `search_matters` with unknown status                                                                  | `AdapterError(code="validation_failed")` listing the valid status enum                                                                                                                                  |
| `get_matter` with unknown id                                                                          | Returns `null` (NULL_FOR_ABSENT)                                                                                                                                                                        |
| `update_matter` / `create_note` with unknown matter id                                                | `AdapterError(code="not_found")`                                                                                                                                                                        |
| `create_matter` with duplicate id                                                                     | `AdapterError(code="validation_failed")` (the store rejects; the adapter translates)                                                                                                                    |
| Underlying `MatterStore` raises                                                                       | `health_check` returns `"unhealthy"`; reads bubble the error wrapped in `AdapterError(code="unknown", cause=exc)`                                                                                       |
| Caller invokes an out-of-scope method (`send`, `publish`, `share_externally`, ...) on this PM adapter | Test `test_adapter_has_no_banned_method_names` asserts none exist — this no-PM adapter exposes no send/publish surface (send, where a connector has it, is ceiling-gated at runtime, not method-banned) |

## Verification

### Adapter tests

`operator/connectors/no_pm/tests/` -- run via:

```bash
cd operator && python -m pytest connectors/no_pm/tests/ -v
```

Coverage:

| File                         | Asserts                                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/test_errors.py`       | AdapterError code + capability union pinned against the TypeScript contract                                                                                                  |
| `tests/test_store.py`        | `InMemoryMatterStore` honors the `MatterStore` protocol (list / get / create / update / docs / notes); status enum enforced                                                  |
| `tests/test_capabilities.py` | `NoPmPracticeManagement` happy paths; unsupported-method behavior; ADR 0005 attribution; no banned method names; end-to-end flow exercises the create -> note -> close cycle |

### Template

The template at [`operator/templates/customer-no-pm-system.yaml`](../../../operator/templates/customer-no-pm-system.yaml) is the wire shape an operator copies into `operator/customers/{firm-slug}/customer.yaml`. The bracketed fields force the operator to fill in real values before the validator passes; the connector bindings ship pre-wired so the operator never has to hand-author them.

## Cross-references

- [`customer-yaml-schema.md`](customer-yaml-schema.md) -- the schema this template instantiates
- [`r2-vectorize-naming.md`](r2-vectorize-naming.md) -- the per-customer R2 path convention the synthetic store reuses
- [`memory-ingestion.md`](memory-ingestion.md) -- the memory pipeline whose substrate the no_pm store rides on
- [ADR 0005](../../adr/0005-reviewer-as-sender.md) -- reviewer-as-sender (the `create_note` attribution rule)
- [ADR 0006](../../adr/0006-capability-adapter-pattern.md) -- capability-adapter pattern (why this adapter swap works without skill rewrites)
- [ADR 0007](../../adr/0007-per-customer-machine-isolation.md) -- per-customer Machine isolation (the deployment boundary the synthetic store inherits)
- [ADR 0008](../../adr/0008-customer-owned-memory-artifact.md) -- customer-owned memory artifact (decommission drains the synthetic store like any other per-customer artifact)
- [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md) -- cross-Machine query prohibition (the isolation invariant the synthetic store relies on)
- [`operator/connectors/no_pm/README.md`](../../../operator/connectors/no_pm/README.md) -- adapter implementation notes
- [`operator/connectors/filevine/README.md`](../../../operator/connectors/filevine/README.md) -- the real-PM-vendor analogue
