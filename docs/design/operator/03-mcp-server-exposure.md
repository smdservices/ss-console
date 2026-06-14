# 03 — Operator ⇄ Claude MCP Connector (Operator-as-MCP-Server)

**Status:** Draft for Captain review (rev 2, 2026-06-14)
**Author:** design pass, no implementation
**Companion docs:** [00-foundations.md](00-foundations.md), [01-admin-portal.md](01-admin-portal.md), [02-client-portal.md](02-client-portal.md)
**Primary ADRs:** [0007](../../adr/0007-per-customer-machine-isolation.md) · [0010](../../adr/0010-per-customer-oauth-token-storage.md) · [0011](../../adr/0011-multi-persona-per-customer.md) · [0015](../../adr/0015-hermes-fork-posture.md) · [0020](../../adr/0020-connector-strategy.md) · [0035](../../adr/0035-no-imposed-entitlement-defaults.md) · [0043](../../adr/0043-operator-runtime-read-path.md) · [0045](../../adr/0045-mediated-connector-capability-broker.md) · [0005](../../adr/0005-external-send-identity.md) · [0037](../../adr/0037-operator-thesis.md)

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

### 2.1 The decision: gateway-adjacent sidecar, not a Hermes plugin, never core

The Machine already runs a public HTTP front door: `webhook_gate.py`, a stdlib `ThreadingHTTPServer` bound to `0.0.0.0:8643` that (a) verifies inbound webhook signatures and forwards to the loopback Hermes adapter on `8644`, and (b) hosts the runtime-read seam `GET /runtime/<kind>` ([ADR 0043](../../adr/0043-operator-runtime-read-path.md)). That process family is the natural home for an MCP surface. The connector is a **sibling HTTP surface in the gate process family** (extend the existing gate, or a parallel `mcp_gate.py` started by `bootstrap.sh` and supervised by tini in the same container).

Why not the other two options:

- **Not a Hermes plugin.** A plugin runs inside the agent loop. It cannot reliably serve HTTP while the agent is mid-turn, and it cannot enforce authentication and authorization _before_ Hermes is involved. The gate layer is precisely the "outside the agent loop" boundary. ([ADR 0015](../../adr/0015-hermes-fork-posture.md): plugins never touch core; the gate is already overlay-owned infrastructure, not a core patch.)
- **Not core Hermes.** [ADR 0015](../../adr/0015-hermes-fork-posture.md) is absolute: pin-only fork, plugin-only overlay, no core modification. The connector introduces no Hermes-core change.

```
                         per-customer Fly Machine (one client org)
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                    │
  │   :8643  gate process family (0.0.0.0, public via Fly proxy/TLS)   │
  │   ┌──────────────────────────────────────────────────────────┐    │
  │   │  POST /webhooks/<route>     (existing, Svix-verified)     │    │
  │   │  GET  /runtime/<kind>       (existing, ADR 0043 seam)     │    │
  │   │  POST /mcp                  (NEW: MCP Streamable HTTP)    │    │
  │   │  GET  /.well-known/oauth-protected-resource (NEW)        │    │
  │   └───────────────┬──────────────────────────────────────────┘    │
  │                   │ (1) authenticate the human → resolve profile   │
  │                   │ (2) REACH gate (inherit/delegate, §4) +        │
  │                   │     CONSEQUENCE gate (authored ceiling, §4)    │
  │                   │ (3) emit audit: who asked + authority it ran   │
  │      ┌────────────┴───────────────┬───────────────────────────┐   │
  │      │ READ / surface tools       │ HANDOFF tool               │   │
  │      │ answer directly from       │ enqueue provenance-stamped │   │
  │      │ per-customer stores +      │ InboundEnvelope(surface=   │   │
  │      │ broker-mediated reads      │ "mcp") → loopback :8644    │   │
  │      │ (no agent wake)            │ → agent works async        │   │
  │      └────────────┬───────────────┴─────────────┬─────────────┘   │
  │                   │                              │                 │
  │   /opt/data: audit ledger, memory mirror,        │  Hermes agent   │
  │   mcp-client tokens, authored access fallback    │  loop (:8644)   │
  │                                                  ▼                 │
  │                         Operator → user reply goes out over        │
  │                         email / Telegram, NOT over /mcp            │
  └──────────────────────────────────────────────────────────────────┘
```

### 2.2 Transport

MCP **Streamable HTTP** on `POST /mcp` (the current remote-server transport that claude.ai custom connectors and Claude Desktop speak; SSE is superseded). The connector is a JSON-RPC MCP server exposing `tools/list`, `tools/call`, and `resources/*`. TLS is terminated at the Fly edge; the gate already binds `0.0.0.0` and is reachable through the Fly proxy.

### 2.3 Reconciliation with isolation ADRs

- **[ADR 0007](../../adr/0007-per-customer-machine-isolation.md) (per-customer Machine).** One MCP server = one client-org Machine, bound only to that customer's D1/R2/volume. No multi-tenant routing, no shared registry, no cross-customer join. The endpoint physically cannot see another customer's state because it runs on a single-tenant Machine.
- **[ADR 0010](../../adr/0010-per-customer-oauth-token-storage.md) (OAuth tokens on volume).** The inbound user→Operator credentials are a **separate token store** at `/opt/data/mcp-clients/` from the Operator→vendor tokens at `/opt/data/oauth/`. The connector is an OAuth Resource Server for inbound users; it never exposes the Operator's own vendor tokens. `0600`, `hermes`-owned, never logged.
- **[ADR 0043](../../adr/0043-operator-runtime-read-path.md) (runtime-read).** The connector follows the posture the runtime seam established: thin, authenticated, scoped to one customer, audited. The seam's per-customer `HMAC(master, slug)` pattern is the model for token validation (§5).

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

