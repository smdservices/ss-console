# 03 — Operator ⇄ Claude MCP Connector (Operator-as-MCP-Server)

**Status:** Implemented (rev 7, 2026-06-29). The access model is locked by **[ADR 0057](../../adr/0057-operator-claude-connector-access-model.md)** and the connector surface shipped across slices 2a–2c + 2e (grant table + live kill switch, admin grant lifecycle + immutable audit, issuance-policy axis, hardened open-by-domain JIT). The slice-2d screening-attestation gate was **ripped out** (amended ADR 0057 §4 — a use-at-your-own-risk product does not block client access on signed paperwork). Phase-1 hosting is console-mediated. Clerk authenticates; the Operator's grant table authorizes.
**Author:** design pass (rev 1–5) + implementation (ADR 0057, slices 2a–2d)
**Companion docs:** [00-foundations.md](00-foundations.md), [01-admin-portal.md](01-admin-portal.md), [02-client-portal.md](02-client-portal.md), [mcp-clerk-setup.md](mcp-clerk-setup.md)
**Primary ADRs:** **[0057](../../adr/0057-operator-claude-connector-access-model.md) (the access model — authoritative)** · [0007](../../adr/0007-per-customer-machine-isolation.md) · [0010](../../adr/0010-per-customer-oauth-token-storage.md) · [0011](../../adr/0011-multi-persona-per-customer.md) · [0015](../../adr/0015-hermes-fork-vs-upstream.md) · [0020](../../adr/0020-connector-strategy.md) · [0035](../../adr/0035-no-imposed-entitlement-defaults.md) · [0043](../../adr/0043-operator-runtime-read-path.md) · [0045](../../adr/0045-mediated-connector-capability-broker.md) · [0005](../../adr/0005-external-send-identity.md) · [0037](../../adr/0037-operator-thesis.md)

