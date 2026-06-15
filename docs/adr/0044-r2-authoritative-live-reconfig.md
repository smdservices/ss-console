---
title: R2-Authoritative Live Reconfiguration — Broker-Owned Apply
date: 2026-06-14
status: accepted
captain: Scott Durgan
related-adr: docs/adr/0012-customer-yaml-storage.md, docs/adr/0026-control-plane-data-plane.md, docs/adr/0043-operator-runtime-read-path.md, docs/adr/0007-per-customer-machine-isolation.md
amends: docs/adr/0012-customer-yaml-storage.md
---

# ADR 0044 — R2-Authoritative Live Reconfiguration

**Status:** Accepted (Captain decision, 2026-06-14). Enables applying a `customer.yaml` change to a running Operator without a reboot, durably and reversibly, in service of pilot-time responsiveness.

## Context

A running Operator enforces entitlement ceilings by reading `/opt/data/customer.yaml` **fresh on every action** (`shared/customer_config.py` `from_volume()` is uncached; `plugins/hermes-smd-trust/enforce.py` re-resolves per `pre_tool_call`). So a ceiling/scope change applies the instant that file is replaced — no reboot. Today the only thing that delivers a changed file to a running Machine is a reboot (bootstrap re-fetches from R2 on boot) or a full reprovision. We have been rebooting Machines to deliver a file the agent would re-read on its own.

[ADR 0012](./0012-customer-yaml-storage.md) §1 declares **git the source of truth**, with R2 and the volume as projections, and bootstrap fetching customer.yaml from R2 at boot. Two facts make a naive "just write the live volume" approach unsafe:

1. **Silent revert.** `reprovision.sh` reads `operator/customers/<slug>/customer.yaml` from git. Any live change not also in git is silently reverted on the next reprovision.
2. **Self-loopback ceiling-raise.** A push write-endpoint on the Machine authenticated by a key already present in the agent's process environment would let a prompt-injected agent rewrite its own ceiling file via a `127.0.0.1` self-call — defeating [ADR 0026](./0026-control-plane-data-plane.md) (the agent cannot raise its own ceiling).

## Decision

### 1. R2 is the operational source of truth for live state; git is the reviewed/DR record

A live apply writes the new `customer.yaml` to R2 (`vaults/<slug>/customer.yaml`). R2 is what a running Machine boots from and what a live apply updates. Git becomes the **reviewed history + disaster-recovery copy**, reconciled from R2 asynchronously. This **amends [ADR 0012] §1**: git is no longer the single live source of truth; it is the reviewed record. Transient git-behind-R2 divergence is accepted and surfaced in the config-history trail.

### 2. `reprovision.sh` reads from R2, not git

To eliminate the silent-revert (Context fact 1), `operator/bin/reprovision.sh` reads the customer.yaml it materializes from **R2**, not the git working copy. Git is reconciled into R2 (not the reverse) by the reconciler below.

### 3. Every apply writes a durable byte-snapshot to R2

Each apply writes `customers/<slug>/history/<digest>.yaml` and records the key in `customer_config_history.r2_shadow_key` (non-null for apply-sourced rows). **Undo restores from this R2 snapshot**, not from a git SHA that may not exist yet. This makes "reversible" real rather than a pointer to an un-made commit.

### 4. A named reconciler keeps git honest

A scheduled job (CI or queue-triggered Worker) commits reconciled R2 versions back to the customer.yaml repo as the reviewed record. The reconciler is owned and runs on a schedule — git divergence is bounded, not "someone remembers to."

### 5. Apply is pull-based and broker-owned (not a push write-endpoint)

The runtime seam ([ADR 0043](./0043-operator-runtime-read-path.md)) stays **read-only**. Config application is performed by a **control-plane applier running as the broker uid** (the OP-P1-4 audit-broker privilege domain — not the agent uid, with no agent-readable credential):

- The console writes the validated new `customer.yaml` (+ snapshot) to R2.
- The broker pulls from R2, validates in-process, runs floor/allow-list/monotonicity checks, applies via atomic temp-write+`fsync`+`rename` to `/opt/data/customer.yaml`, and writes the `CONFIG_WRITE` audit row — **apply and audit as one broker-owned unit** (the writer cannot suppress its own log).
- The agent holds no credential and has no inbound verb that can trigger a config change. The self-loopback ceiling-raise primitive (Context fact 2) does not exist.

This preserves [ADR 0026]: control-plane authority (changing ceilings) stays off the data plane (the agent). It is the correctly-scoped revival of the buried `customer-sync` sidecar — a broker-owned R2 pull-applier, **not** the agent-triggered SIGHUP mechanism (which stays retired).

### 6. Graceful reload via SIGUSR1

For changes that require Hermes to reload (voice tone, connector enable — fields read at gateway start), the broker triggers Hermes' **native** graceful restart by sending `SIGUSR1` to the gateway PID (`gateway/run.py` installs `restart_signal_handler` → `request_restart(via_service=True)` → drain → exit-75 → service-manager restart). No Hermes-core change; no data-plane injection. The broker runs privileged enough to signal the gateway, which credential-isolation already requires.

### 7. Safety semantics on the apply path

- **Floor-preserving + allow-list.** The broker refuses any diff that would bypass a vertical/content floor, and refuses changes to fields outside an explicit live-writable allow-list (`vertical`, `model`, persona OAuth, connector backends, memory namespace are never live-writable — they are rebuild-class).
- **Tightening vs widening.** A ceiling _tightening_ (toward `refused`) is confirmed-applied-or-failed-loudly; a _widening_ may defer to next boot. Direction is computed against the order `refused < draft_for_review < autonomous`.
- **Config-epoch.** Each applied config carries a monotonic epoch; a _loosening_ change does not retroactively apply to sessions started before the epoch (it must not bless an in-flight, possibly-tainted turn). The `CONFIG_WRITE` row records the active session set at write time.

## Consequences

- Live entitlement/scope/escalation/webhook/demo changes apply instantly, durably (survive reboot + reprovision), reversibly (R2 snapshot), and audited (broker-owned ledger).
- ADR 0012's git-first invariant is relaxed to git-reviewed; the reconciler and the reprovision-reads-R2 change are load-bearing and ship in the same wave.
- The control/data-plane separation of ADR 0026 is preserved by construction, not by added checks.

## Out of scope

Portal client self-serve apply (admin-driven first); proactive entitlement-promotion nudges.
