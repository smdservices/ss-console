# 03 — Operator ⇄ Claude MCP Bridge (Operator-as-MCP-Server)

**Status:** Draft for Captain review (2026-06-13)
**Author:** design pass, no implementation
**Companion docs:** [00-foundations.md](00-foundations.md), [01-admin-portal.md](01-admin-portal.md), [02-client-portal.md](02-client-portal.md)
**Primary ADRs:** [0007](../../adr/0007-per-customer-machine-isolation.md) · [0010](../../adr/0010-per-customer-oauth-token-storage.md) · [0011](../../adr/0011-multi-persona-per-customer.md) · [0015](../../adr/0015-hermes-fork-posture.md) · [0020](../../adr/0020-connector-strategy.md) · [0035](../../adr/0035-no-imposed-entitlement-defaults.md) · [0043](../../adr/0043-operator-runtime-read-path.md) · [0045](../../adr/0045-mediated-connector-capability-broker.md) · [0005](../../adr/0005-external-send-identity.md) · [0037](../../adr/0037-operator-thesis.md)

---

## 1. Purpose and origin

A prospect's decision-maker (a litigator) already runs a disciplined personal Claude workflow: one Project per case, files pulled in, AI used to **read and highlight, never to draft**. He asked whether firm users could exchange back-and-forth with the Operator from inside their own Claude (claude.ai / Claude Desktop).

This document designs the connector that answers that: a per-firm bridge that lets the Operator **expose itself as an MCP server** so a firm user's own Claude can query firm/matter context, surface documents, hand work to the Operator, and check status. It is the inverse of everything we have built so far. Today the Operator **consumes** MCP (connectors are wired as Hermes child processes in `bootstrap/mcp_registry.py` per [ADR 0020](../../adr/0020-connector-strategy.md)/0021). Here the Operator **serves** MCP to an external client. That inversion is the core design problem and is treated as green-field: no `/mcp`, `fastmcp`, or SSE machinery exists in the overlay today (verified 2026-06-13).

**Strategic note.** This bridge is a value path that survives the customer _not_ upgrading their practice-management API. In the no-API scenario it still serves email-derived context, user-supplied documents, and shared memory. It is also a direct expression of the Operator thesis ([ADR 0037](../../adr/0037-operator-thesis.md) Tenet 2): the substrate is valuable because it is **connectable** to whatever interface the user already lives in. The user already lives in Claude.

### Framing constraints this design respects