> **Reconciliation with ADR 0057 (read this first).** This doc's §4 (access model) and §5 (authentication) were the rev-1 design pass. Where they differ from ADR 0057, **ADR 0057 governs.** What it locked and shipped:
>
> - **Login = Clerk per-user OAuth, mailbox-possession sign-in to the firm address** (email OTP code preferred over magic link, so the verification stays in Claude's OAuth browser; see [mcp-clerk-setup.md](mcp-clerk-setup.md)). Email possession is the identity, so offboarding rides the firm mailbox.
> - **Authorization = SMD's `mcp_issued_grants` grant table, read live per request** — the authoritative allowance and the **instant kill switch** (revoke cuts on the next call). Bounded: `ttl_days` ∈ [1, 90], never infinite. Admin issue/revoke + an append-only `operator_mcp_grant_audit` ledger (slice 2b).
> - **Issuance policy is firm-authored** (`mcp_connector.policy`): `allowlist` (default, fail-closed — the pilot path) or `open` (verified firm-domain JIT). The hardened open-by-domain auto-issue is **slice 2e** (sticky revoke, verified-primary-email pinning, exact-host domain match, per-customer grant cap, shorter TTL); **not in the pilot path.**
> - **No screening/attestation gate.** An earlier slice (2d) made a written no-active-screens attestation a fail-closed precondition to any inbound channel; it was ripped out (amended ADR 0057 §4). This is a use-at-your-own-risk product — the connector fails closed on **authorization** (the grant table), not on signed paperwork. Disclosure/service-agreement work is deferred to when there is a product to sell.
> - **The "activation-gated on an RFC 8707 `aud`" status below is superseded.** Clerk's MCP/DCR tokens omit a resource-bound `aud` (verified in #1398), so isolation rests on exact `iss` + the customer-scoped subject/grant check; a present `aud` is still enforced. The connector is **not** blocked on Clerk shipping resource indicators.

---

## 1. What this is

A **reusable, durable, vertical-agnostic MCP connector** that lets any Operator, in any vertical, talk to a client organization through that org's own Claude. Concretely: any user in a client org adds the Operator as a connector inside their own Claude (claude.ai / Claude Desktop) and can query org/work context, pull scoped context on demand, hand work to the Operator, and check status, without leaving the tool they already live in.

It is the inverse of everything we have built so far. Today the Operator **consumes** MCP (connectors are wired as Hermes child processes in `bootstrap/mcp_registry.py` per [ADR 0020](../../adr/0020-connector-strategy.md)/0021). Here the Operator **serves** MCP to an external client. That inversion is the core design problem and is treated as green-field: no `/mcp`, `fastmcp`, or SSE machinery exists in the overlay today (verified 2026-06-13).

### Origin and why it is strategic

The first instance is a legal pilot. The prospect's decision-maker (a litigator) runs a disciplined personal Claude workflow: one Project per case, sub-Projects for task clusters within a case, files pulled in, AI used to **read and highlight, never to draft**. He asked whether firm users could exchange with the Operator from inside their own Claude. Law is the pilot; the connector is the general capability.

Three reasons this matters beyond the one deal:

1. **It meets the client where they already are.** This is the Operator thesis ([ADR 0037](../../adr/0037-operator-thesis.md) Tenet 2): the substrate is valuable because it is connectable to whatever interface the user already lives in. The user already lives in Claude.
2. **It survives the client not upgrading their systems.** With no system API connected it still serves email-derived context, user-supplied documents, and the Operator's own memory. It gets richer, not rebuilt, when a system API lands (§9).
3. **It replaces a manual context-curation chore with a live one** (§3). That is the value most likely to be felt on day one.

### Framing constraints this design respects

1. **The Operator is a remote worker.** The governing principle for the whole access model (§4). If a human remote worker in that seat could reasonably do it, the Operator can; if such a worker could not or should not, neither can the Operator.
2. **Surface, don't draft.** Every tool is read/retrieve/surface-oriented and matches the user's discipline. The one state-changing tool (`operator_handoff_task`) creates an internal work request; it does not author or send client-facing content.
3. **Direction reality.** `user → Operator` is the clean MCP path (synchronous tool calls). `Operator → user` (proactive) goes over the Operator's existing channels (email, Telegram), not the MCP link. We do not promise live server-push into a Claude session (§7).

---

## 2. Where the connector sits

The connector contract — the tool surface (§6), the two-axis authz model (§4), the authority modes (§4.2), the audit shape (§8), and the memory-wall rule (§4.3) — is **hosting-agnostic**. Phase 1 and the durable alternative differ only in where the MCP server process runs; everything the rest of this doc specifies holds either way. Only the hosting moves.

### 2.1 The decision: console-mediated MCP, not a Hermes plugin, never core

The Phase-1 host is the **ss-console Worker**. The console is already public, already the Clerk relying party for every customer, and already holds the runtime-read seam into every Machine ([ADR 0043](../../adr/0043-operator-runtime-read-path.md)) via per-customer `HMAC(master, slug)` keys. So the cheapest place to stand up an authenticated, audited, per-customer MCP surface is the console: it terminates TLS, validates the user's Clerk JWT, resolves the customer + profile, and reaches the Machine over the seam it already operates. Reads are served by pulling per-customer state (audit, memory, assembled context) through the runtime-read seam; a handoff is delivered to the Machine over a signed webhook (the same `0.0.0.0:8643` gate the Machine already exposes), authenticated with a **per-customer-derived** webhook secret (`HMAC(WEBHOOK_SECRET_MCP_MASTER, slug)`, mirroring the runtime-read key and the AgentMail webhook secret) so a leaked secret is scoped to one customer, never the fleet.

**The load-bearing isolation invariant (console hosting).** Each customer has a distinct canonical resource, `https://smd.services/api/operator/<customer>/mcp`. The route identifies the resource the caller requested; it does not grant access. Before any Machine read, the console validates the token against that customer's pinned Clerk JWKS and requires exact `iss`, resource-bound `aud`, stable Clerk `sub`, and, when configured, `org_id`. The `sub` must map through `users.clerk_user_id` to an authored `mcp_connector.access[]` entry. The per-customer HMAC read key and webhook secret derive only after those checks pass.

```
   claude.ai / Claude Desktop (the user's own Claude, MCP client)
            │  POST /mcp  (Streamable HTTP, OAuth 2.1 bearer)
            ▼
  ┌────────────────────────────────────────────────────────────────┐
  │  ss-console Worker  (public, Clerk relying party)                │
  │  ┌──────────────────────────────────────────────────────────┐  │
  │  │  POST /mcp                  (NEW: MCP Streamable HTTP)     │  │
  │  │  GET  /.well-known/oauth-protected-resource (NEW)         │  │
  │  └───────────────┬──────────────────────────────────────────┘  │
  │                  │ (1) validate Clerk JWT; customer := aud      │
  │                  │     (path/body slug checked-to-match, never  │
  │                  │     trusted) → resolve org user → profile    │
  │                  │ (2) REACH gate (inherit/delegate, §4) +      │
  │                  │     CONSEQUENCE gate (authored ceiling, §4)  │
  │                  │ (3) emit audit: who asked + authority it ran │
  │     ┌────────────┴───────────────┬──────────────────────────┐  │
  │     │ READ / surface tools       │ HANDOFF tool             │  │
  │     │ pull per-customer state    │ POST signed webhook to   │  │
  │     │ via runtime-read seam      │ the Machine's gate       │  │
  │     │ (HMAC per slug, no wake)   │ (per-customer secret,    │  │
  │     │                            │  surface="mcp")          │  │
  │     └────────────┬───────────────┴────────────┬─────────────┘  │
  └──────────────────┼────────────────────────────┼───────────────┘
                     │ GET /runtime/<kind>         │ POST /webhooks/mcp
                     │ (ADR 0043 seam, HMAC)       │ (HMAC per slug)
                     ▼                             ▼
  ┌────────────────────────────────────────────────────────────────┐
  │  per-customer Fly Machine (one client org)                      │
  │   :8643 gate → audit ledger, memory mirror, assembled context;  │
  │   handoff → InboundEnvelope(surface="mcp") → :8644 Hermes agent │
  │   → agent works async; reply goes out over email / Telegram,    │
  │   NOT over /mcp                                                  │
  └────────────────────────────────────────────────────────────────┘
```

Why not the other two options:

- **Not a Hermes plugin.** A plugin runs inside the agent loop. It cannot reliably serve HTTP while the agent is mid-turn, and it cannot enforce authentication and authorization _before_ Hermes is involved. Whether hosted in the console or on the Machine, the MCP surface must sit **outside the agent loop**. ([ADR 0015](../../adr/0015-hermes-fork-vs-upstream.md): plugins never touch core.)
- **Not core Hermes.** [ADR 0015](../../adr/0015-hermes-fork-vs-upstream.md) is absolute: pin-only fork, plugin-only overlay, no core modification. The connector introduces no Hermes-core change in either hosting.

### 2.2 The tradeoff: console hosting vs. physical single-tenancy

Console hosting moves cross-customer isolation **from physical single-tenancy into console code**. On a per-Machine sidecar, the endpoint physically cannot see another customer's state because it runs on a single-tenant Machine. In the console, that boundary is enforced in code instead. Three things make this acceptable rather than a new risk:

- **It reuses the EXISTING fleet boundary, not a new one.** The console already reads every Machine via per-customer HMAC keys ([ADR 0043](../../adr/0043-operator-runtime-read-path.md)); the per-customer isolation discipline the seam enforces is the same discipline the MCP surface inherits. We are not inventing a cross-customer code path; we are exposing one that already runs.
- **Per-customer Clerk apps + audience-bound tokens.** Each customer gets its own Clerk OAuth application (or RFC 8707 audience binding), so a token minted for one customer is structurally unusable against another's surface (§5).
- **No net-new data path (Phase 1).** The runtime-read seam **already** pulls audit and memory to the console today for the admin portal, so the Phase-1 surface (status, memory, assembled context) widens what flows over an existing path rather than opening a new one. **This holds only through Phase 1.** When document/matter tools land (`operator_surface_document`, Phase 2+), privileged work product the read-seam does _not_ carry today would begin transiting the Worker — a genuinely new data path. The privileged-into-personal consent gate (§7.2) is what bounds that, and in console hosting it must be enforced **at the console egress point**, because the console — not the Machine — is where that content crosses toward the user's Claude.

### 2.3 Durable alternative: on-Machine sidecar

When true single-tenant **physical** isolation is worth the per-Machine operational cost — a regulated client who wants the MCP surface to physically never run alongside another customer's state, or a deployment where privileged content must not transit the shared Worker at all — the same connector contract is hosted as a sidecar on the Machine instead. This is the durable/future option, not the Phase-1 default; it costs a public surface, a token store, and a supervised process on every Machine, which is why it is reserved for when the physical boundary earns its keep.

The Machine already runs a public HTTP front door: `webhook_gate.py`, a stdlib `ThreadingHTTPServer` bound to `0.0.0.0:8643` that (a) verifies inbound webhook signatures and forwards to the loopback Hermes adapter on `8644`, and (b) hosts the runtime-read seam `GET /runtime/<kind>` ([ADR 0043](../../adr/0043-operator-runtime-read-path.md)). That process family is the natural home for an on-Machine MCP surface. The sidecar is a **sibling HTTP surface in the gate process family** (extend the existing gate, or a parallel `mcp_gate.py` started by `bootstrap.sh` and supervised by tini in the same container), serving `POST /mcp` and `GET /.well-known/oauth-protected-resource` directly. In this hosting the endpoint physically cannot see another customer's state because it runs on a single-tenant Machine; reads come from the Machine's own stores rather than over the runtime-read seam, and handoffs are a loopback enqueue to `:8644` rather than a signed webhook from the console.

Because the contract is hosting-agnostic, moving from console-mediated to sidecar is a deployment change, not a redesign: the tool surface, both authz axes, the authority modes, the audit shape, and the memory-wall rule are identical.

### 2.4 Transport

MCP **Streamable HTTP** on `POST /mcp` (the current remote-server transport that claude.ai custom connectors and Claude Desktop speak; SSE is superseded). The connector is a JSON-RPC MCP server exposing `tools/list`, `tools/call`, and `resources/*`. In Phase-1 console hosting, TLS is terminated at the Worker edge and the surface is served from the public ss-console origin; in the on-Machine sidecar, TLS is terminated at the Fly edge and the gate binds `0.0.0.0`, reachable through the Fly proxy.

### 2.5 Reconciliation with isolation ADRs

- **[ADR 0007](../../adr/0007-per-customer-machine-isolation.md) (per-customer Machine).** One MCP surface serves exactly one client org, scoped to that customer's state. In the on-Machine sidecar the boundary is physical (single-tenant Machine, bound only to that customer's D1/R2/volume). In Phase-1 console hosting the boundary is the existing fleet boundary the runtime-read seam already enforces (per-customer HMAC keys) plus audience-bound tokens (§2.2); there is no multi-tenant routing, shared registry, or cross-customer join in either case.
- **[ADR 0010](../../adr/0010-per-customer-oauth-token-storage.md) (OAuth tokens on volume).** The inbound user→Operator credentials live separately from the Operator→vendor tokens at `/opt/data/oauth/`. In console hosting the inbound credential is the user's Clerk session and the audience-bound access token, managed by the console; in the on-Machine sidecar the inbound token store lives at `/opt/data/mcp-clients/` (`0600`, `hermes`-owned, never logged). The connector is an OAuth Resource Server for inbound users in either case; it never exposes the Operator's own vendor tokens.
- **[ADR 0043](../../adr/0043-operator-runtime-read-path.md) (runtime-read).** The connector follows the posture the runtime seam established: thin, authenticated, scoped to one customer, audited. Phase-1 console hosting reuses the seam directly to serve reads; the sidecar follows the same posture against the Machine's own stores.

