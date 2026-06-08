---
title: Operator Authority Posture — Per-Domain Client Self-Serve, SMD Always Full Control
date: 2026-06-08
status: proposed
captain: Scott Durgan
related-spec: docs/design/operator/00-foundations.md
related-adr: docs/adr/0035-no-imposed-entitlement-defaults.md, docs/adr/0030-control-plane-human-principal-surface.md
---

# ADR 0041 — Operator Authority Posture

**Status:** Proposed (2026-06-08), as the foundation for the Operator portal-management designs
(`docs/design/operator/`).

## Context

Operator clients span a spectrum of how much they want to run their own operator(s):

- Some want to be fully hands-off — SMD configures, monitors, and manages everything; they just want the work done.
- Some want full visibility but no operational burden — they watch, SMD operates.
- Some want to control as much as they can, with SMD as an escalation backstop.

We need one model that serves all three without three separate products, and that lets us **move a given client along
the spectrum over time** (a client who starts hands-off may later want to run their own team list). At launch we will
not hand operational control to any client — the operator needs to settle first — but the portals must be **built to
flip the switch, area by area, per client**, with clients having read visibility from day one.

This is distinct from two models already decided:

- **Client-internal RBAC** (role idea, re-derived: principal/staff/compliance) governs which of the
  _client's own people_ may act. Orthogonal.
- **Entitlements** ([ADR 0035](0035-no-imposed-entitlement-defaults.md)) govern what the _operator itself_ may do.
  Orthogonal. **This ADR does not touch entitlements** — it never adds, removes, or assumes a gate on the operator's
  behavior. It governs only _who, between SMD and the client org, may operate the controls._

## Decision

**Authority is a per-domain "client-self-serve" switch set, layered on top of SMD's always-present full control.**

1. **SMD control is a constant.** SMD always retains full write-control over every domain for every client in every
   state. The admin console is never read-only to SMD. If a client cannot act or needs help, SMD can always step in.
2. **Client authority is additive and per-domain.** For each client-operable domain there is a switch, default **off**.
   On = the client org _also_ gets operable controls for that domain (subject to client-internal RBAC); off = the client
   sees the domain read-only with a "request a change" path. The switch never removes SMD's control.
3. **Client read access is on for all domains from day one**, scoped to the client's own tenant. The sole exception is
   **cost/economics** (COGS, COGS/MRR), which is SMD-only by nature.
4. **Two domains are never client-switchable:** provisioning/lifecycle and cost. The rest are switchable:
   configuration authoring, trust & governance, connectors & credentials, runtime operations, memory & agent-skills,
   people & access, compliance & audit, and the action subset of observability/health.
5. **Launch state: every switch off.** SMD operates everything; clients watch. Switches are flipped per client per
   domain when SMD judges the operator has settled and the client is ready.

### Storage and shape

A new top-level `authority` block in `customer.yaml` (git source of truth, [ADR 0012](0012-customer-yaml-storage.md)),
materialized into `customer_configs` for the portals to read:

```yaml
authority:
  default: managed # preset applied to every switchable domain: managed | self_managed
  overrides: # per-domain deviations from the default; omitted domains take the default
    people_access: client # client org may operate this domain
    connectors: client
```

- `default: managed` sets every switchable domain to SMD-operated (all client switches off). `default: self_managed`
  sets them on. `overrides` flips individual domains. "Co-managed" is any client whose resolved switch set is mixed —
  a label, not a stored value.
- Validation: override keys must be in the closed set of switchable domains; values are `managed | client`.

### Composition

A client-side action is permitted **iff** the domain's switch is `client` **and** the acting user's client-internal
role permits the capability. SMD staff are not subject to the switch. The operator's own behavior is governed solely by
entitlements and is unaffected by this ADR.

## Alternatives considered

- **Single global posture per client (no per-domain).** Rejected — too coarse. Real clients want, e.g., to run their
  own staff list while leaving everything else to SMD. A global flag forces all-or-nothing.
- **Per-action authority (finer than per-domain).** Rejected — too granular to author or reason about; multiplies the
  control surface without real demand. Per-domain is the right grain; we can revisit if a domain proves too broad.
- **SMD-or-client exclusive ownership per domain.** Rejected — violates principle 1. SMD must always be able to step in;
  client authority is strictly additive.
- **Posture that also shapes entitlements** (e.g., "managed implies the operator drafts for SMD review"). Rejected —
  this is the exact conflation [ADR 0035](0035-no-imposed-entitlement-defaults.md) forbids. Authority and entitlement
  are independent axes.

## Consequences

**Positive.**

- One model serves the full managed↔self-serve spectrum; a client moves along it by flipping switches, no rebuild.
- The same `authority` data drives both portals from opposite sides (admin: do I author this or does the client; client:
  can I operate this or only request it).
- Launch is safe by construction (all switches off) while the build is future-proof.

**Negative / accepted.**

- A new schema block + projection + an ADR per the net-new-config discipline.
- Per-domain granularity means the domain list is a design commitment; adding/splitting a domain later is a schema +
  portal change. The initial list (§Decision 4) is deliberately conservative.

## Verification

1. `customer.yaml` validator accepts the `authority` block, rejects unknown override keys and values, and defaults to
   `managed` (all switches off) when the block is absent.
2. `customer_configs` carries the resolved per-domain switch set; both portals read it.
3. Client portal renders each switchable domain in Operable mode iff its switch is `client`, else Read+Request; read
   access is present for all domains except cost regardless of switch.
4. Admin portal renders every domain operable to SMD regardless of switch; the change-request inbox receives requests
   only from domains whose switch is off.
5. A client-side write to a switched-off domain is rejected server-side (not merely hidden).

## References

- [Foundations](../design/operator/00-foundations.md) §2 (composition layers), §4 (authority model)
- [ADR 0035](0035-no-imposed-entitlement-defaults.md) — entitlements are the orthogonal axis; no imposed defaults
- [ADR 0030](0030-control-plane-human-principal-surface.md) — the principal control-plane surface this composes with
- [ADR 0012](0012-customer-yaml-storage.md) — git source of truth for the `authority` block
- [ADR 0037](0037-operator-thesis.md) tenet 3 — no imposed defaults; the engagement authors
