# ai-employee/templates

Templates an operator copies during provisioning. Each file is read once at provision time and never imported by runtime code -- runtime configuration lives under `ai-employee/customers/{firm-slug}/`.

## Runtime templates

| File                | Used by                       | Purpose                                                              |
| ------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `Dockerfile`        | `bin/provision-customer.sh`   | Hermes Machine image; per-customer Fly app builds from this          |
| `fly.toml.template` | `bin/provision-customer.sh`   | Fly app config; placeholders resolved per-customer at provision time |
| `bootstrap.sh`      | Per-customer Fly Machine boot | First-run substrate setup inside the Machine                         |

## Customer.yaml templates

Two starter templates for the most common buyer states. Each is copied into `ai-employee/customers/{firm-slug}/customer.yaml`, then the bracketed values are filled in. The reserved `_template` directory is never a real customer slug.

| File                                                                           | When to use                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`../customers/_template/customer.yaml`](../customers/_template/customer.yaml) | The fully bracketed default. Use when the customer's capability bindings are not yet known -- the assessment call fills them in.                                                                                             |
| [`customer-no-pm-system.yaml`](customer-no-pm-system.yaml)                     | The customer has no working practice-management system (paper + Outlook + OneDrive + QuickBooks for billing). Ships with `no_pm` PracticeManagement + Microsoft Graph + DocuSign + QuickBooks + OneDrive bindings pre-wired. |

Both pass through the same validator (`src/lib/ai-employee/customer-yaml/validator.ts`); the bracketed-field shape rejects an unedited template at validation time, forcing the operator to substitute real values before provisioning.

### no-PM-system mode

The most common state at the target-buyer profile is no working PM system at all. The `customer-no-pm-system.yaml` template is the matching capability binding set -- see the spec at [`docs/specs/ai-employee/no-pm-system-mode.md`](../../docs/specs/ai-employee/no-pm-system-mode.md) for the scene-by-scene demo flow and the `no_pm` adapter README at [`../connectors/no_pm/README.md`](../connectors/no_pm/README.md) for the synthetic matter store. Issue [#853](https://github.com/venturecrane/ss-console/issues/853).