---

## 3. The value surface: live context bundles

The most concrete value is not raw document retrieval. It is that the client is **hand-building a context system today** and we can replace it with a live one.

Our prospect curates a Project per case and sub-Projects per task cluster, dragging files in by hand. Those Projects are **static snapshots**: they go stale the moment a matter moves, and keeping them current is unpaid librarian work. This is the same shape as Crane Context inside our own enterprise (venture → notes/handoffs/memory, scoped) — a context spine organized by unit of work. The Operator already holds the live version of that context: it lives in the work record, the connected systems, and the Operator's memory.

So the value play: **the Operator becomes the context layer the client is building by hand, and the connector serves it into their Claude on demand, live instead of frozen.** Instead of curating a Project, the user pulls "the Henderson context" and gets the current state, scoped to the grain they think in (case → task cluster). The result: **he stops needing as many Projects, because he can pull a scoped bundle on demand.** This generalizes across verticals; "Project per case" is just the legal instance of "context bundle per unit of work" (campaign, account, policy, engagement).

**Mirror by default, propose when useful, never impose.** A good remote worker learns your filing system and adapts to it, occasionally proposes a better one, and never forces theirs on you. That sets the build order:

- **Now — retrieval by scope.** The connector serves context bundles at the grains the human already uses. It mirrors the client's organization; it does not invent one. This is the floor and it is what the pilot ships.
- **Later — maintained bundles (opt-in).** Letting the Operator keep the bundle current and propose structure ("want a cluster for the depo prep?") is a genuinely larger capability and a bigger value claim, sold exactly as a good assistant keeping the file organized. Additive, not foundational.

