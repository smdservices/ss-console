# Operator Portal Management — Foundations

**Status:** Draft for Captain review (2026-06-08). The shared spine for two build-ready portal designs:
[`01-admin-portal.md`](01-admin-portal.md) (SMD fleet + per-operator console) and
[`02-client-portal.md`](02-client-portal.md) (client-facing operator management). Read this first; the two
portal docs assume every model and contract defined here.

These designs are handed to two dev teams building in parallel. This doc is the contract between them: anything
both portals touch — the data substrate, the access model, the multi-operator model — is defined here once.

---

## 1. Scope and the three documents

We are designing how an **Operator** (the productized AI-employee SKU, [ADR 0004](../../adr/0004-productized-operator-offering.md))
is **configured, monitored, and managed** from each portal:

- **Admin** (`admin.smd.services`) — SMD's side. Operating a _fleet_ of operators across many clients, and drilling
  into any single one. Today this surface is two read-only pages (`/admin/operator/costs`, `/admin/operator/config-history`);
  everything else here is greenfield.
- **Client** (`portal.smd.services/products/operator/*`) — the client's side. Managing the operator(s) in _their_
  organization. Substantial scaffolding exists; most of it renders honest empty states pending the runtime read path (§6).

Out of scope: the Hermes runtime internals, the connector adapters, and the consulting-engagement portal surfaces
(quotes/invoices/SOWs) — those are separate and already built.

### Design posture: clean slate

We design these portals from first principles. **Nothing in the existing portal/UX layer is treated as a
constraint** — not the built `/portal/products/operator/*` pages, not the dashboard tab IA in
[dashboard-roles.md](../../specs/operator/dashboard-roles.md), not the "Pattern A / reviewer-as-sender" framing in the
runtime specs. Those are reference material and a parts bin: we reuse a component only where it is genuinely right and
does not compromise the design, and otherwise ignore it. We do not bend the design to fit a possibly-misguided artifact.

What **is** real and built upon is the **locked architecture** — the decisions you accepted as ADRs: per-customer Fly
Machine isolation (0007/0009), persona = Hermes profile (0011), `customer.yaml` as git source of truth (0012),
OAuth-on-volume (0010/0036), no imposed entitlement defaults (0035), the Operator thesis (0037). Those define the system
the portals manage. Where an existing _data_ contract simply describes what data exists (the `customer_configs`
projection, the per-customer D1 tables), we use it as a map of what is available to surface — while designing the
surface itself fresh.

---

## 2. The three composition layers (read this before anything else)

Access to any operator capability is the **intersection of three independent layers** plus the SMD-internal layer.
Conflating them is the single most common way this gets designed wrong. They are orthogonal:

| Layer                       | Question it answers                                                          | Who sets it                                        | Where it lives                                                                                                                               | Status                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. SMD-internal access**  | Which SMD _staff_ may do what across the fleet                               | SMD                                                | admin RBAC (today: Captain-only)                                                                                                             | exists, coarse                                                                                                                                          |
| **1. Authority posture**    | For a given client, may the **client org** operate this domain, or only SMD? | SMD (per client, per domain)                       | new `authority` block → `customer_configs`                                                                                                   | **net-new (this design)**                                                                                                                               |
| **2. Client-internal RBAC** | Among the client's _own people_, who may do what                             | Client principal (+ SMD)                           | `customer.yaml.users[].role` → `principal`/`staff`/`compliance` (`staff` renamed from legacy `operator` to avoid the product-name collision) | role idea re-derived; see [`02-client-portal.md`](02-client-portal.md) §2                                                                               |
| **3. Entitlements**         | What the **operator itself** may do (autonomous / drafted / gated / refused) | Whoever holds the config pen at the chosen posture | `customer.yaml` skills + ceilings                                                                                                            | exists ([ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md), [0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md)) |

**The composition rule for any client-side action:** permitted **iff** Layer 1 grants the client org that domain
**AND** Layer 2 grants the acting user that capability. SMD staff (Layer 0) can always act regardless of Layer 1.
Layer 3 bounds what the _operator_ does and is independent of who is watching.

