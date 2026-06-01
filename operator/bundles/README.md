# Skill Bundles Catalog

Three reference bundle definitions for the SMD Operator. Each catalog
entry combines two or more skills under a single slash command so a
common multi-step workflow becomes one user-facing invocation.

| Bundle                     | Slash command          | Skills                                                  | Vertical         |
| -------------------------- | ---------------------- | ------------------------------------------------------- | ---------------- |
| `pi-intake.yaml`           | `/pi-intake`           | `intake-triage` + `law-conflict-check`                  | law-firm-pi      |
| `pi-matter-prep.yaml`      | `/pi-matter-prep`      | `demand-letter-draft` + `settlement-prep`               | law-firm-pi      |
| `weekly-client-pulse.yaml` | `/weekly-client-pulse` | `status-report-assembler` + `retainer-hours-reconciler` | marketing-agency |

## How bundles flow from catalog to runtime

The catalog is a reference. Bundles only activate for a customer when
their `customer.yaml.personas[<n>].bundles[]` block declares one — the
catalog file isn't loaded directly at boot.

```
operator/bundles/<slug>.yaml          (this catalog — reference shape)
                  ↓ author copies from
customer.yaml personas[<n>].bundles[]    (per-customer customer.yaml)
                  ↓ validator enforces skills[] match enabled skills
                  ↓ `hermes-smd bootstrap` (overlay-repo) reads at Machine boot
~/.hermes/skill-bundles/<slug>.yaml      (Hermes-native bundle file, per profile)
                  ↓ Hermes loads
                  ↓ `/<slug>` invocation triggers each skill listed
```

The translation step (customer.yaml → per-profile bundle YAML) lives in
`venturecrane/hermes-smd-overlay` per ADR 0021 Wave 3 (Overlay-3). It is
NOT in this repo.

## Catalog entry shape

Each catalog file matches the customer.yaml `personas[].bundles[]` schema:

```yaml
slug: <kebab-case identifier, matches SLUG_PATTERN>
description: <one-line summary, max 200 chars>
skills:
  - <skill-name-1>
  - <skill-name-2>
instruction: |
  <Optional shared context prepended to every bundled skill invocation.
   See the Hermes-native `instruction:` field. Carry intent that
   applies across all skills in the bundle; per-skill rules stay in the
   individual SKILL.md files.>
```

The schema is canonical in
[`docs/specs/operator/customer-yaml-schema.md`](../../docs/specs/operator/customer-yaml-schema.md)
(see "Skill bundles (ADR 0021 Stream D)").

## Adding a new bundle to the catalog

1. Identify the multi-step workflow that fires often enough to deserve
   a slash command. A workflow that fires once a quarter is probably
   not worth a bundle.
2. Confirm both (or more) skills already exist in
   `operator/skills/<skill-name>/`.
3. Author the catalog file at `operator/bundles/<slug>.yaml` matching
   the schema above.
4. Update this README's catalog table.
5. Customers that want the bundle then copy the block into their
   `customer.yaml.personas[<n>].bundles[]` and ensure the skills are
   listed in the same persona's `skills[]` with `enabled: true`.

## What the catalog is NOT

- **Not a registry.** Hermes doesn't load this directory. The customer.yaml
  block is the source of truth at runtime.
- **Not a sandbox.** Bundles in `customer.yaml.personas[].bundles[]` may
  cite skills NOT in this catalog — the catalog is a curation of
  reference combinations, not the limit of what can be bundled.
- **Not multi-tenant.** Each customer Machine reads its own
  `customer.yaml`. The catalog has no tenant context.

## ADR references

- [ADR 0021](../../docs/adr/0021-leverage-hermes-native-primitives.md)
  Stream D — Skill bundles for multi-step workflows.
- [ADR 0017](../../docs/adr/0017-skill-curator-disposition.md) — Hermes-
  native skill management surface (`skill_manage`).
- [ADR 0005](../../docs/adr/0005-reviewer-as-sender.md) — Email drafts
  land in the partner's drafts folder; no agent send path.