**Honest boundary.** MCP is pull: the client's Claude fetches; we cannot write into Claude's Project UI. The truthful pitch is "your Project becomes a live view backed by the Operator" or "you stop needing as many Projects," not "the Operator manages your Claude Projects for you."

---

## 4. The access model (the heart of the design)

The Operator is a **remote worker**. A real organization does not hand a remote worker a permission engine; it hands them logins, and the systems already encode who-sees-what. So we do not build access control — **we inherit the organization's.** Provision the Operator the way you onboard a remote hire: give it the accounts and role it needs, and the systems gate everything downstream.

The remote-worker principle governs two _different_ things, with opposite default postures. Keeping them separate dissolves most of the apparent complexity.

### 4.1 Two axes

**Axis 1 — Reach (what data and tasks can be touched).** Permissive and inherited. If a worker in that seat could reach it, the Operator can, and the connected systems do the gating. This is where flexibility lives. We do **not** maintain a per-user ACL as the primary mechanism; we choose which authority a request runs under and let the system of record answer "can this identity see this?"

**Axis 2 — Consequence (send, sign, delete, move money).** Restrictive and authored. A human worker _could_ send an email, but our posture is that the Operator drafts and a human sends. Consequence is governed by the authored entitlement ceilings (`shared/action_classes.py`), fail-closed, **regardless of what a human worker could do** ([ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md)). Nothing in the exposed tool surface is EXTERNAL_SEND/COMMITMENT/DESTRUCTIVE/CODE_EXECUTION; the one write (`operator_handoff_task`) is INTERNAL_WRITE.

The trap we repeatedly fell into was arguing one axis with the other ("a remote worker could send it, so the Operator can"). They are independent. **Reach is inherited-and-permissive; consequence is authored-and-restrictive.**

### 4.2 Authority mode (one knob, not a policy engine)

A request runs under one of three authorities, set per profile. This single field spans every access pattern a client org will present:

| Mode        | The request runs as…                                                | Real-world analog                                        |
| ----------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `operator`  | the Operator's own identity (sees what the Operator is entitled to) | a worker with their own org login; the system gates them |
| `requester` | the human who asked (sees exactly what they see)                    | an assistant acting in the named executive's name        |
| `group`     | the union of what a defined set of users can reach                  | one assistant serving a group of executives              |

`requester` mode is the cleanest for confidentiality because it **delegates to the system of record**: the Operator never re-derives who-sees-what; it acts on behalf of the requester and the downstream system enforces. We already run this — the managed-mailbox work has Crane act as `smdurgan@` via a per-op delegated subject, with the broker validating "is this identity authorized to act as that subject." `requester` mode is that mechanism generalized.

**Fallback when nothing is connected to delegate to:** an authored access map in `customer.yaml` (user → scopes), human-reviewed, fail-closed. No authored entry = empty reach. This is the exception path, not the default mechanism.

### 4.3 The wall sets the profile boundary (the one edge the systems do not cover)