1. **Surface, don't draft.** Every tool is read/retrieve/surface-oriented and matches the user's discipline. Drafting and sending stay out of scope; the one state-changing tool (`operator_handoff_task`) creates an internal work request, it does not author or send client-facing content.
2. **Direction reality.** `user → Operator` is the clean MCP path (the user's Claude calls Operator tools synchronously). `Operator → user` (proactive) goes over the Operator's **existing channels** (email, Telegram), not the MCP link. We do not promise live server-push into a Claude session. Section 6 makes this precise.
3. **No imposed defaults** ([ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md)). Absence of authored access is REFUSE, never a "safe default" that leaks. A firm user with no authored matter access reaches zero matters.

---

## 2. Where the bridge sits

### 2.1 The decision: gateway-adjacent sidecar, not a Hermes plugin, never core

The Machine already runs a public HTTP front door: `webhook_gate.py`, a stdlib `ThreadingHTTPServer` bound to `0.0.0.0:8643` that (a) verifies inbound webhook signatures and forwards to the loopback Hermes adapter on `8644`, and (b) hosts the runtime-read seam `GET /runtime/<kind>` ([ADR 0043](../../adr/0043-operator-runtime-read-path.md)). That process family is the natural and correct home for an MCP surface. The bridge is a **sibling HTTP surface in the gate process family** (extend the existing gate, or a parallel `mcp_gate.py` started by `bootstrap.sh` and supervised by tini in the same container).

Why not the other two options:

- **Not a Hermes plugin.** A plugin runs inside the agent loop. It cannot reliably serve HTTP while the agent is mid-turn, and it cannot enforce authentication _before_ Hermes is involved. The whole point of the gate layer is to be the "outside the agent loop" boundary. ([ADR 0015](../../adr/0015-hermes-fork-posture.md): plugins never touch core; the gate is already overlay-owned infrastructure, not a core patch.)
- **Not core Hermes.** [ADR 0015](../../adr/0015-hermes-fork-posture.md) is absolute: pin-only fork, plugin-only overlay, no core modification. The bridge introduces no Hermes-core change.

```
                         per-customer Fly Machine (one firm)
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                    │
  │   :8643  gate process family (0.0.0.0, public via Fly proxy/TLS)   │
  │   ┌──────────────────────────────────────────────────────────┐    │
  │   │  POST /webhooks/<route>     (existing, Svix-verified)     │    │
  │   │  GET  /runtime/<kind>       (existing, ADR 0043 seam)     │    │
  │   │  POST /mcp                  (NEW: MCP Streamable HTTP)    │    │
  │   │  GET  /.well-known/oauth-protected-resource (NEW)        │    │
  │   └───────────────┬──────────────────────────────────────────┘    │
  │                   │ (1) validate OAuth token (RS) + resolve user   │
  │                   │ (2) authz: action-class × per-user access map  │
  │                   │ (3) emit audit (broker-owned ledger)           │
  │      ┌────────────┴───────────────┬───────────────────────────┐   │
  │      │ READ tools                 │ HANDOFF tool               │   │
  │      │ answer directly from       │ enqueue provenance-stamped │   │
  │      │ per-customer stores +      │ InboundEnvelope(surface=   │   │
  │      │ broker-mediated reads      │ "mcp") → loopback :8644    │   │
  │      │ (no agent wake)            │ → agent works async        │   │
  │      └────────────┬───────────────┴─────────────┬─────────────┘   │
  │                   │                              │                 │
  │   /opt/data: audit ledger, memory mirror,        │  Hermes agent   │
  │   mcp-client tokens, authored access map         │  loop (:8644)   │
  │                                                  ▼                 │
  │                         Operator → user reply goes out over        │
  │                         email / Telegram, NOT over /mcp            │
  └──────────────────────────────────────────────────────────────────┘
```

### 2.2 Transport

MCP **Streamable HTTP** on `POST /mcp` (the current remote-server transport that claude.ai custom connectors and Claude Desktop speak; SSE is superseded). The bridge is a JSON-RPC MCP server exposing `tools/list`, `tools/call`, and `resources/*`. TLS is terminated at the Fly edge in front of the Machine; the gate already binds `0.0.0.0` and is reachable through the Fly proxy.

### 2.3 Reconciliation with isolation ADRs

- **[ADR 0007](../../adr/0007-per-customer-machine-isolation.md) (per-customer Machine).** One MCP server = one firm Machine, bound only to that customer's D1/R2/volume. No multi-tenant routing, no shared MCP registry, no cross-customer join. The endpoint physically cannot see another customer's state because it runs on a single-tenant Machine.
- **[ADR 0010](../../adr/0010-per-customer-oauth-token-storage.md) (OAuth tokens on volume).** The firm-user→Operator credentials are a **separate token store** at `/opt/data/mcp-clients/` from the Operator→vendor tokens at `/opt/data/oauth/`. The bridge is an OAuth Resource Server for inbound firm users; it never exposes the Operator's own vendor tokens (see §3.3 and §4). `0600`, `hermes`-owned, never logged.
- **[ADR 0043](../../adr/0043-operator-runtime-read-path.md) (runtime-read).** The bridge follows the same posture the runtime seam established: thin, authenticated, scoped to one customer, audited. The seam's per-customer `HMAC(master, slug)` bearer pattern is the model for token validation (§3.2).

---

## 3. Authentication

### 3.1 Roles (per MCP authorization spec, 2025-11-25)

A protected MCP server is an **OAuth 2.1 Resource Server**. The MCP client (the user's Claude) is the OAuth client. The authorization server issues tokens and is explicitly out of the MCP server's scope. MCP servers **must** implement OAuth 2.0 Protected Resource Metadata (`/.well-known/oauth-protected-resource`) whose `authorization_servers` field names the AS.

We use that delegation rather than running a full OAuth Authorization Server on every Machine:

| Role                 | Who                                                  | Responsibility                                                                                |
| -------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Authorization Server | **SMD console** (`admin.smd.services`, Clerk-backed) | User login, consent, mint access tokens audience-bound to a specific Machine + persona + user |
| Resource Server      | **the Machine's `/mcp` endpoint**                    | Validate token, resolve subject → firm user, enforce authz, serve tools                       |
| Client               | the firm user's **Claude** (claude.ai / Desktop)     | OAuth 2.1 Authorization Code + PKCE against the console AS                                    |

### 3.2 Flow

1. User adds the firm's Operator as a custom connector in their Claude, pointing at `https://<machine-host>/mcp`.
2. Claude fetches `/.well-known/oauth-protected-resource` from the Machine; it names the console as `authorization_servers[0]`.
3. Claude runs OAuth 2.1 Authorization Code + PKCE against the console. The console authenticates the user (Clerk identity already exists for SMD/firm users per the shared-identity model in [00-foundations.md](00-foundations.md)), confirms the user is listed in this customer's `customer.yaml.users[]`, and mints a token whose claims include: `sub` = firm user email, `aud` = this Machine's resource id, `persona` = the firm-facing profile slug, and a `data_posture` claim (§6).
4. Claude presents the token on every `POST /mcp` call. The Machine validates it (signature against the console's JWKS, or token introspection) and rejects any token whose `aud` is not this Machine. Short TTL (for example 1 hour) with refresh; tokens are bound to one customer by audience.

### 3.3 Identity → persona mapping

Persona = Hermes profile ([ADR 0011](../../adr/0011-multi-persona-per-customer.md)). The token's `persona` claim selects which firm-facing profile answers (for the pilot, a single profile, for example "Avery"). The **authorization principal for every entitlement check is the token `sub` (the firm user), not the agent identity.** This is the hinge that prevents the confused-deputy failure in §5: we authorize what _this user_ may reach, then the persona serves only within that envelope.

The bridge never accepts an unauthenticated `tools/call`. Missing/expired/wrong-audience token → JSON-RPC error, fail-closed, audited as a refused call.

---

## 4. Authorization, confidentiality, and ethical walls

This is the hard part and the gating one for a law firm. The failure mode to design out, stated plainly: **a firm user reaching another user's privileged matter, document, or data through the bridge.**

### 4.1 Two-axis authorization on every tool call

Every `tools/call` passes through two independent gates in the bridge, before any store is read or any agent is woken:

**Axis A — action class** (reuse `shared/action_classes.py`). Each MCP tool declares its action class. The bridge maps tool → class → the customer's authored ceiling exactly as the inbound trust gate does today. READ is always allowed (subject to Axis B). `operator_handoff_task` is INTERNAL_WRITE. Nothing in the exposed surface is EXTERNAL_SEND, COMMITMENT, DESTRUCTIVE, or CODE_EXECUTION. Per [ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md), a tool whose action class has no authored ceiling is REFUSED, not best-effort served.

**Axis B — per-user access scope** (new, the load-bearing addition). The existing entitlement model is per-agent-identity/connector at action-class grain. The bridge adds a **per-user matter/document access resolver**: given the token `sub`, return the set of `matter_id`s (and document/folder scopes) that user may reach. Every retrieval result is filtered through the resolver before it leaves the Machine. The resolver is the mandatory chokepoint; tool handlers cannot bypass it because it lives in bridge code, not in agent-authored skill text.

### 4.2 Source of the access map (degrades by scenario, §8)

- **No-API case:** an **authored access map** in `customer.yaml` (firm user → matters/folders), human-reviewed, fail-closed. No authored entry for a user = empty access set = zero matters. This is [ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md) applied to per-user reach.
- **API case (Clio/Smokeball live):** the resolver can additionally source from the practice-management system's own user-matter permissions (the PMS already knows who is on which matter), with the authored map as an intersecting deny floor. Authoritative permissions from the system of record, never widened by the bridge.

### 4.3 Ethical walls and conflict screens

- **Walls are deny-over-allow.** An authored `ethical_walls[]` list (user × matter deny pairs) is consulted on every retrieval; a deny always overrides any allow, including a PMS-sourced allow. This models the screen a firm erects when a lawyer is conflicted off a matter.
- **Conflicts are never auto-cleared.** The law pack's `conflict-routing` floor (`operator/verticals/law-firm/`, compliance floor) holds across the bridge: the Operator captures and routes conflict flags to a human and never clears them. The bridge exposes no tool that could clear a conflict.
- **Privilege stays inside firm surfaces.** Privileged content is gated additionally on the token's `data_posture` claim (§6). The default is the most restrictive: privileged/work-product material is releasable only to a posture the firm has explicitly authorized.

### 4.4 Why the failure mode is designed out

Three independent layers each have to be defeated for a cross-matter leak: (1) the access resolver defaults to an empty set (fail-closed), (2) ethical walls deny-override even a correct allow, (3) the resolver is a non-bypassable chokepoint in bridge code consulted on **every** result, not a hint the agent may ignore. A bug in any one is contained by the other two.

---

## 5. Tool surface

All tools are read/surface-oriented except `operator_handoff_task`. Each declares an action class and an authorization scope. "Resolver-scoped" means the result set is filtered by the §4 per-user access resolver.

| Tool                        | Action class   | Scope                                       | Behavior                                                                                                                                                                                                            |
| --------------------------- | -------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operator_search_matters`   | READ           | resolver-scoped                             | Query firm/matter knowledge the user is entitled to. Returns matter stubs (id, caption, status), never matters outside the access set.                                                                              |
| `operator_get_matter`       | READ           | resolver-scoped                             | Matter summary/status. No-API: assembled from email + memory. API: live PMS record. Result is provenance-tagged (`assembled` vs `system_of_record`).                                                                |
| `operator_list_documents`   | READ           | resolver-scoped + privilege                 | List documents the Operator can access for an entitled matter. Privileged docs appear only under an authorized `data_posture`.                                                                                      |
| `operator_surface_document` | READ           | resolver-scoped + privilege + content-class | Retrieve/return a specific document (content or a fetchable reference). Subject to the same content/privilege floors as any other surface.                                                                          |
| `operator_search_memory`    | READ           | resolver-scoped                             | Read shared operating memory (Honcho mirror / per-customer D1) scoped to the user's entitled matters.                                                                                                               |
| `operator_handoff_task`     | INTERNAL_WRITE | resolver-scoped                             | Hand a task to the Operator. Creates an internal work request (provenance-stamped inbound item). Does **not** author or send client-facing content. The Operator works it async and reports over its channels (§6). |
| `operator_status`           | READ           | self-scoped                                 | Liveness + queue status for **this user's** handoffs. No cross-user visibility.                                                                                                                                     |

**Deliberately excluded:** any send, draft-for-client, sign/accept, delete, or code-execution tool. Memory **write** from the bridge is designed (INTERNAL_WRITE, authored opt-in) but excluded from MVP (§9). `operator_handoff_task` is the minimal and only state-changing tool; it is taint-aware (§5.1).

### 5.1 Trust class and taint

Inbound MCP calls are authenticated firm users, so the provenance envelope (`shared/inbound.py`) stamps `surface="mcp"`, `trust_class="known_external"` (an authenticated firm user is not "internal" agent context, but is far above anonymous webhook content). A handoff's free-text payload is untrusted content the same way an email body is: it enters the nonce-fenced quarantine wrap and marks `SessionTaint` on the resulting agent session. So a handoff cannot, by itself, drive the agent to autonomously send or destroy: the existing taint-gate already refuses EXTERNAL_SEND/DESTRUCTIVE/COMMITMENT/CODE_EXECUTION on a tainted session. The bridge inherits that defense for free by routing handoffs through the same chokepoint webhooks use.

### 5.2 Relationship to the capability broker

For tools that touch a mediated connector (for example a live Clio matter read in the API case), the bridge does **not** hold raw vendor credentials and does **not** re-implement provider access. It calls the first-class, broker-mediated Hermes read tools ([ADR 0045](../../adr/0045-mediated-connector-capability-broker.md)); the broker remains the only holder of connector credentials and the only writer of the broker audit ledger. The bridge is a caller of mediated reads, never a second path around the broker.

---

## 6. Bidirectionality model

Precise mechanics, because "back and forth" must not over-promise.

**`user → Operator` (synchronous, over MCP):**

- Read tools answer **synchronously and directly** from the per-customer stores (and broker-mediated reads). No agent wake for reads, which keeps them fast and matches "surface, don't draft."
- `operator_handoff_task` returns a **synchronous acknowledgement** (`{accepted, handoff_id}`) but the work itself is asynchronous.

**`Operator → user` (asynchronous, NOT over MCP):**

- The Operator's proactive output (a completed handoff, a status nudge) is delivered over its **existing channels**: email or Telegram, per how the firm authored its surfaces. There is no server-initiated push into a live Claude session, and we do not design one. Even MCP server notifications would not reach a Claude session the user has closed.

**What "exchange in one Claude session" therefore means, honestly:** the user **pulls** repeatedly within their session (ask, retrieve, surface a document, hand off, check status). The Operator's **proactive** contributions land in the user's inbox/Telegram, which the user can then re-surface into Claude (the workflow he already runs: pull files into the Project). The loop is real and useful; it is pull-plus-channels, not live duplex over the MCP link. The design states this plainly so the pilot is not sold a duplex promise the transport cannot keep.

---

## 7. Data governance (firm-policy decision, flagged)

This is not only a technical question. Firm data (matter facts, documents, potentially privileged work product) would flow into a firm user's Claude. Whether that is acceptable, and under what terms, is a **firm-policy and professional-responsibility decision**, not an engineering default. The design surfaces the decision and enforces whatever the firm chooses; it does not make the call.

**The `data_posture` token claim** carries the firm's decision into runtime enforcement. It is minted by the console at token time based on what kind of Claude account the user authenticated with and what the firm authorized:

| Posture                | Account type                                                                             | Surface released                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `restricted` (default) | personal Claude, or unverified                                                           | Only the user's own handoffs + non-privileged status. No matter documents, no privileged content. |
| `firm_confidential`    | enterprise/team Claude under the firm's DPA with documented zero-retention / no-training | Full resolver-scoped surface, including privileged docs the user is entitled to.                  |

Rationale and the risk to name for the firm:

- **Privilege waiver.** Releasing privileged work product into a personal AI account, outside the firm's control and retention terms, risks waiving privilege. The `restricted` default withholds privileged content until the firm authorizes a posture that does not.
- **Retention.** The bridge itself logs **digests only**, never content (§8), mirroring the audit ledger discipline. Content that crosses into the user's Claude is governed by that Claude account's terms, which is exactly why the account type gates the surface.
- **The firm decides, the design enforces.** Phase 0 (§9) is the firm ruling on this before any matter content crosses the bridge.

---

## 8. Audit

Every cross-bridge interaction is recorded in the **broker-owned, tamper-resistant audit ledger** already running on the Machine. The bridge emits through the broker audit client (`shared/broker_audit.py` / `shared/audit_client.py`); it never writes its own log, consistent with the broker-owns-the-ledger invariant.

New `action_type` rows (digest-only, never content):

- `MCP_TOOL_CALL` — `sub` (user email), `tool`, `persona`, `action_class`, decision (`allowed`/`refused`), `matter_ids` touched (digest), `data_posture`, `result_provenance` (`assembled`/`system_of_record`), `item_id`.
- `MCP_AUTH` — token validation outcomes (issued-audience mismatch, expiry, refusal), so a probing or stolen-token attempt is visible.
- `MCP_HANDOFF` — handoff accepted (`handoff_id`, scope), correlatable with the downstream agent session and its channel reply.

This makes the bridge a first-class audited surface alongside webhooks and the workspace broker, and it gives the firm a complete record of who reached what through the bridge. The runtime-read seam ([ADR 0043](../../adr/0043-operator-runtime-read-path.md)) already exposes `audit_log` to the console, so these rows surface in the admin portal with no new read path.

---

## 9. Scenario coupling and phased recommendation

### 9.1 Degradation by scenario

The bridge degrades cleanly. Tool **names are identical** across scenarios; only the data source and authority change, and every result is provenance-tagged so the user knows which they got.

| Capability      | No-API (no Smokeball/Clio)                                | API (PMS live)                                 |
| --------------- | --------------------------------------------------------- | ---------------------------------------------- |
| Matter context  | Assembled from email + user-supplied docs + shared memory | Plus the live system-of-record matter record   |
| Access resolver | Authored access map (`customer.yaml`)                     | Authored map ∩ PMS user-matter permissions     |
| Documents       | What the Operator received / the user supplied            | Plus PMS document store (broker-mediated read) |
| Provenance tag  | `assembled`                                               | `system_of_record`                             |

This is why the bridge is strategically robust: it delivers value on day one without the PMS API, and gets richer (not rebuilt) when the API track lands.

### 9.2 Phasing

**Phase 0 — firm-policy gate (no code).** The firm rules on data governance (§7): which Claude account type, what `data_posture` is authorized, whether privileged content may ever cross. The access map and any ethical walls are authored and human-reviewed. Nothing ships until this is settled.

**Phase 1 — MVP: read/surface-only, single user.** The litigator is the sole authorized user. Tools: the six READ tools only (`operator_handoff_task` deferred). No-API scenario (email + memory + user-supplied docs). `data_posture` decided in Phase 0. Full audit on. This validates the three hardest things (transport + OAuth, per-user authz/resolver, data-governance enforcement) with **zero write risk**, and it matches his stated discipline of read-and-highlight, never draft. This is the recommended starting point and aligns with the handoff's "read/surface-only, no write tools" suggestion.

**Phase 2 — add the handoff and the live record.** Introduce `operator_handoff_task` (async, INTERNAL_WRITE, taint-aware), once the firm has lived with reads and the data-governance posture is proven. Wire the API-case matter reads when the Clio/Smokeball connector track lands (separate track, out of scope here). Handoff is the feature that makes it feel like "exchange," so it is the natural Phase 2 headline.

**Phase 3 — broader firm rollout.** Multiple firm users, per-user access maps (or PMS-sourced permissions) at scale, ethical walls across the user population, a persona roster ([ADR 0011](../../adr/0011-multi-persona-per-customer.md)) if the firm wants role-specific operators. Optional memory-write tool (authored opt-in) considered here.

### 9.3 Risks

| Risk                                                                       | Mitigation                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confused deputy** (bridge authorizes on the agent, not the user)         | Authorization principal is the token `sub` (firm user); resolver scopes by user on every call (§4.1, §3.3).                                                                                    |
| **Cross-matter leak**                                                      | Three independent layers: fail-closed empty access set, deny-over-allow ethical walls, non-bypassable resolver chokepoint (§4.4).                                                              |
| **Privilege waiver via personal account**                                  | `restricted` default withholds privileged content; `firm_confidential` requires firm authorization + enterprise account (§7). Firm-policy decision named, not assumed.                         |
| **Token theft / replay**                                                   | Audience-bound to one Machine, short TTL + refresh, validated against console JWKS, refusals audited (§3.2, §8).                                                                               |
| **Untrusted MCP client** (the user's Claude is a client we do not control) | Inbound stamped `known_external`, handoff payload quarantine-wrapped + taints the session; taint-gate blocks autonomous sensitive actions (§5.1).                                              |
| **Over-exposure**                                                          | Only the authored tool surface is served; nothing introspects beyond it; no send/commit/destructive/exec tools exist on the bridge.                                                            |
| **Availability**                                                           | Machine down = endpoint down, with no cross-customer fallback (correct per [ADR 0007](../../adr/0007-per-customer-machine-isolation.md)). Bridge co-located with the gate, supervised by tini. |

---

## 10. Open questions for Captain

1. **Authorization Server placement.** This design puts the AS at the SMD console (reuse Clerk). Confirm, versus running a minimal AS per Machine (more isolation, more surface to maintain).
2. **`data_posture` default.** Design defaults to `restricted` and gates `firm_confidential` on enterprise account + firm authorization. Confirm this is the right default for the legal pilot, or stricter (no matter content at all until enterprise account is verified).
3. **MVP write boundary.** Recommendation is Phase 1 = pure read/surface, handoff in Phase 2. Confirm, or fold handoff into MVP since "accept hand-offs" is in the stated objective.
4. **New `customer.yaml` blocks.** This introduces at least `mcp_bridge` (enable/port/persona binding), `mcp_access_map` (user → matters), and `ethical_walls`. All three must be registered in `operator/contracts/customer-yaml-blocks.yaml` (CI fails on an unclassified block) and given materializers in `translate.py` before authoring. Flagged for the implementation track, not built here.

---

## 11. Out of scope

Implementation; the `mcp:smokeball` (or `mcp:clio`) connector track; any drafting or send capability beyond surfacing; the console-side Authorization Server build; the admin/client portal surface for issuing and revoking bridge access (a natural follow-on to [01-admin-portal.md](01-admin-portal.md) / [02-client-portal.md](02-client-portal.md)).
