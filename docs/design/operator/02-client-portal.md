# Operator Client Portal — Design

> **⚠️ SUPERSEDED (2026-06-20) by [ADR 0050](../../adr/0050-operator-portal-management-console-not-data-surface.md).**
> This document predates ADR 0050 and describes the portal as a data/case surface (a "Matters" view, per-engagement content, an in-portal draft-approval workspace). That model is retired. The portal is a **management console, not a data surface**: it does three jobs — Direct (config), Account (the operator's own governance/audit record), Administer (the relationship) — and never stores or mirrors the client's business data, contains no work-approval action, and is vertical-agnostic. **Read ADR 0050 as the source of truth; treat the sections below as historical, except where they describe surfaces ADR 0050 keeps (Activity, Calendar, Connections, Configure, Team, Account, Compliance, Onboarding).**

**Status:** Draft for Captain review (2026-06-08). Build-ready design for the **client side** of Operator management.
Builds on [`00-foundations.md`](00-foundations.md) — read it first. Pairs with [`01-admin-portal.md`](01-admin-portal.md),
built in parallel by a separate team. Designed clean-slate: the built `/portal/products/operator/*` pages and the
[dashboard-roles.md](../../specs/operator/dashboard-roles.md) tab IA are reference and a parts bin, **not** the design.

Surface root: `portal.smd.services/products/operator/*` (Clerk-gated; subscription + role required).

---

## 1. What this portal is for

It is where a client **lives with the operator(s) working inside their business**. The client's jobs, in priority order:

1. **See what my operator is doing** — and trust it's doing it well.
2. **Handle the things that need me** — where, and only where, the operator's configuration routes something to a human.
3. **Understand my matters / workstreams** — the operator's per-engagement state.
4. **Verify and prove** — the audit record; compliance evidence.
5. **Shape my operator** — its skills, voice, scope, governance — to the degree SMD has handed me control.
6. **Run my team and my connections** — people, roles, time-off, system connections.

The portal renders all of this at the client's **authority posture** ([ADR 0041](../../adr/0041-operator-authority-posture.md))
and **client-internal role** (§2). At launch the client can **see everything but operate nothing** — SMD runs it — and
the same surfaces light up as operable when SMD flips a domain's switch.

---

## 2. Who uses it — client-internal roles (Layer 2)

Re-derived from what a client org actually needs (not inherited). Three roles, which converge on a sound separation:

| Role         | Who                                                       | Needs to                                                                                                     |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `principal`  | owner / partner / the buyer                               | control the operator within authority; manage the team; set ceilings within floors; be the escalation target |
| `staff`      | day-to-day staff (paralegal, office manager, coordinator) | handle work the operator routes to a human; manage matters; see activity                                     |
| `compliance` | outside counsel / compliance officer                      | read-only audit + evidence access; separation of duties                                                      |

> **Naming (resolved, Captain 2026-06-08):** the legacy role name `operator` collided with the product name "Operator".
> The human day-to-day role is **`staff`**. `customer.yaml.users[].role` uses `principal | staff | compliance`.

Roles come from `customer.yaml.users[].role` via Clerk org claims; resolved server-side on every request. The capability
matrix (who sees/does what) is re-specified fresh in the build, not copied from the legacy matrix.

---

## 3. The core mechanic: dual-mode surfaces

Every domain surface renders in one of two modes, decided by the client's **authority switch** for that domain
([foundations §4](00-foundations.md)):

- **Operable** (switch on) — live controls; the client acts directly, subject to their role.
- **Read + Request** (switch off) — identical data, read-only, with a **"Request a change"** action that files into the
  admin change-request inbox.

**At launch, every switchable domain is Read + Request.** Read access is always on (the client's own tenant); the only
thing never shown is cost/COGS. An **escalation / contact-SMD** affordance is present on every surface regardless of mode.
Flipping a switch (an SMD action) turns a surface Operable with no rebuild — the portal reads the posture and renders
accordingly.

This one mechanic is the heart of the client portal. Build it once as a wrapper; every domain surface uses it.

---

## 4. Information architecture

```
/portal/products/operator
├── (home / today) ........... what the operator did; what needs me; aliveness        [read]
├── /operators ............... persona roster (multi-persona); select one to scope     [read + select]
├── /work .................... things routed to a human (where authored)               [operable iff runtime switch + role]
├── /matters ................. per-engagement workstreams + detail                     [read]
├── /activity ................ full activity + audit log; compliance evidence export   [read]
├── /configure ............... shape the operator — dual-mode per sub-domain
│   ├── /skills .............. enable/disable, scope, schedules
│   ├── /governance ......... ceilings within SMD floors (action-class)
│   ├── /voice .............. samples, cohorts, calibration
│   ├── /scope .............. folder visibility, keyword/domain/matter blocks
│   └── /hours .............. business hours
├── /team .................... users, roles, time-off
├── /connections ............ connectors + credential custody self-service
└── /account ................ subscription, notifications, escalation contacts
```

Designed from the client's jobs (§1), not the legacy tabs. A roster-of-one client never sees `/operators` chrome —
their single operator is the implicit scope.

---

## 5. Surfaces

### 5.1 Home / Today

The answer to "what's happening." Composed of:

- **Aliveness** — the operator is up and working (heartbeat); sticky-stop banner if the circuit breaker tripped.
- **What it did** — recent completed actions (autonomous or human-completed alike), in plain language.
- **What needs me** — a count + entry into `/work`, present **only if** the configuration routes something to a human
  _and_ the runtime switch hands that to the client. If skills are authored autonomous, there is no "needs me" — and the
  home does not imply one. (This surface must never fabricate a review queue that the entitlements didn't author —
  [foundations §2](00-foundations.md), [ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md).)
- **Escalations** — anything the operator flagged to a human per the escalation config.

Read-only. The "what needs me" entry is the only actionable element and only when applicable.

### 5.2 Operators (persona roster)

The multi-operator surface ([foundations §3](00-foundations.md)). Each persona/operator: name, title, status, what it
handles, its own aliveness. Selecting one **scopes the rest of the portal** to that operator (its work, matters,
activity, config). This is selection, not a mid-session `/handoff` — each persona is its own running profile; the portal
just filters the view. Roster-of-one: this surface is suppressed and the single operator is the default scope. Built for
N, shipped at 1.

### 5.3 Work

Where a human handles what the operator's configuration routes to them. **Entirely conditional on entitlements**: a
review/approval item exists here only because a skill was authored to produce one. Where it exists and the runtime switch
is on, the assigned human (principal or staff, per role) acts on it — reviews, edits, and completes the action the way
the engagement authored it. Where the runtime switch is off (launch default), this is Read + Request and SMD handles the
work. Where no skill routes to a human, this surface is empty by design — not a broken queue.

The surface adapts to whatever the entitlements produced; it imposes no stage of its own.

### 5.4 Matters / workstreams

The operator's per-engagement aggregates (vertical-shaped — matters for law, deals for real estate, etc.): list +
detail, each showing timeline, associated actions/documents, and assignment. Read for the client; `staff` may be
scoped to assigned workstreams. Fed by the runtime read path ([01-admin §7](01-admin-portal.md)).

### 5.5 Activity & Audit

The full record. Activity in plain language for everyday use; the underlying **append-only, immutable audit log**
([audit-log-immutability.md](../../specs/operator/audit-log-immutability.md) as the data contract) for verification,
filterable by persona, skill, action class, actor, date. **Compliance** role lands here (separation of duties) and can
export an evidence packet. This is a trust centerpiece — "you can see and prove everything your operator did" — and is
read for everyone (compliance read-only by definition).

### 5.6 Configure

Shape the operator, each sub-domain rendered dual-mode:

- **Skills** — enable/disable, scope, schedules per persona.
- **Governance** — per skill × action class, the ceiling **within the SMD-set floor**. The floor is shown as a hard stop
  the client cannot cross; the client moves within it. Rendered on the action-class model; clean of any imposed default
  (an unconfigured action class reads as fail-closed, never as "drafts for review").
- **Voice** — samples, recipient cohorts, calibration sessions (principal-led voice tuning).
- **Scope** — folder visibility, keyword/domain/matter blocks (the operator's blindness envelope).
- **Hours** — business hours.

At launch all Read + Request. Operable when SMD flips the relevant switch (governance and config-authoring are likely
among the _last_ domains handed over, given they shape what the operator may do).

### 5.7 Team

Client users and their roles; time-off (which can route a staff member's work to others). Principal-operable when the
people-access switch is on. Per the hand-over ordering (§8), people-access stays SMD-operated longer than connections;
it is a later self-serve hand-over, not an early one. Read + Request otherwise.

### 5.8 Connections

Connectors + **credential custody self-service** ([ADR 0042](../../adr/0042-operator-credential-custody.md)). Per
connector: status, health, and the **custody choice** (delegated / self-held). When the connections switch is on, the
client can:

- **Connect / reconnect** via OAuth — the client completes consent in their browser; the token lands on their isolated
  Machine volume; SMD never sees it (the consent flow already exists at `oauth/[connector]`).
- **Enter a static secret** — via a **write-only field** that posts straight to their isolated secret store and returns
  only a masked confirmation; the value never touches the console DB, logs, or any transcript.
- **Choose custody per connector** — self-held (SMD cannot touch the key; the client re-establishes broken connections
  themselves) vs delegated (SMD monitors and re-establishes for them). The help-model implication is shown at choice
  time and audit-logged.

This is the one domain where client self-service is a _security upgrade_, so it may be handed over earlier than other
domains for privacy-sensitive clients. The write-only static-secret path is the highest-care element on the client side.

### 5.9 Account

Subscription state (provisioning / active / paused), notification preferences, escalation contacts. The
provisioning/paused states render as honest status surfaces (no fabricated controls).

---

## 6. Onboarding & calibration

How a client gets a working operator:

1. **Invite & roles** — SMD (or the principal, if people-access is on) adds users with roles via Clerk org.
2. **Connect systems** — connector consent (§5.8), per custody choice.
3. **Calibrate** — principal-led sessions to tune voice and confirm behavior before the operator works externally. This
   is a real client surface (voice/skill/ceiling tuning), rendered honestly: no calibration cycle yet = a real
   "not started" state, not a fabricated one.

Calibration is the client's "make this operator _mine_" moment and should feel like onboarding a hire, not configuring
software.

---

## 7. Cross-cutting

- **Composition:** a client action is permitted iff the authority switch is on for the domain **and** the user's role
  allows it ([foundations §2](00-foundations.md)). Server-enforced; never client-side-only hiding.
- **Audit:** every client action writes an audit row with the client actor + role. The client's own actions appear in
  their audit log alongside the operator's.
- **No fabrication, ever:** empty/absent states are real (no review work, roster-of-one, un-calibrated persona,
  unconnected connector, paused subscription). Never placeholder or "coming soon" copy
  ([fabrication-filter.md](../../specs/operator/fabrication-filter.md), `docs/style/empty-state-pattern.md`).
- **Escalation always available:** every surface has a contact-SMD path regardless of posture — SMD is always the
  backstop, most visibly so for self-managed clients.
- **Isolation:** the portal only ever shows the signed-in client's own tenant; the runtime read path is scoped to their
  one customer.

---

## 8. Build notes

**Reusable as-is (bonus):** the OAuth connect/callback routes (`oauth/[connector]`), the Clerk + subscription + role
resolver (`resolveOperatorAccess`), the subscription lifecycle states, the empty-state pattern. Individual built
components (draft view, audit table, settings forms) are a parts bin — reuse where they fit the new IA, discard where
they encode the legacy tab model or the dead draft-default framing.

**Net-new:** the dual-mode surface wrapper (§3 — the core mechanic), the jobs-based IA (§4), the persona roster scoping,
the entitlement-conditional Work surface, the governance surface on the action-class model with visible floors, credential
custody self-service incl. the write-only static-secret path, and the re-derived role/capability matrix.

**Shared with the admin team:** the **runtime read path** ([01-admin §7](01-admin-portal.md)) — both portals' live data
depends on it; spec it once, first. The `customer_configs` projection (incl. the net-new `authority` block) is the shared
config read.

**Sequence (per Captain hand-over ordering):** dual-mode wrapper + home/activity (read-only, lights up the portal on the
read path) → matters → **connections + credential custody operable (the first and only early hand-over)** → configure /
voice / scope (read+request) → work, team, and governance operability later. Connections is the one domain we build for
client operability first; everything else ships Read+Request and gains operability as SMD flips switches over time.

---

## 9. Resolved decisions (Captain, 2026-06-08)

1. **Role rename:** the human day-to-day role is **`staff`** (`principal | staff | compliance`).
2. **Hand-over order:** **connections & credentials is the single early self-serve hand-over.** People, runtime/work, and
   governance/config stay SMD-operated longer and gain client operability later. Build polish follows this order.
3. **Calibration ownership:** determined by the authority model — principal-led when the client operates; SMD runs it on
   the client's behalf (audited SMD-staff identity) in a managed posture. Not a separate toggle.
