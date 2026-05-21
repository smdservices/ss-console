# ai-employee/

The v1 AI Employee SKU — a single product configured per customer for any vertical we sell into. Initial vertical is law-firm (personal injury); the product itself is vertical-agnostic.

## Multi-vertical doctrine

One product, many configurations. Vertical-specific content lives only in:

- `skills/` — recipes the agent runs (some are vertical-tagged, e.g. `law-pi-intake-triage`; others horizontal, e.g. `inbox-triage`)
- `connectors/` — BUILD wrappers for vendor APIs without Composio or MCP coverage (some vertical-specific, e.g. `lawpay/`)
- `fixtures/` — synthetic data per vertical, structured `fixtures/<vertical>/<sub-vertical>/<type>/`
- `customers/<slug>/customer.yaml` — per-customer configuration

Substrate components — agent runtime, voice layer, memory system, trust ceiling, dashboard, identity & access, operations, audit & compliance — are vertical-agnostic.

## 10 product components

See `docs/pm/ai-employee/product-component-inventory.md` for the canonical breakdown:

1. **Agent** — Hermes runtime per-customer Machine
2. **Skills** — recipes the agent runs
3. **Connectors** — how the agent reaches the customer's tools
4. **Voice** — how the agent communicates in the customer's writing style
5. **Memory** — what the agent knows about the customer's business
6. **Trust Ceiling** — autonomy per skill, plus calibration
7. **Dashboard** — human interface for configure / monitor / interact
8. **Identity & Access** — accounts, OAuth, role-gating, send-as identity
9. **Operations** — Captain-side infra (provisioning, fleet, cost, decommission)
10. **Audit & Compliance** — actions, evidence packets, immutability

## Directory layout

```
ai-employee/
├── README.md                       # this file
├── adapter/                        # Hermes hook surface — AIEmployee.register()
├── safety-substrate/               # citation refusal, fabrication filter, adversarial tests
├── skills/                         # canonical SKILL.md library
├── connectors/                     # BUILD wrappers (Tier-1 vendor integrations)
├── templates/                      # Dockerfile, fly.toml.template, bootstrap.sh
├── bin/                            # provision-customer.sh, pause-customer.sh, rollback-skill.sh
├── fixtures/                       # synthetic data per vertical
│   └── law-firm/
│       └── pi/
│           └── matters/
├── grading/                        # per-skill / per-customer test result tracking
└── customers/<slug>/
    └── customer.yaml               # per-customer config (skills enabled, connectors, trust ceiling)
```

## Provisioning a customer

```bash
ai-employee/bin/provision-customer.sh <slug>
```

Given a populated `customers/<slug>/customer.yaml`, the script:

1. Creates the Fly app (`hermes-<slug>`)
2. Provisions persistent volume for state
3. Sets per-customer Fly secrets (Anthropic, AgentMail, Composio credentials)
4. Deploys the Hermes image with the customer's enabled skills and connectors
5. Smoke-tests the agent loop

## Customer config

`customer.yaml` is the single source of truth for one customer. Formal schema: `docs/specs/ai-employee/customer-yaml-schema.md`. Never contains literal secret values.

## Trust ceiling

Enforced in code via the `adapter/`'s integration with Hermes' tool dispatch. Per-skill ceiling lives in `SKILL.md` frontmatter; per-customer overrides live in `customer.yaml`. Customer-level overrides win.

Ceiling values: `autonomous` (executes), `draft_for_review` (writes to drafts queue + notifies), `refused` (returns error, logs attempt).

See `docs/specs/ai-employee/dashboard-roles.md` for the role/ceiling matrix.

## Where to look next

- PRDs: `docs/pm/ai-employee/platform-prd.md`, `docs/pm/ai-employee/law-firm-prd.md`
- Component inventory: `docs/pm/ai-employee/product-component-inventory.md`
- Specs: `docs/specs/ai-employee/` (capability contracts, schemas, OAuth, telemetry, decommission)
- ADRs: `docs/adr/0004-productized-ai-employee-offering.md` and follow-ons
- Strategy: `docs/strategy/ai-employee-stack-evaluation-2026-05-13.md`, `ai-employee-pricing-2026-05-13.md`, `ai-employee-service-contract-2026-05-13.md`
