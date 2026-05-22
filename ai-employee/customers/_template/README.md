# `_template/` -- customer config scaffold

This directory is the canonical starting point for a new customer's per-firm config. It is never a real customer slug; the leading underscore reserves the name. Production tooling (`bin/provision-customer.sh`, `bin/prepare-demo-firm.sh`, `bin/decommission-customer.sh`) skips any directory whose name starts with `_`.

## Files

| File            | Purpose                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `dossier.md`    | Firm research template. One section per pre-meeting requirement from Platform PRD §16.2. Bracketed fields are pre-meeting blockers.         |
| `customer.yaml` | Per-customer configuration template. Validates against `docs/specs/ai-employee/customer-yaml-schema.md` once bracketed values are replaced. |

## Usage

1. Identify the firm with Captain (see `docs/runbooks/pi-firm-demo-prep.md` §1).
2. Pick a slug matching `^[a-z0-9][a-z0-9-]{0,31}$`. Convention: `{first-name}-{last-name}-{firm-suffix}` for solo / small firms, `{firm-shortname}` for established brands.
3. Copy the scaffold:

   ```bash
   cp -r ai-employee/customers/_template ai-employee/customers/{firm-slug}
   ```

4. Replace every bracketed field in `dossier.md` per the runbook sections.
5. Replace every bracketed field in `customer.yaml`. Validate:

   ```bash
   uv run --quiet --with pyyaml python3 \
     ai-employee/adapter/validate_customer_yaml.py \
     ai-employee/customers/{firm-slug}/customer.yaml \
     --skills-dir ai-employee/skills \
     --connectors-dir ai-employee/connectors \
     --fixtures-dir ai-employee/fixtures
   ```

6. Provision the Machine with `ai-employee/bin/provision-customer.sh {firm-slug}`.
7. Verify the demo prep with `ai-employee/bin/prepare-demo-firm.sh --firm-slug {firm-slug}`.

## Voice samples

Voice samples live in R2 under `vaults/{firm-slug}/voice/samples/`, not in this directory. The pipeline stores structural-diffs, not raw text. See `docs/specs/ai-employee/voice-ingestion.md`. The provisioning script does not move voice samples on its own; Captain ingests them per the runbook.

## What does NOT belong here

- Real partner names, client names, settlement amounts under seal, or any privileged material. Use only public-record citations.
- Anthropic / Composio / AgentMail / Fly API keys. Secrets go through `fly secrets import` via `provision-customer.sh` and never appear in any file in this directory.
- Raw email bodies or voice samples. Voice ingestion stores structural-diffs only; raw text is discarded at ingestion time.

## Reserved-slug guarantee

Any directory whose name starts with `_` is treated as a template scaffold and ignored by all provisioning / decommissioning / preparation tooling. This is enforced in:

- `ai-employee/bin/lib/demo_prep.py::is_template_slug`
- `ai-employee/bin/prepare-demo-firm.sh` (refuses `--firm-slug _*`)

If a real firm slug ever needs to start with an underscore, change the prefix; do not weaken the reservation.