A human remote worker has one brain; a discreet assistant serving Exec A and Exec B does not repeat A's business to B. The Operator's "brain" is a **store**, and the systems that gate live data do **not** gate the Operator's accumulated memory. Clio will stop B from reading A's matter, but it will not stop A's context from surfacing in the Operator's _memory_ when it answers B. This is the one place "delegate to the system" is necessary but not sufficient.

The load-bearing rule:

> **Systems gate the live data; the profile gates the memory.** Principals who may see each other's work can share a profile (one brain, shared memory). Principals who must be walled need **separate profiles** (separate brains, [ADR 0011](../../adr/0011-multi-persona-per-customer.md)).

This is why "lean into profiles" is correct, and it is the one multi-user rule the pilot must bake in even with a single user, because it is expensive to retrofit and easy to leak if ignored.

### 4.4 Why the connector stays thin

Because reach is inherited from the org's systems and walls are enforced at the profile, the connector adds **no new access surface**. When a user's Claude calls in, the connector authenticates the human, routes to the profile that serves them, applies the profile's authority mode, and lets the systems (or the authored fallback) gate the result. It is identity-passing plumbing exposing the _same worker_ through a _new door_, not a second access path to re-secure.

### 4.5 What is solid, what is a stretch (lay of the land)

So we guide rather than guess in the room:

- **Solid:** a single principal; a group that shares access (one profile, one brain); an assistant-to-executives **where the system supports delegation** — Google Workspace domain-wide delegation and Microsoft Graph do, and we already run that pattern.
- **Stretch / pitfall:** systems that do **not** support delegation at the grain we need. There, `requester` mode is not free; we fall back to the authored map, or we tell the client plainly that we cannot safely serve multiple walled principals through that system. Knowing this before the meeting is the difference between guiding and guessing.

---

## 5. Authentication

### 5.1 Roles (per MCP authorization spec, 2025-11-25)

