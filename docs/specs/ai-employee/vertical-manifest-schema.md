# Vertical Manifest Schema

**Status:** Active — landed by ADR 0022 Stream 1.
**Governing ADR:** [`docs/adr/0022-vertical-pack-architecture.md`](../../adr/0022-vertical-pack-architecture.md).
**Related issue:** [#1091](https://github.com/venturecrane/ss-console/issues/1091) (parent), [#1111](https://github.com/venturecrane/ss-console/issues/1111) (PR 1 child).

This spec is the authoritative shape of:

- `ai-employee/verticals/<vertical-slug>/vertical.yaml`
- `ai-employee/verticals/<vertical-slug>/addons/<addon-slug>/addon.yaml`
- The `vertical:` and `addons:` fields on `customer.yaml`

It supplements (does not replace) [`customer-yaml-schema.md`](customer-yaml-schema.md), which remains the source of truth for the rest of `customer.yaml`.

## Three-layer model

Per ADR 0022 §"Decision":

1. **Platform (`ai-employee/core/`)** — same for every customer regardless of vertical. Hermes substrate, plugin overlay, capability contracts, customer.yaml schema, OAuth substrate, bootstrap CLI, trust ceiling enforcement, audit emission, voice transformation pipeline. No vertical-specific code at this layer.
2. **Vertical packs + add-on packs (`ai-employee/verticals/`)** — first-class versioned artifacts. See §"Filesystem layout" below.
3. **Customer configuration (`customer.yaml`)** — the customer subscribes to one vertical plus zero or more add-ons. See §"`customer.yaml` extension fields."

## Filesystem layout

```
ai-employee/
  verticals/
    _template/                       # reference shape — never a real vertical
      vertical.yaml
      addons/_template/addon.yaml
    law-firm/                        # NB: slugs match ACCEPTED_VERTICALS
      vertical.yaml                  # manifest for the vertical
      skills/                        # vertical-default skills
      connectors/                    # vertical-default connectors
      personas/                      # reference persona archetypes
      compliance/                    # vertical-level safety constraints
      fixtures/                      # vertical-grade test fixtures
      evals/                         # certification battery
      addons/
        pi/
          addon.yaml                 # add-on manifest
          skills/                    # add-on-specific skills
          fixtures/                  # add-on-specific synthetic data
    accounting/
      vertical.yaml
      addons/
        bookkeeping/                 # composable across verticals
```

The PI migration PR (ADR 0022 Stream 4) moves existing `law-pi-*` skills, `fixtures/law-firm/pi/`, and the PI bundles into `verticals/law-firm/addons/pi/` per this layout. Until that lands, the existing flat layout continues to work — PR 1 ships the schema only.

## `vertical.yaml` manifest fields

| Field        | Type     | Required | Notes                                                                            |
| ------------ | -------- | -------- | -------------------------------------------------------------------------------- |
| `name`       | string   | yes      | MUST match `ACCEPTED_VERTICALS` in `types.ts`                                    |
| `version`    | string   | yes      | MAJOR.MINOR.PATCH; no pre-release or build-metadata suffixes in v1               |
| `compliance` | string[] | yes      | Free-form vertical-level constraint slugs; `[]` when none                        |
| `personas`   | object[] | yes      | Reference persona archetypes (templates, not runtime personas); `[]` when none   |
| `skills`     | string[] | yes      | Vertical-default skill identifiers; `[]` when none                               |
| `connectors` | object[] | yes      | Vertical-default connector defs (capability + adapter + backend); `[]` when none |
| `templates`  | string[] | yes      | SOP / letter / email templates the pack provides; `[]` when none                 |
| `fixtures`   | string[] | yes      | Test fixture identifiers shipped with the pack; `[]` when none                   |
| `evals`      | string[] | yes      | Certification eval identifiers; `[]` when none                                   |

All list fields MUST be present. Empty lists are valid — they signal "the pack does not provide this artifact class."

## `addon.yaml` manifest fields

Identical to `vertical.yaml` except `name` MUST appear in `ACCEPTED_ADDONS[<parent-vertical>]` in `types.ts`. Add-on assets are additive on top of the parent vertical's defaults; the parent does not need to declare them.

## `extends:` is reserved (fail-closed)

The validator REJECTS any top-level `extends:` field with `ValidationErrorCode = 'ExtendsReserved'`. Industry-to-specialty inheritance is reserved for a future ADR amendment (ADR 0022 §"Flat manifest in v1, no inheritance machinery"). Silent acceptance would let authors write manifests the runtime ignores — fail-closed is mandatory.

## `customer.yaml` extension fields

### `vertical:`

Two accepted forms:

| Form               | Example                    | Notes                                                                                          |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------- |
| Bare (back-compat) | `vertical: law-firm`       | Customer not bound to a specific vertical-pack release. `vertical_version` resolves to `null`. |
| Pinned             | `vertical: law-firm@1.4.0` | Customer bound to pack version `1.4.0`. `vertical_version` resolves to `'1.4.0'`.              |

Pinned form is recommended once the pack reaches a stable release. The bare form continues to work for pre-launch customer-zero shape.

### `addons:`

Optional list of add-on pack subscriptions. Each entry is a string of the form `<vertical>/<addon>@<semver>`.

```yaml
addons:
  - law-firm/pi@2.1.0
  - accounting/bookkeeping@1.0.0 # cross-vertical composition allowed
```

**Cross-vertical composition is supported** (ADR 0022 §"Properties of the vertical model" bullet 3). The customer's `vertical:` field declares their primary pack; `addons:` may reference add-ons from any registered vertical.

Duplicate `<vertical>/<addon>` pairs are rejected. Version pinning is mandatory in v1 (a follow-on amendment may add a `floating-latest` form).

### Skill body R2 keys (PR 1 declares; PR 2 consumes)

Two optional keys live under `memory:`. Both are populated at customer bootstrap by ADR 0022 Stream 2 (skill body persistence); they are never hand-authored. PR 1 declares them as known-optional so Stream 2 can extend the substrate without amending the validator.

```yaml
memory:
  d1_namespace: '<customer-id>'
  r2_vault_path: 'vaults/<customer-id>/'
  vectorize_index: 'hermes-<customer-id>-vault'
  # ADR 0022 Stream 2 — populated at bootstrap, never hand-authored:
  r2_skill_bodies_bucket: 'smd-ai-employee-skill-bodies' # shared-bucket default
  r2_skill_bodies_prefix: '<customer-id>/' # shared-bucket prefix
```

When the bucket model is shared-bucket-plus-prefix (Captain default per the approved plan), `r2_skill_bodies_bucket` is the shared bucket name and `r2_skill_bodies_prefix` is the customer's key prefix. When Captain reconfirms per-customer-bucket, `r2_skill_bodies_bucket` is the per-customer bucket name and `r2_skill_bodies_prefix` is the empty string.

Both fields are validated as optional non-empty strings. Empty string is rejected (catches authoring typos from bootstrap going wrong).

## Validator surface

| Function               | Module                 | Returns                                                   |
| ---------------------- | ---------------------- | --------------------------------------------------------- |
| `checkVerticalPinned`  | `sections-vertical.ts` | `{ vertical: Vertical \| null, version: string \| null }` |
| `checkAddons`          | `sections-addons.ts`   | `AddonSpec[]` (empty when omitted)                        |
| `checkExtendsReserved` | `sections-vertical.ts` | `void` (pushes `ExtendsReserved` error when present)      |

Validator errors specific to this spec:

| Code                  | When                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| `InvalidVerticalSpec` | `vertical:` pinned form is malformed (missing `@`, bad semver)                     |
| `InvalidAddonSpec`    | `addons[]` entry is malformed (missing `/`, missing `@`, bad semver, or duplicate) |
| `UnknownAddon`        | `addons[]` entry references an addon slug not in `ACCEPTED_ADDONS[<vertical>]`     |
| `ExtendsReserved`     | Top-level `extends:` field is present                                              |
| `EnumViolation`       | `vertical:` or addon entry references an unknown vertical slug                     |

## Out of scope (per ADR 0022)

- **Industry-to-specialty inheritance.** `extends:` is reserved syntactically and rejected by the validator. Implementation deferred until at least two specialties under the same industry exist and share substantial assets.
- **Customer-authored vertical packs.** Not a product feature at any tier.
- **Marketing-grade vertical metadata.** Verticals are internal-only; no customer-facing names, descriptions, tier labels, or SKU mapping in the manifest.
- **Manifest cross-validation** (e.g. `law/pi` requires `PracticeManagement` connector that the composed customer must have). Belongs in the overlay-side bootstrap CLI (ADR 0019), not the portal validator. Follow-on against #1091.
- **Bootstrap CLI changes.** The overlay-side `hermes-smd bootstrap` CLI will consume the new fields when its next release ships. PR 1 is portal-validator-only.

## References

- ADR 0022 — Vertical Pack Architecture and Time-Machine Substrate
- ADR 0019 — customer.yaml → per-profile config translation (bootstrap CLI extends here)
- ADR 0020 — Connector strategy (vertical-pack connectors follow MCP-first rule)
- [`customer-yaml-schema.md`](customer-yaml-schema.md) — the rest of `customer.yaml`
