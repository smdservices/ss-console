---
title: The Operator Is an Employee — Default Communication Channel + Roster-Governed Two-Way Interaction
date: 2026-06-24
status: accepted
captain: Scott Durgan
related-adr: 0037-operator-thesis.md, 0035-no-imposed-entitlement-defaults.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0004-productized-operator-offering.md, 0044-r2-authoritative-live-reconfig.md, 0007-per-customer-machine-isolation.md
---

# ADR 0055 — The Operator Is an Employee

**Status:** Accepted (Captain decision, 2026-06-24).

**Source:** Wiring the default communication channel for the Ashton & Price pilot surfaced two category errors in how the team (and the codebase) had been reasoning about Operator communication. Correcting them required naming the frame they both violate. This ADR names it.

---

## Context

### The frame: an Operator is a new employee

When a person joins an organization they are given an identity and an inbox. Anyone in the company can email them and ask or tell them to do things. They respond the way an employee responds — readily to direction from inside the organization, and, for anything reaching _outside_ the organization, only on explicit authorization from someone with the standing to give it. What they are inclined to do is set by the organization's own manual, authored to that organization's needs.

The Operator is that employee. This is the natural extension of [ADR 0037](0037-operator-thesis.md) Tenet 1 — the Operator competes with a **hire**, not with software. A hire has a company email and talks to colleagues. So does the Operator. Every question about how it communicates and what it is inclined to do is answered by **"what would an employee with this manual do?"** — not by what vertical it serves or what feature it exposes.

### The two category errors this corrects

**(1) Treating a universal capability as vertical-specific.** The default communication channel — an inbox the organization reaches the Operator through, and to which it _responds_ — is **vertical-agnostic**. Every Operator has it. The codebase had entangled it with the law-firm external-send-draft floor ([ADR 0025](0025-autonomy-ceilings-configurable-exposure-vs-initiation.md)), so a universal "the employee answers its colleagues" capability looked like a law carve-out. It is not. The law floor governs a _different_ axis — reaching parties **outside** the organization — and is one organization's manual being strict, not a property of the channel.

**(2) Treating a real capability as "demo."** The recipient-locked autonomous reply — the Operator actually sending its governed reply back to the colleague who wrote in — was built and then fenced as **demo-only** (`hermes-smd-demo-relay`, gated on a `demo.reply_relay` flag, with production verticals told never to author it). That is the error. An Operator pointed at a prospect is just an Operator interacting; "demo" is not a mode, a flag, or a gate. A capability is real or it is cut. Fencing a core employee function — answering your colleagues — behind a "demo" flag is exactly backwards.

## Decision

**The Operator is an employee. Its communication and inclinations derive from the employee frame, not from verticals or features. Concretely:**

### 1. Every Operator ships with a default communication channel, on by default

A new Operator gets an inbox — **AgentMail by default** (`<slug>@agentmail.to`), the channel on at provision. The channel is a **pipe** (the channel-is-a-pipe principle): all intelligence, memory, and governance live in the worker, never in the channel. The default pipe is swappable and composable — a custom domain, voice/phone, messaging apps — without changing anything below it. Anyone can reach the inbox; an inbox the world can write to is the point of having an employee with an email address.

### 2. The roster is the allowlist; inside it, the Operator has full two-way interaction

The organization's roster — authored as `scope.inbound_allow_from` (addresses and/or `@domains`) — is the set of correspondents the Operator converses with as a colleague: it **reads and responds** (not merely drafts), and acts, governed by its **employee manual** (the per-customer authored config — `customer.yaml`, skills, entitlements). Anyone on the roster interacts however they choose; common sense and the organization's culture govern, **not a rigid permission grid**. We deliberately do not over-engineer the inner circle into a matrix.

Mechanically, a reply to a rostered sender is **recipient-locked**: it can go _only_ to the verified address that wrote in, never to an address taken from the message body. Roster membership is the authorization to respond autonomously; the recipient-lock is the structural guarantee that the response cannot be redirected. Both hold independently.

### 3. Outside the roster requires explicit authorization

The Operator does not reach **outside** the organization on its own. Contacting a party not on the roster — a new client, a vendor, opposing counsel — requires explicit direction from someone with authority in the organization. This is ordinary new-employee behavior, and it is **where "draft for review / get approval" lives** — as an authored posture, not as a vertical rule. The [ADR 0025](0025-autonomy-ceilings-configurable-exposure-vs-initiation.md) external-send floor is one organization's manual making this strict for compliance reasons; it governs outside/chosen recipients and is **unchanged** by this ADR. It was never the definition of the channel.

### 4. Defaults: employee-onboarding shaped, fail-closed when unauthored

- The channel is **on by default**.
- The roster **seeds to the organization itself out of the box** — the SMD operator (`scott@smd.services`) plus the organization's own email domain — so the org can talk to its Operator from day one, exactly as a new hire can be emailed by anyone in the company the moment their seat exists.
- An **empty/unauthored roster is fail-closed**: the Operator reads but does not autonomously respond (it drafts). This reconciles with [ADR 0035](0035-no-imposed-entitlement-defaults.md): the default is a _safe authored seed_ (the org's own domain), never an assumption about the outside world.

### 5. No "demo." The capability is promoted, the demo framing is ripped

The recipient-locked reply is a **production Operator capability**, renamed for what it does (`hermes-smd-reply`) and **gated on roster membership**, not on a demo flag. The `demo.reply_relay` flag, the `demo` config block, the `demo-law` seat, and the `DEMO_RELAY_*` audit names are removed in the same wave (doctrinal-flip-includes-the-rip). There is no "demo mode" in the product; an Operator used to show a prospect is an Operator.

### 6. The authority gradient is designed-for, not built

An employee weighs _who_ is asking — a manager's or manager's-manager's direction carries more weight; a lateral or other-department demand prompts "let me check with my manager first." This gradient is a **real future refinement** we leave room for (the roster and the manual can grow grades), but we **do not build the grid now** and do not box ourselves into one. Today: anyone on the roster interacts freely, common sense and culture governing.

## Consequences

- **The communication channel is universal and named.** It is no longer reasoned about through any vertical. New verticals inherit it; their manuals only _add_ constraints (e.g. a law firm's strict outside-send posture), never define the channel.
- **The `external_send` floor is correctly scoped.** It governs reaching outside the roster. Inside-roster recipient-locked replies are a distinct, structurally-bounded action and are not floored to draft.
- **One capability, no demo.** `hermes-smd-reply` is the production path. The rip removes the `demo` surface entirely; nothing in the product carries a "demo" concept.
- **Onboarding is real.** Provisioning seeds the roster to the org's own domain; the Operator answers its colleagues from day one, fail-closed to the outside.
- **Spoofing is contained, hardening noted.** The recipient-lock means a spoofed rostered `From` yields a reply to the _real_ rostered address (noise, not exfiltration). Enforcing inbound SPF/DKIM/DMARC where the channel exposes auth results is a follow-up hardening, not a blocker.

## What this does not decide

- The **authority gradient** mechanism (how a manager's direction is weighted vs. a lateral request). Designed-for; deferred.
- **Non-AgentMail channels** (custom domain, voice, messaging). The pipe is swappable by design; each is its own build when authored.
- The **external-send-to-outside** posture beyond reaffirming it is an authored, per-organization choice and that [ADR 0025](0025-autonomy-ceilings-configurable-exposure-vs-initiation.md) stands for the law vertical.
