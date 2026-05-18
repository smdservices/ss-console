# ai-employee/

SMD's productized AI Employee — the per-customer Hermes deployment stack.

## What lives here

This directory is the source for every AI Employee instance we deploy, including SMD's own customer-zero. The layout is multi-tenant from day one:

```
ai-employee/
├── README.md                       # this file
├── bin/
│   └── provision-customer.sh       # one-command "stand up a new customer"
├── templates/
│   ├── Dockerfile                  # Hermes-based image, parameterized by customer
│   ├── fly.toml.template           # Fly app config, parameterized by customer
│   └── bootstrap.sh                # runtime init, runs on first machine start
├── skills/                         # canonical SKILL.md library, shared across customers
│   ├── inbox-triage/               # the seed skill
│   ├── status-report/
│   └── ...                         # 58 skills across the four active verticals
├── connectors/                     # custom MCP wrappers (Tier-1 BUILDs)
│   ├── lawpay/
│   ├── dotloop/
│   ├── fishbowl/
│   ├── shipstation/
│   ├── spark-mls/
│   ├── acumatica/
│   ├── adobe-sign/
│   └── sps-commerce/
├── fixtures/                       # synthetic test data per vertical
│   ├── law-firm/
│   ├── manufacturing/
│   ├── real-estate/
│   └── marketing-agency/
├── grading/                        # per-skill / per-customer test result tracking
│   └── matrix.md                   # live grading matrix
└── customers/
    └── smd/
        ├── customer.yaml           # SMD's config: skills enabled, connector bindings, trust ceiling
        └── skills/                 # SMD-specific skill instances (overrides if any)
```

## How a deployment happens

Provisioning a new customer is one command:

```bash
ai-employee/bin/provision-customer.sh <slug>
```

That command, given a populated `customers/<slug>/customer.yaml`:

1. `fly apps create hermes-<slug>` — creates the Fly app
2. `fly volumes create hermes_state --size 1` — persistent volume for SQLite + per-customer markdown vault
3. `fly secrets set ANTHROPIC_API_KEY=… AGENTMAIL_API_KEY=… COMPOSIO_API_KEY=…` — wires the customer's credentials
4. `fly deploy` — pushes the Hermes image with the customer's skill set baked in
5. Sanity-checks: `fly status`, then SSH in and verify the agent loop reaches one tool round-trip

The same command works for SMD (customer-zero) and for every paying customer that follows.

## customer.yaml — the config schema

See `customers/smd/customer.yaml` for the canonical example. Fields:

- `customer_id` — slug (e.g., `smd`, `acme-law-01`)
- `customer_name` — display name
- `vertical` — `marketing-agency` | `law-firm` | `real-estate` | `manufacturing` | `insurance`
- `model` — Anthropic model ID (default `claude-opus-4-7`)
- `fly_region` — preferred region (default `phx`)
- `machine_size` — Fly machine class (default `shared-cpu-1x`)
- `skills` — list of skill slugs to enable from `ai-employee/skills/`
- `connectors` — per-tool binding: `composio` | `mcp:<url>` | `build:<connector>` | `synthetic:<fixture>` (synthetic for SMD where real customer-side data isn't available)
- `trust_ceiling` — per-skill autonomy: `autonomous` | `draft_for_review` | `refused`
- `gateway` — primary external surface: `slack` | `email` | `sms` | `cli`
- `oauth_scopes` — manifest of what the agent will request

## Trust ceiling enforcement

Trust ceiling is enforced in code, not in prompt. The `AIEmployee` adapter inspects the skill's declared ceiling against the action being requested. `autonomous` actions execute; `draft_for_review` actions write to the customer's notes folder + emit a notification; `refused` actions return an error and log the attempt.

The matrix per skill is specified in the skill's `SKILL.md` frontmatter and per-customer override in `customer.yaml`. Customer-level wins where they conflict (a customer can raise OR lower a skill's ceiling vs. the skill's default).

## SMD is customer-zero, permanently

SMD's instance stays running as our internal AI Employee and the regression-test bed for every skill or wrapper update before it ships to paid customers. Synthetic fixtures cover the verticals SMD's own ops don't naturally exercise (law, insurance, manufacturing, parts of real estate). Real SMD data exercises marketing-agency-shaped skills.

## Connector sourcing — Composio first, MCP second, BUILD last

Per the connector-coverage research at `docs/strategy/ai-employee-connector-coverage-2026-05-14.md`:

1. **Composio** managed toolkit if it exists (most horizontal SaaS — QBO, HubSpot, Slack, Drive, Dropbox, Asana, ClickUp, Monday, GA4, NetSuite, Pipedrive, Shopify, Freshdesk, Zendesk, DocuSign, Canva, etc.)
2. **Native MCP** if the vendor or a healthy community ships one (Clio, Twilio, Float, Meta Ads, Business Central, CourtListener)
3. **BUILD** (custom MCP wrapper) for the Tier-1 list: LawPay, Dotloop, Fishbowl, ShipStation, Spark API, Acumatica, Adobe Sign, SPS Commerce
4. **BLOCKED**: Westlaw / Lexis / Casetext (legal research — partner-gated), Smokeball (partner gate), Aligned Showings (no public API), Compass / Keller Williams Command (proprietary), QuickBooks Desktop without Conductor bridge

## Cost shape per customer

Per the stack eval: ~$35-110/mo marginal cost per Hermes instance at moderate use. Plus shared overhead: Composio Standard ($29/mo amortized across customers), AgentMail Builder ($20/mo for ~10 customer inboxes), Cloudflare Workers Paid ($5/mo shared).

## Where to look next

- Stack rationale: `docs/strategy/ai-employee-stack-evaluation-2026-05-13.md`
- Per-vertical functional shape (the 58 skills): `docs/strategy/ai-employee-functional-shape-2026-05-13.md`
- Connector coverage + ship readiness by customer profile: `docs/strategy/ai-employee-connector-coverage-2026-05-14.md`
- Service contract terms: `docs/strategy/ai-employee-service-contract-2026-05-13.md`
- Pricing: `docs/strategy/ai-employee-pricing-2026-05-13.md`
- Runbook (customer onboarding playbook): `docs/runbooks/ai-employee-customer-onboarding.md`
- SOW template: `docs/templates/ai-employee-sow.md`