**Layer 1 vs Layer 3 is the distinction we will not blur** (see [ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md)):
authority posture decides _who turns the dial_; entitlements decide _what the dial is set to_. Neither portal ever
assumes a gate (human or automated) that the entitlements did not author. A skill authored `EXTERNAL_SEND: autonomous`
sends with no review surface at all; a skill authored to draft produces a review surface. The portal renders whatever
the entitlements produce — it never imposes a stage.

---

## 3. The multi-operator model: persona = Hermes profile

### 3.1 The mechanism (validated firsthand against Hermes docs + [ADR 0011](../../adr/0011-multi-persona-per-customer.md))

A client's Operator is **one per-customer Fly Machine** ([ADR 0007](../../adr/0007-per-customer-machine-isolation.md))
that hosts **N Hermes profiles**. A Hermes **profile** is a fully isolated agent identity inside one installation —
its own `config.yaml`, `SOUL.md` (identity), `memories/`, and `skills/` under `~/.hermes/profiles/<slug>/`; managed by
`hermes profile list|use|create|delete|show` and the `-p/--profile` flag; profiles are parallel-capable (per-profile
container lifecycle). **A persona is a Hermes profile.** All profiles on a Machine share the connectors and the
per-customer memory namespace, but each keeps its own identity, skill set, voice, and trust ceilings.

This maps the client's preference order exactly:

| Client preference (Captain)            | Hermes reality                                           | Verdict                                 |
| -------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| **1. One operator, multiple personas** | 1 Machine, N profiles, framed as _one worker with roles_ | ✅ same infra as #2                     |
| **2. Multiple operators, one machine** | 1 Machine, N profiles, framed as _a roster of workers_   | ✅ same infra as #1                     |
| **3. Multiple machines**               | N Machines for one client                                | ⚠️ only on a hard isolation requirement |

**Design resolution: model the operator surface as a roster of personas on one per-client Machine, always.** A client
with one persona sees a single operator (a roster of one — no switcher chrome). A client with several sees the roster.
Preferences 1 and 2 are the same build with different labels; we let labeling follow the client's mental model.
Preference 3 (multi-Machine) is the documented escape hatch reserved for genuine isolation walls (e.g. two legal
entities with a conflict-of-interest barrier that must not share memory or connectors), not a default.

### 3.2 v1 ships at one persona; design for N

The `customer.yaml` validator locks `personas[]` to length 1 at v1 ([ADR 0011](../../adr/0011-multi-persona-per-customer.md)).
**Both portals build the roster IA for N and ship it at 1.** The v2 unlock is a validator flip, not a rearchitecture.
A roster-of-one must not look like a placeholder — it is the normal v1 state.

### 3.3 Correction to verify before build: no documented `/handoff`