A protected MCP server is an **OAuth 2.1 Resource Server**. The MCP client (the user's Claude) is the OAuth client. The authorization server issues tokens and is out of the MCP server's scope. MCP servers **must** implement OAuth 2.0 Protected Resource Metadata (`/.well-known/oauth-protected-resource`) whose `authorization_servers` field names the AS. We delegate the AS role to **Clerk** rather than building or maintaining one: the console manages the per-customer Clerk OAuth application and the `users[]` allowlist, but it does **not** implement `authorize` / `token` / JWKS endpoints. Clerk does. Tokens are validated against **Clerk's JWKS**.

| Role                 | Who                                                 | Responsibility                                                                                                                                 |
| -------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization Server | **Clerk** (per-customer OAuth application)          | Hosts `authorize` / `token` / JWKS; authenticates the user, issues access tokens. We do not build or run an AS.                                |
| Console              | **SMD console** (`admin.smd.services`, Clerk RP)    | Manages the per-customer Clerk OAuth application and the `customer.yaml.users[]` allowlist; resolves user → profile + authority mode + posture |
| Resource Server      | **the `/mcp` endpoint** (console-hosted in Phase 1) | Validate token against Clerk's JWKS, resolve subject → org user + profile + authority mode, enforce both axes, serve tools                     |
| Client               | the user's **Claude** (claude.ai / Desktop)         | OAuth 2.1 Authorization Code + PKCE against the Clerk AS                                                                                       |

Per-customer isolation at the token layer is the canonical resource URI plus mandatory RFC 8707 audience validation. A Clerk client ID is optional provenance and never substitutes for the audience check.

### 5.2 Flow

1. User adds the customer-specific resource URL, for example `https://smd.services/api/operator/smd/mcp`.
2. Claude fetches the matching protected-resource metadata, which names exactly one Clerk issuer.
3. Claude runs OAuth Authorization Code + PKCE against Clerk and includes the canonical resource parameter.
4. The console verifies the signature against the configured issuer's pinned JWKS, then requires exact issuer and audience.
5. Operator maps token `sub` to `users.clerk_user_id`, conditionally enforces `entities.clerk_org_id`, resolves the authored profile, and only then creates a customer-scoped runtime capability.

### 5.3 The principal for the reach gate

The reach gate (§4.1) authorizes against the identity implied by the profile's `authority_mode`: the requesting user (`requester`), the Operator identity (`operator`), or the group (`group`). The audit (§8) records **both** the human who asked and the authority the request ran under. This is the hinge that prevents the confused-deputy failure: we never authorize reach against the bare agent identity; we authorize against the human-or-authority the mode names, and the systems gate it.

The connector never accepts an unauthenticated `tools/call`. Missing/expired/wrong-audience token → JSON-RPC error, fail-closed, audited as a refused call.

---

## 6. Tool surface

All tools are read/surface-oriented except `operator_handoff_task`. Each declares an action class (Axis 2) and a reach scope (Axis 1, resolved per the profile's authority mode and gated by the connected system or the authored fallback). Nouns are vertical-agnostic; the legal instance is shown as an example.

| Tool                        | Action class   | Reach scope                 | Behavior                                                                                                                                                                                                            |
| --------------------------- | -------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operator_list_scopes`      | READ           | reach-gated                 | List the context bundles (units of work) the caller may reach, at the grain they organize by (e.g. matters, and task clusters within them). The index behind §3.                                                    |
| `operator_get_context`      | READ           | reach-gated                 | Return a scoped context bundle (summary/status for a unit of work). No-system: assembled from email + memory. System-connected: live record. Provenance-tagged (`assembled` vs `system_of_record`).                 |
| `operator_list_documents`   | READ           | reach-gated + content-class | List documents the Operator can access for a reachable unit of work. Sensitive classes (e.g. privileged) appear only where the client's `data_posture` permits (§7).                                                |
| `operator_surface_document` | READ           | reach-gated + content-class | Retrieve a specific document (content or a fetchable reference), subject to the same content floors as any other surface.                                                                                           |
| `operator_search_memory`    | READ           | reach-gated                 | Read the Operator's operating memory (Honcho mirror / per-customer D1) scoped to the caller's reachable work — and walled at the profile per §4.3.                                                                  |
| `operator_handoff_task`     | INTERNAL_WRITE | reach-gated                 | Hand a task to the Operator. Creates an internal work request (provenance-stamped inbound item). Does **not** author or send client-facing content. The Operator works it async and reports over its channels (§7). |
| `operator_status`           | READ           | self-scoped                 | Liveness + queue status for **this caller's** handoffs. No cross-user visibility.                                                                                                                                   |

**Deliberately excluded:** any send, draft-for-recipient, sign/accept, delete, or code-execution tool. Memory **write** from the connector is designed (INTERNAL_WRITE, authored opt-in) but excluded from MVP (§9). `operator_handoff_task` is the only state-changing tool and is taint-aware (§6.1).

### 6.1 Trust class and taint

Inbound MCP calls are authenticated org users, so the provenance envelope (`shared/inbound.py`) stamps `surface="mcp"`, `trust_class="known_external"` (an authenticated user is above anonymous webhook content but is not "internal" agent context). A handoff's free-text payload is untrusted content the same way an email body is: it enters the nonce-fenced quarantine wrap and marks `SessionTaint` on the resulting agent session. So a handoff cannot, by itself, drive the agent to autonomously send or destroy — the existing taint-gate already refuses EXTERNAL_SEND/DESTRUCTIVE/COMMITMENT/CODE_EXECUTION on a tainted session. The connector inherits that defense for free by routing handoffs through the same chokepoint webhooks use.

### 6.2 Relationship to the capability broker

For tools that touch a mediated connector (e.g. a live system record), the connector does **not** hold raw vendor credentials and does **not** re-implement provider access. It calls the first-class, broker-mediated Hermes read tools ([ADR 0045](../../adr/0045-mediated-connector-capability-broker.md)); the broker remains the only holder of connector credentials and the only writer of the broker audit ledger. The connector is a caller of mediated reads, never a second path around the broker.

---

## 7. Bidirectionality and data governance

### 7.1 Bidirectionality (no over-promising)

**`user → Operator` (synchronous, over MCP):** read tools answer synchronously and directly from per-customer stores (and broker-mediated reads), no agent wake, which keeps them fast and matches "surface, don't draft." `operator_handoff_task` returns a synchronous acknowledgement (`{accepted, handoff_id}`); the work itself is asynchronous.

**`Operator → user` (asynchronous, NOT over MCP):** proactive output (a completed handoff, a status nudge) is delivered over the Operator's existing channels (email, Telegram), per how the client authored its surfaces. There is no server-initiated push into a live Claude session, and we do not design one; even MCP server notifications would not reach a Claude session the user has closed.

**What "exchange in one session" honestly means:** the user **pulls** repeatedly (ask, retrieve, surface a document, hand off, check status); the Operator's **proactive** contributions land in the user's inbox/Telegram, which they can re-surface into Claude. The loop is real and useful; it is pull-plus-channels, not live duplex over the MCP link.

### 7.2 Data governance — flexible by default, the client may tighten

Whether org data should flow into a given user's Claude, and under what terms, is a **client-policy decision**, not an engineering default. Two things were previously conflated and must stay separate:

- **What a user can see** (reach): always fail-closed and inherited (§4). Non-negotiable.
- **Which Claude surface entitled data may land in** (personal vs. firm-controlled account): a lower-stakes data-handling knob.

On that second knob the onus is on us to be **flexible**. Organizations are mid-adoption with a mix of personal and firm-controlled Claude instances; gating the surface on "enterprise account only" would block real users on day one. So the un-configured default is **open** — entitled data may flow to whatever Claude the user authenticated with — and the client may author a stricter posture.

This does not contradict [ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md): fail-closed governs entitled _access and consequential actions_; the surface-destination knob is a data-handling preference, where defaulting open and letting the client tighten is the flexible, correct posture.

| `data_posture`                | Effect                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open` (default)              | Entitled data may flow to the user's authenticated Claude, personal or firm-controlled. **Privileged-class content** (matter documents, work product) crossing into a **personal** Claude account requires an explicit recorded firm consent even under `open` (see below). |
| `firm_only` (client-authored) | Entitled data flows only to an enterprise/team Claude under the org's terms; personal-account tokens get a reduced surface (own handoffs + non-privileged status).                                                                                                          |

**The privileged-into-personal carve-out.** Even under `open`, releasing **privileged-class** content (matter documents, work product) into a **personal** Claude account is a firm professional-responsibility decision, not a default the engineering layer should make silently. So `open` permits non-privileged entitled data to flow freely, but privileged-class content crossing into a personal account requires an **explicit recorded firm consent** on file. In console hosting the enforcement point is the **console egress** — the console is where document-surfacing tools (`operator_list_documents` / `operator_surface_document`, §6) assemble their result and where that content crosses toward the user's Claude, so the consent check must gate the response there, not on the Machine. Since no document tools ship in Phase 1, the enforcement point is **deferred** to when those tools land, and the carve-out is recorded here so it is built in at the egress, not retrofitted. (Under the durable on-Machine sidecar the egress point is the Machine instead; the rule is the same — gate at whichever surface emits the content.) The distinction is content **class** (privileged vs. not) crossed with account **type** (personal vs. firm-controlled), independent of the broader `open`/`firm_only` knob.

**The conversation we surface, not force.** For regulated clients (the legal pilot included) we _offer_ the `firm_only` posture and name the privilege/retention trade-off: releasing privileged work product into a personal AI account, outside the firm's control and retention terms, can carry waiver and confidentiality risk. The connector itself logs **digests only**, never content (§8); content that crosses into the user's Claude is governed by that account's terms, which is exactly why the knob exists. The client decides; the design enforces whatever they choose.

---

## 8. Audit

Every interaction is recorded in the **broker-owned, tamper-resistant audit ledger** already running on the Machine. The connector emits through the broker audit client (`shared/broker_audit.py` / `shared/audit_client.py`); it never writes its own log, consistent with the broker-owns-the-ledger invariant.

New `action_type` rows (digest-only, never content):

- `MCP_TOOL_CALL` — `sub` (who asked), `authority_mode` and the effective authority the request ran under, `profile`, `tool`, `action_class`, decision (`allowed`/`refused`), reach scope touched (digest), `data_posture`, `result_provenance` (`assembled`/`system_of_record`), `item_id`.
- `MCP_AUTH` — token validation outcomes (audience mismatch, expiry, refusal), so a probing or stolen-token attempt is visible.
- `MCP_HANDOFF` — handoff accepted (`handoff_id`, scope), correlatable with the downstream agent session and its channel reply.

Recording **both** the human who asked and the authority a request ran under is essential in `requester` and `group` modes (§4.2) and reuses the managed-mailbox "acted-as-subject-on-behalf-of" shape. The runtime-read seam ([ADR 0043](../../adr/0043-operator-runtime-read-path.md)) already exposes `audit_log` to the console, so these rows surface in the admin portal with no new read path.

---

## 9. Scenario degradation and phasing

### 9.1 Degradation by scenario

Tool **names are identical** across scenarios; only the data source and the reach authority change, and every result is provenance-tagged.

| Capability     | No-system (email + memory only)                             | System-connected (PMS/AMS/Workspace live)                  |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Context bundle | Assembled from email + user-supplied docs + Operator memory | Plus the live system-of-record                             |
| Reach gate     | Authored access map (fallback, §4.2)                        | Delegated to the system under the profile's authority mode |
| Documents      | What the Operator received / the user supplied              | Plus the system document store (broker-mediated read)      |
| Provenance tag | `assembled`                                                 | `system_of_record`                                         |

This is why the connector is strategically robust: value on day one without a system API, richer (not rebuilt) when one lands.

### 9.2 Phasing — settle the design now, build the pilot now

The pilot exercises none of the multi-user machinery, but the design is **settled and the seams are seated** now, so a multi-principal client is a configuration, not a re-architecture.

**Seated now (seams + the one rule, not features):**

- Profile carries an `authority_mode` field; the pilot is `requester` with a single requester.
- The connector passes the human's identity through and records both identities in audit (§8).
- Memory walled at the profile (§4.3), even with one profile.

**Phase 0 — client-policy gate (no code).** The client rules on data governance (§7.2): default `open` or authored `firm_only`. The authored access fallback and any profile walls are set and human-reviewed.

**Phase 1 — MVP: read/surface-only, single user.** The litigator is the sole authorized user, `requester` mode, no-system scenario (email + memory + user-supplied docs), the six READ tools only (`operator_handoff_task` deferred), full audit. This validates the three hardest things (transport + OAuth, the reach gate, data-governance enforcement) with **zero write risk**, and matches read-and-highlight, never draft.

**Phase 2 — add the handoff and the live record.** Introduce `operator_handoff_task` (async, INTERNAL_WRITE, taint-aware) once reads are proven; wire system-connected reads when the connector track lands (separate track). Handoff is what makes it feel like exchange, so it is the natural Phase 2 headline.

**Phase 3 — broader rollout.** Multiple users and profiles, `group` mode where a system supports delegation, walls across the user population, optional maintained context bundles (§3) and the opt-in memory-write tool.

### 9.3 Risks

| Risk                                                                                              | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Confused deputy** (authorizing on the agent, not the human/authority)                           | Reach gate authorizes against the authority the profile's mode names; both identities audited (§5.3, §8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Cross-principal memory leak** (systems gate data, not the Operator's memory)                    | The wall sets the profile boundary: walled principals get separate profiles/brains (§4.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Reach over-grant**                                                                              | Default is delegate-to-system; authored map is fail-closed and human-reviewed; never widened by the connector (§4.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Privilege/retention exposure via personal account**                                             | Client-authored `firm_only` posture offered and explained; connector logs digests only (§7.2, §8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Token theft / replay**                                                                          | Audience-bound to one customer (per-customer Clerk app / RFC 8707), short TTL + refresh, validated against Clerk's JWKS, refusals audited (§5).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Cross-customer isolation in shared host** (Phase-1 console hosting)                             | Isolation enforced in console code over the existing fleet boundary (per-customer HMAC seam), not a new data path; per-customer Clerk apps + audience-bound tokens; durable sidecar restores physical single-tenancy when warranted (§2.3).                                                                                                                                                                                                                                                                                                                              |
| **Untrusted MCP client** (the user's Claude is a client we do not control)                        | Inbound stamped `known_external`; handoff payload quarantine-wrapped and taints the session; taint-gate blocks autonomous sensitive actions (§6.1).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Customer-routing confused deputy** (caller requests one resource with another resource's token) | The route selects the requested resource only. Exact issuer, audience, subject, and conditional organization checks must independently authorize that same resource before runtime access.                                                                                                                                                                                                                                                                                                                                                                               |
| **Wrong-`aud` token accepted** (one console validates tokens for all customers)                   | Reject before any data access when `aud` does not match the resolved customer; per-customer Clerk app / RFC 8707 audience binding; the highest-leverage required test is a valid-but-wrong-`aud` token returning 401 (§2.1, §5).                                                                                                                                                                                                                                                                                                                                         |
| **Handoff-webhook secret compromise** (console→Machine work injection is a new authority)         | `WEBHOOK_SECRET_MCP` is per-customer-derived (`HMAC(master, slug)`, AgentMail pattern), so a leak is one-customer-scoped; injected work is taint-marked, so the taint-gate still blocks autonomous send/destroy/exec (§2.1, §6.1).                                                                                                                                                                                                                                                                                                                                       |
| **Delegation not supported by a system**                                                          | Named upfront (§4.5): fall back to authored map, or decline multi-walled-principal service through that system.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Availability**                                                                                  | Console hosting: the surface rides the already-public console; a Machine being down degrades that customer's reads, not the endpoint — but the console is then a **shared point of failure** for the MCP surface across all customers (the sidecar fails per-customer instead). Acceptable because the console is already the shared dependency for the portal. Sidecar hosting: Machine down = that endpoint down, no cross-customer fallback (correct per [ADR 0007](../../adr/0007-per-customer-machine-isolation.md)), co-located with the gate and tini-supervised. |

### 9.4 External verification harness (no root-SSH)

Verification follows the established runtime-read verify-gate posture: exercise the deployed surface over HTTPS, never hand-poke a live Machine over SSH (root-SSH on a live Machine writes root-owned artifacts that break the agent bootstrap). Against the deployed `/mcp` endpoint the required harness is a token triple, all over HTTPS:

1. **Valid token for customer X → 200** carrying only X's data (happy path).
2. **Valid token, wrong `aud` → 401** before any data access (the cross-customer-acceptance guard, §2.1 / §9.3).
3. **Valid token for X, path/body naming customer Y → 401 or X-only** (the customer-routing confused-deputy guard, §2.1 / §9.3).

The harness cannot run until the endpoint ships; it is specified here so it is built alongside the surface, not after. Flagged for the implementation track.

---

## 10. Open questions for Captain

1. **Authorization Server placement. Resolved: Clerk.** Clerk authenticates and issues resource-bound tokens. Operator remains the authorization authority and never accepts issuer-only tokens.
2. **Maintained context bundles (§3).** Confirm the build order: ship retrieval-by-scope (mirror) for the pilot, treat Operator-maintained/proposed bundles as a later opt-in upgrade.
3. **MVP write boundary.** Recommendation is Phase 1 = pure read/surface, handoff in Phase 2. Confirm, or fold handoff into MVP since "accept hand-offs" is in the objective.
4. **New `customer.yaml` blocks.** This introduces at least `mcp_connector` (enable/port/profile binding), an `authority_mode` per profile, an authored `access_map` fallback, and `data_posture`. All must be registered in `operator/contracts/customer-yaml-blocks.yaml` (CI fails on an unclassified block) and given materializers in `translate.py` before authoring. Flagged for the implementation track, not built here.

---

## 11. Out of scope

Implementation; the system-of-record connector track (`mcp:clio` / `mcp:smokeball` / etc.); any drafting or send capability beyond surfacing; the Clerk OAuth-application setup and console-side allowlist wiring (configuration, not an Authorization Server build — we do not build an AS, §5); the on-Machine sidecar hosting build (durable alternative, §2.3); the per-profile multi-user access materializers (seated here, built when a multi-user client lands); the admin/client portal surface for issuing and revoking connector access (a natural follow-on to [01-admin-portal.md](01-admin-portal.md) / [02-client-portal.md](02-client-portal.md)).
