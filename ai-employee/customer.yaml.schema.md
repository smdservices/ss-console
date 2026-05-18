# customer.yaml — schema

Every AI Employee customer (including SMD's permanent customer-zero) has a `customer.yaml` at `ai-employee/customers/<slug>/customer.yaml`. It's the single source of truth for:

- Which skills are enabled and at which content-hash version
- Which connector backends are bound to each skill's tool dependencies
- The trust ceiling per skill (overrides the skill's authored default if needed)
- Gateway choice and OAuth scopes
- Machine sizing and Fly region

`provision-customer.sh <slug>` reads this file, renders `fly.toml`, builds the container with the right skills + connectors baked in, sets secrets, and deploys.

## Top-level fields

```yaml
customer_id: smd # slug; lowercase, hyphenated; matches the dir name
customer_name: "SMD Services" # display only
vertical: marketing-agency # one of: marketing-agency | law-firm | real-estate | manufacturing | insurance | mixed
model: claude-opus-4-7 # Anthropic model ID; agent uses for every model call
fly_region: phx # Fly.io region; phx for Phoenix
machine:
  size: shared-cpu-1x # Fly VM class
  memory_mb: 1024
hermes_ref: v2026.5.7 # Hermes git ref pinned for this customer (date-based tag); controlled bump per customer
gateway: cli # for customer-zero / SSH-only; paying customers: slack | email | sms
oauth_scopes: # Google scopes the customer has approved via OAuth flow
  - https://www.googleapis.com/auth/gmail.readonly
  - https://www.googleapis.com/auth/gmail.send
  - https://www.googleapis.com/auth/calendar
```

## Skills section

Each skill enabled for this customer pins a content-hash version. `provision-customer.sh` verifies the hash exists in `ai-employee/skills/<skill_name>/` before deploying.

```yaml
skills:
  - name: inbox-triage
    version: 7c8e9f # first 6 chars of content hash; uniquely identifies the SKILL.md + references state
    trust_ceiling: draft_for_review # autonomous | draft_for_review | refused — per the rubric
    enabled: true
    # Per-skill cost-estimate (filled in by the grading pass; used for cost-per-customer rollup)
    cost_estimate:
      tokens_in_per_run: 8000
      tokens_out_per_run: 1500
      tool_calls_per_run: 6
      runs_per_day_typical: 5

  - name: ar-chaser
    version: pending # set after the skill is authored + content-hashed
    trust_ceiling: draft_for_review
    enabled: false # not yet ready for this customer
```

## Connectors section

Per the connector-coverage doc, each skill's tool dependencies resolve to one of:

- `composio:<toolkit>` — Composio managed/unmanaged toolkit (no custom code)
- `mcp:<server-url>` — native MCP server (vendor-official or community)
- `build:<wrapper-name>` — our Tier-1 custom MCP wrapper from `ai-employee/connectors/<name>/`
- `synthetic:<fixture-set>` — for customer-zero where we don't have the live tool

Each connector entry sets `enabled: true|false` for the feature-flag pattern (instant disable if a wrapper regresses).

```yaml
connectors:
  gmail:
    backend: composio:gmail
    enabled: true
    scopes: [gmail.readonly, gmail.send] # mirrored against oauth_scopes
  slack:
    backend: composio:slack
    enabled: false # customer-zero is CLI-only at boot; flip on when ready
  hubspot:
    backend: composio:hubspot
    enabled: false
  lawpay:
    backend: build:lawpay # Tier-1 wrapper
    enabled: false # SMD doesn't use LawPay; left here as schema example
  clio:
    backend: mcp:https://github.com/oktopeak/clio-mcp # community MCP
    enabled: false
  # For customer-zero, some skills are bound to synthetic fixtures rather
  # than real tools (because SMD doesn't have, e.g., a Clio matter database):
  filevine:
    backend: synthetic:fixtures/law-firm/filevine-cases.json
    enabled: false # Track 2 only
```

## Trust ceiling overrides

A skill's authored ceiling lives in its `SKILL.md` frontmatter (e.g., `trust_ceiling: autonomous`). The `customer.yaml` entry can OVERRIDE that to be MORE conservative (e.g., force `draft_for_review` even though the skill is authored as `autonomous`).

Per the runbook, every new paying customer's first 10 business days are shadow-mode: all skills forced to `draft_for_review` regardless of authored default. The provision script sets this automatically for paying customers; customer-zero (SMD) inherits authored defaults.

**The customer.yaml ceiling cannot RAISE a skill's authored ceiling.** A skill authored as `draft_for_review` cannot be promoted to `autonomous` via customer.yaml — that requires re-authoring the SKILL.md (with a new content hash). This prevents accidental escalation per-customer.

## Pause / kill-switch

```yaml
pause:
  active: false # set true to halt agent execution; bootstrap.sh exits if true
  reason: ""    # human-readable; surfaces in fly logs
```

`bin/pause-customer.sh <slug> --reason "<text>"` flips `pause.active: true` and redeploys (or writes the sentinel directly via SSH). `bin/unpause-customer.sh <slug>` reverses.

## Logging / observability

```yaml
logging:
  level: info # debug | info | warn | error
  ship_to:
    - cloudflare-d1  # mirror agent events into our admin Worker for cross-customer dashboard
    - fly-logs       # default Fly log surface
```

## Example: SMD's customer-zero config

See `ai-employee/customers/smd/customer.yaml` for the canonical example. It enables the seven marketing-agency-shaped skills SMD's own ops exercise, binds them to Composio where available and synthetic fixtures for skills that depend on customer-specific data SMD doesn't have.

## Validation

`provision-customer.sh` validates a customer.yaml before deploying:

1. All required top-level fields present
2. `vertical` is one of the accepted values
3. Every `skills[].name` exists in `ai-employee/skills/`
4. Every `skills[].version` matches the actual content hash of that skill's files (unless `version: pending`)
5. Every `connectors[].backend` references a real toolkit / MCP URL / wrapper / fixture
6. `trust_ceiling` overrides cannot raise above the authored ceiling
7. OAuth scopes declared cover what enabled connectors require

Validation failures abort the deploy with a precise error. No partial deploys.