A protected MCP server is an **OAuth 2.1 Resource Server**. The MCP client (the user's Claude) is the OAuth client. The authorization server issues tokens and is out of the MCP server's scope. MCP servers **must** implement OAuth 2.0 Protected Resource Metadata (`/.well-known/oauth-protected-resource`) whose `authorization_servers` field names the AS. We use that delegation rather than running a full OAuth Authorization Server on every Machine:

| Role                 | Who                                                  | Responsibility                                                                                        |
| -------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Authorization Server | **SMD console** (`admin.smd.services`, Clerk-backed) | User login, consent, mint access tokens audience-bound to a specific Machine + profile + user         |
| Resource Server      | **the Machine's `/mcp` endpoint**                    | Validate token, resolve subject → org user + profile + authority mode, enforce both axes, serve tools |
| Client               | the user's **Claude** (claude.ai / Desktop)          | OAuth 2.1 Authorization Code + PKCE against the console AS                                            |

### 5.2 Flow

1. User adds the Operator as a custom connector in their Claude, pointing at `https://<machine-host>/mcp`.
2. Claude fetches `/.well-known/oauth-protected-resource`; it names the console as `authorization_servers[0]`.
3. Claude runs OAuth 2.1 Authorization Code + PKCE against the console. The console authenticates the user (Clerk identity per the shared-identity model in [00-foundations.md](00-foundations.md)), confirms the user is in this customer's `customer.yaml.users[]`, and mints a token whose claims include: `sub` = user email, `aud` = this Machine's resource id, `profile` = the profile that serves them, `authority_mode` (§4.2), and a `data_posture` claim (§7).
4. Claude presents the token on every `POST /mcp` call. The Machine validates it (signature against the console JWKS, or introspection) and rejects any token whose `aud` is not this Machine. Short TTL (for example 1 hour) with refresh; tokens are bound to one customer by audience.

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

| `data_posture`                | Effect                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `open` (default)              | Entitled data may flow to the user's authenticated Claude, personal or firm-controlled.                                                                            |
| `firm_only` (client-authored) | Entitled data flows only to an enterprise/team Claude under the org's terms; personal-account tokens get a reduced surface (own handoffs + non-privileged status). |

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

| Risk                                                                           | Mitigation                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confused deputy** (authorizing on the agent, not the human/authority)        | Reach gate authorizes against the authority the profile's mode names; both identities audited (§5.3, §8).                                                                       |
| **Cross-principal memory leak** (systems gate data, not the Operator's memory) | The wall sets the profile boundary: walled principals get separate profiles/brains (§4.3).                                                                                      |
| **Reach over-grant**                                                           | Default is delegate-to-system; authored map is fail-closed and human-reviewed; never widened by the connector (§4.2).                                                           |
| **Privilege/retention exposure via personal account**                          | Client-authored `firm_only` posture offered and explained; connector logs digests only (§7.2, §8).                                                                              |
| **Token theft / replay**                                                       | Audience-bound to one Machine, short TTL + refresh, validated against console JWKS, refusals audited (§5).                                                                      |
| **Untrusted MCP client** (the user's Claude is a client we do not control)     | Inbound stamped `known_external`; handoff payload quarantine-wrapped and taints the session; taint-gate blocks autonomous sensitive actions (§6.1).                             |
| **Delegation not supported by a system**                                       | Named upfront (§4.5): fall back to authored map, or decline multi-walled-principal service through that system.                                                                 |
| **Availability**                                                               | Machine down = endpoint down, no cross-customer fallback (correct per [ADR 0007](../../adr/0007-per-customer-machine-isolation.md)). Co-located with the gate, tini-supervised. |

---

## 10. Open questions for Captain

1. **Authorization Server placement.** Design puts the AS at the SMD console (reuse Clerk). Confirm, versus a minimal AS per Machine (more isolation, more surface).
2. **Maintained context bundles (§3).** Confirm the build order: ship retrieval-by-scope (mirror) for the pilot, treat Operator-maintained/proposed bundles as a later opt-in upgrade.
3. **MVP write boundary.** Recommendation is Phase 1 = pure read/surface, handoff in Phase 2. Confirm, or fold handoff into MVP since "accept hand-offs" is in the objective.
4. **New `customer.yaml` blocks.** This introduces at least `mcp_connector` (enable/port/profile binding), an `authority_mode` per profile, an authored `access_map` fallback, and `data_posture`. All must be registered in `operator/contracts/customer-yaml-blocks.yaml` (CI fails on an unclassified block) and given materializers in `translate.py` before authoring. Flagged for the implementation track, not built here.

---

## 11. Out of scope

Implementation; the system-of-record connector track (`mcp:clio` / `mcp:smokeball` / etc.); any drafting or send capability beyond surfacing; the console-side Authorization Server build; the per-profile multi-user access materializers (seated here, built when a multi-user client lands); the admin/client portal surface for issuing and revoking connector access (a natural follow-on to [01-admin-portal.md](01-admin-portal.md) / [02-client-portal.md](02-client-portal.md)).