[ADR 0011](../../adr/0011-multi-persona-per-customer.md) assumes a Hermes `/handoff` slash-command for mid-session
persona switching (cited from PR #23395). **The current public Hermes docs do not document `/handoff`.** They document
`hermes profile use <name>` / `-p` (per-process/per-session selection), `--resume`/`--continue`, `/personality`
(a lightweight prompt overlay, _not_ an identity swap), and `/model`. **Design implication:** treat each persona as an
**independently-addressable running profile** (its own worker), not a chat you toggle mid-conversation. Do not build
client UX around a mid-session persona-switch button until `/handoff` is verified against the pinned `hermes_ref`. This
is the better model for "operators serving different roles" regardless.

> `delegate_task` subagents (3 concurrent by default) are a _separate_ Hermes primitive — intra-operator parallelism,
> not identities. They are not personas and not part of the roster.

---

## 4. The authority model (Layer 1)

### 4.1 Core principles

1. **SMD's control is a constant, not a posture.** SMD always retains full write-control over every domain for every
   client, in every state. We may decline to touch something, but if a client cannot or needs help, we can always step
   in. Non-negotiable, non-removable. The admin console never renders read-only to us.
2. **Client authority is additive and per-domain.** The configurable thing is a set of per-domain **client-self-serve
   switches**, each default **off**. Flipping one on grants the client org operable controls for that domain _in addition
   to_ SMD's — never instead of.
3. **Client read access is on for everything from day one** (their own tenant). The single hard wall is **COGS/cost
   economics** — clients never see our cost basis, by nature, not by posture.
4. **Launch posture: every client-self-serve switch is off.** SMD operates everything; clients watch. We **build the
   seams now** so flipping any one domain to client-operable is a config change, not a code change.

"Managed / Co-Managed / Self-Managed" are **labels for switch patterns** (none on / some on / most on) and useful as
onboarding presets — not three rigid SKUs. The substance is the per-domain switch set.

### 4.2 The domains

The switch set covers the client-operable capability domains. Two domains are **SMD-only always** (never a client
switch): provisioning/lifecycle and cost. Each domain maps to real surfaces:

| Domain                   | Controls                                                                                                         | Client-switchable?                                          | Governing specs                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provisioning & lifecycle | stand up / pin / resize / pause / decommission                                                                   | **No — SMD only**                                           | [decommission-customer.md](../../specs/operator/decommission-customer.md)                                                                          |
| Cost & economics         | COGS, COGS/MRR, anomalies                                                                                        | **No — SMD only**                                           | [cost-attribution-rollup.md](../../specs/operator/cost-attribution-rollup.md)                                                                      |
| Configuration authoring  | personas, skills on/off, scope, business hours                                                                   | Yes                                                         | [customer-yaml-schema.md](../../specs/operator/customer-yaml-schema.md)                                                                            |
| Trust & governance       | entitlement ceilings _within authored floors_                                                                    | Yes                                                         | [trust-ceiling-logging.md](../../specs/operator/trust-ceiling-logging.md)                                                                          |
| Connectors & credentials | connect / reconnect / custody (see §5)                                                                           | Yes                                                         | [oauth-lifecycle.md](../../specs/operator/oauth-lifecycle.md)                                                                                      |
| Runtime operations       | whatever controls the authored entitlements expose (e.g. a draft-review queue _if_ a skill is authored to draft) | Yes                                                         | [dashboard-roles.md](../../specs/operator/dashboard-roles.md)                                                                                      |
| Memory & agent-skills    | review / dismiss / enable observations + agent-authored skills                                                   | Yes                                                         | [memory-ingestion.md](../../specs/operator/memory-ingestion.md)                                                                                    |
| People & access          | users, roles, PTO, voice profiles                                                                                | Yes                                                         | [dashboard-roles.md](../../specs/operator/dashboard-roles.md)                                                                                      |
| Compliance & audit       | evidence packets, retention posture (read), holds                                                                | Yes (read always on)                                        | [compliance-evidence-packet.md](../../specs/operator/compliance-evidence-packet.md), [audit-retention.md](../../specs/operator/audit-retention.md) |
| Observability & health   | heartbeat, connector health, sticky-stop state                                                                   | Read for all; limited actions (ack, pause) gated by Layer 2 | [sticky-stop.md](../../specs/operator/sticky-stop.md), [connector-smoke-tests.md](../../specs/operator/connector-smoke-tests.md)                   |

### 4.3 How the posture manifests

**In config** (net-new `authority` block; requires a schema addition + a short ADR — see §8):

```yaml
authority:
  default: managed # preset: SMD operates every domain by default
  overrides:
    people_access: client # this client runs its own staff list
    # connectors: client      # (example) this client self-manages connections
```

Materialized into `customer_configs` alongside the other projections, read by both portals.

**In the admin portal** — every domain is operable by SMD; the per-domain flag only governs whether a **client
change-request** path is relevant for that domain. The fleet roster shows each client's posture as a chip; the
per-client detail shows each domain card's authority badge (SMD-operated vs client-also-operable). A **change-request
inbox** receives requests from clients in SMD-operated domains.

**In the client portal** — the _same posture data_, read from the other side. Each domain surface renders in one of two
modes:

- **Operable** → live controls; the client edits directly (switch on).
- **Read + Request** → identical data, read-only, with a "Request a change" button that files into the admin inbox
  (switch off).

At launch, every domain is Read + Request for every client. Flip a switch later and that surface lights up as
Operable — no rebuild. An escalation/contact path is always present regardless of posture.

---

## 5. Credentials sub-model (reconciled with the existing OAuth spec)

Credentials are the one domain where client self-service is a **security/privacy upgrade**, not just a convenience —
which inverts the default-off logic. This model \*\*builds on [oauth-lifecycle.md](../../specs/operator/oauth-lifecycle.md)

- [ADR 0010](../../adr/0010-per-customer-oauth-token-storage.md) + [ADR 0036](../../adr/0036-oauth-token-relay-fly-secret-restart.md)\*\*; it does not replace them.

### 5.1 What the existing spec already mandates

- Customer OAuth tokens live **only** on the per-customer Fly volume (`/opt/data/oauth/{connector}.json`), never in a
  shared store ([ADR 0010](../../adr/0010-per-customer-oauth-token-storage.md)). SMD never holds the OAuth secret.
- Re-consent is **customer-completed**: the customer clicks an authorize link and consents in their own browser; the
  callback lands on `portal.smd.services/.../oauth/{connector}/callback` ([oauth-lifecycle.md](../../specs/operator/oauth-lifecycle.md) §Re-authorization).
- Routine access-token refresh (using the stored refresh token) is automatic and invisible.

So for OAuth connectors, the "we never hold your keys" property is **already the architecture**. The customer is always
the consenting party; SMD never sees the credential.

### 5.2 The two custody modes, precisely

The "delegated vs self-held" choice bites differently by credential shape:

| Credential shape                                           | Delegated (default)                                                                                                                                                    | Self-held (privacy-max)                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **OAuth** (Google, M365, Clio, QuickBooks…)                | Customer consents; SMD **monitors and drives** re-consent — watches for expiry, fires the one-click re-consent link, removes all friction. SMD never holds the secret. | Customer consents; the customer **monitors and self-initiates** re-consent from their portal. SMD does not proactively drive it. |
| **Static secret** (raw API keys: CourtListener, CallRail…) | Secret entered into the per-customer vault in a way **SMD can read and rotate** without the customer.                                                                  | Secret entered so **only the operator runtime can use it** — SMD cannot read it; only the customer can re-enter/rotate.          |

Two honest boundaries:

- **OAuth re-consent always needs a human click at the provider** when the refresh token dies (revocation, password/MFA
  change, or idle-TTL expiry — ~75–90 days for MS). For _actively-used_ connectors, rolling refresh keeps tokens alive
  indefinitely, so this is rare. "We reconnect for you" (delegated) = SMD makes it a one-click link to the right person;
  it does not mean SMD bypasses consent. Static keys have no such wrinkle — in delegated mode SMD rotates them fully.
- **Self-held means SMD genuinely cannot recover it.** If a self-held credential breaks, SMD drives the customer through
  re-entry (sends the link, guides) but cannot paste it back. That is the trade for the "our consultant literally cannot
  touch our keys" guarantee.

### 5.3 Design posture

- **Default = delegated, per client**, **overridable per connector** (a firm may delegate its calendar while self-holding
  its bank/practice-management system). We need not expose per-connector granularity at launch, but the credential model
  is built per-connector so we _can_.
- Both modes store in the **per-customer isolated vault** — isolation holds either way. The only axis that moves is
  whether SMD staff can reach the secret value.
- **Static-secret client entry is the part that needs the most care:** a client-entered key must post straight to a
  write-only secret endpoint scoped to that customer's store and never land in the console DB, a log, or a transcript
  (the analog of the server-side secret-set pattern). Getting this wrong leaks a privileged credential. Treated as its
  own design item in [`01-admin-portal.md`](01-admin-portal.md)/[`02-client-portal.md`](02-client-portal.md).

---

## 6. Data and configuration substrate

```
                customer.yaml  (git — source of truth, ADR 0012)
                      │  CI validate + materialize on merge
        ┌─────────────┴───────────────┐
        ▼                             ▼
  customer_configs (D1)         R2 customer.yaml shadow
  + customer_config_history     (per-customer prefix)
        │                             │
        │  read by both portals       │  read by the Machine at boot
        ▼                             ▼
   PORTAL SURFACES            per-customer Fly Machine
                                  └─ per-customer Hermes D1  ◄── runtime state
                                     (11 tables, ADR 0009 isolation)
```

- **Config authority:** `customer.yaml` in git is the source of truth ([ADR 0012](../../adr/0012-customer-yaml-storage.md)).
  Portal config writes go through `config_change_audit` (the control-plane intent ledger) and a git write-back →
  CI re-materialize loop ([ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md)/[0026](../../adr/0026-config-surface-is-a-security-boundary.md)).
  Non-structural changes hot-reload via the `customer-sync` sidecar; structural changes flag a Captain re-provision
  ([ADR 0019](../../adr/0019-customer-yaml-to-profile-config-translation.md)).
- **Runtime state lives in the per-customer Hermes D1**, not the console DB. The 11 tables
  ([d1-schema.md](../../specs/operator/d1-schema.md)) both portals display:

  | Table                   | Holds                                                 | Portal use                                                                                                     |
  | ----------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
  | `audit_log`             | append-only action record                             | audit surfaces (both); immutable ([audit-log-immutability.md](../../specs/operator/audit-log-immutability.md)) |
  | `draft_queue`           | pending review items _(when authored)_                | client review surface, admin observe                                                                           |
  | `skill_state`           | per-skill ceiling, activation, `operator_may_approve` | skills surfaces                                                                                                |
  | `memory_rules`          | sourced hard rules (soft-delete)                      | memory surfaces                                                                                                |
  | `person_mappings`       | names/roles/emails                                    | matter + memory context                                                                                        |
  | `voice_samples`         | R2 keys, cohort, blind-test status                    | voice/calibration                                                                                              |
  | `recipient_cohorts`     | voice audience taxonomy                               | voice                                                                                                          |
  | `escalation_events`     | red-flag/failure/invariant triggers                   | health/notifications                                                                                           |
  | `cost_telemetry`        | daily cost rollup per driver                          | **admin only**                                                                                                 |
  | `captain_time_events`   | event-sourced SMD time                                | **admin only**                                                                                                 |
  | `invariant_boot_checks` | boot-time safety results                              | admin health                                                                                                   |

- **The runtime read path is a component we design, not a dependency we wait on.** Runtime state lives in each
  Machine's isolated D1; the console cannot query it directly across the isolation boundary
  ([ADR 0009](../../adr/0009-cross-machine-query-prohibition.md)). So both portals need a **controlled read path** from
  the portal to a Machine's runtime state. We design it (see [`01-admin-portal.md`](01-admin-portal.md) §"Runtime read
  path") — options are a thin read API the Machine exposes to an authenticated console caller, or a periodic
  mirror of read-relevant rows into a console-side per-customer store. This is the thing to _resolve_, not a ticket to
  honor; until it exists, runtime-state surfaces render honest empty states, but the design does not block on it.
- **Isolation:** per-customer D1/R2/Vectorize bound at the Machine, no row-level `customer_id`, no cross-Machine query
  ([ADR 0009](../../adr/0009-cross-machine-query-prohibition.md), invariant #7). The admin "drill into one operator's
  runtime state" is therefore a deliberate, controlled cross-boundary read — designed, audited, and scoped to one
  customer per call. It must never become a cross-customer join.

---

## 7. Design principles both portals adopt

We adopt these because they are right for a product that operates an AI employee inside a client's business — not
because a prior spec mandated them. Where an existing spec happens to state the same thing well, reuse is a bonus; where
it doesn't, these govern:

1. **Audit everything.** Every config or operational action (ceiling change, skill toggle, role grant, draft action,
   pause, connector change) writes an `audit_log` row with `actor` + `actor_role` + metadata
   ([audit-emit-points.md](../../specs/operator/audit-emit-points.md)). The log is append-only and immutable
   ([audit-log-immutability.md](../../specs/operator/audit-log-immutability.md)).
2. **RBAC is binding.** [dashboard-roles.md](../../specs/operator/dashboard-roles.md) §Permission matrix governs Layer 2.
   Server-side enforcement; never client-side-only hiding.
3. **No fabricated content.** When authored data is missing, render an honest empty state — never placeholder copy
   ([fabrication-filter.md](../../specs/operator/fabrication-filter.md), `docs/style/empty-state-pattern.md`). A
   roster-of-one, an un-calibrated persona, an unconfigured domain all render as real states, not "coming soon."
4. **Retention is override-up-only.** Audit retention cannot be lowered below the vertical floor
   ([audit-retention.md](../../specs/operator/audit-retention.md)).
5. **Sticky-stop is read + limited-action from the client.** The circuit-breaker state is system-driven; only Captain
   can `clear()` ([sticky-stop.md](../../specs/operator/sticky-stop.md)). Clients see state; pause/resume is Layer-2 gated.
6. **Entitlements are never assumed.** No portal renders a review/approval stage the entitlements did not author. The
   review surface is conditional on a skill being authored to draft — see §2 and the drift note in §8.

---

## 8. Legacy artifacts we explicitly do not reuse, net-new work, and things to resolve

**Legacy portal/UX artifacts — do not adopt (clean slate, §1):**

- The "**Pattern A / reviewer-as-sender / autonomous sends BANNED / no `send` method**" framing in
  [capability-contracts.md](../../specs/operator/capability-contracts.md), [audit-emit-points.md](../../specs/operator/audit-emit-points.md),
  and the specs [index.md](../../specs/operator/index.md) is a **dead default** superseded by
  [ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md). We do not design to it. The portals treat draft-review
  as **one authored mode among many** (a surface that exists only when a skill is authored to draft) and fully support
  autonomous skills (no review surface; activity appears in the audit/activity log). Those runtime specs carry the
  fossil and should be reconciled on their own track; it is not a portal concern and not a constraint here.
- The dashboard tab IA in [dashboard-roles.md](../../specs/operator/dashboard-roles.md) (Today / Queue / Memory / …) and
  the built page set are **not** the IA. [`02-client-portal.md`](02-client-portal.md) designs the IA from the client's
  actual jobs. The `principal`/`operator`/`compliance` role _idea_ is re-derived on its merits, not inherited.

**Net-new work this design introduces (each gets an ADR in this package):**

- **`authority`-block model** (§4) — per-domain client-self-serve switches; schema addition + `customer_configs`
  projection. ADR: [0041](../../adr/0041-operator-authority-posture.md) (proposed).
- **Per-connector credential custody** (§5) — delegated vs self-held + the write-only static-secret client-entry path.
  ADR: [0042](../../adr/0042-operator-credential-custody.md) (proposed).

**Things to resolve (designed here, not external blockers):**

- The **runtime read path** (§6) — **decided A+B** (mirror summaries for fleet/rollup; live per-customer reads for deep
  drill-ins). Specced and built first; until built, runtime surfaces render empty states. See
  [`01-admin-portal.md`](01-admin-portal.md) §7.
- **`/handoff` verification** (§3.3) against the pinned `hermes_ref` before any multi-persona switching UX is built.
- **Trust model = action-class, not scalar.** Governance surfaces target the action-class ceiling model
  ([ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md)); the data layer's per-skill
  scalar `trust_ceiling` is legacy and the surface should drive the data layer toward the action-class model, not the
  reverse.

---

## 9. How the two portal docs build on this

- **[01-admin-portal.md](01-admin-portal.md)** — fleet roster across all operators; per-operator drill-in; provisioning
  & lifecycle; config authoring + floor-setting; the change-request inbox; monitoring (health, connectors, audit, cost,
  sticky-stop); decommission. SMD-operable everywhere (Layer 0).
- **[02-client-portal.md](02-client-portal.md)** — the persona roster; the per-domain Operable / Read+Request surfaces
  driven by the authority posture; the reconciled operator dashboard IA; team/roles/PTO/voice; credentials self-service;
  audit/compliance. Gated by Layers 1 + 2.

Both read the same `customer_configs` and the same per-customer Hermes D1 (via the runtime read path, §6), enforce the same RBAC, and emit
the same audit events. The seam between them is the authority posture (§4) and the SMD-always-full-control invariant.
