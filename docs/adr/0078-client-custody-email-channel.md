---
title: Client-custody email — the operator lives on the client's mail system; AgentMail is an opt-in default, not the architecture
date: 2026-07-24
status: accepted
captain: Scott Durgan
related: 0006-capability-adapter-pattern.md, 0010-per-customer-oauth-token-storage.md, 0020-connector-strategy.md, 0037-operator-thesis.md, 0048-operator-relationship-model.md, 0055-operator-is-an-employee.md, 0072-recipient-aware-proactive-send.md
---

# ADR 0078 — Client-custody email: the operator lives on the client's mail system

## Decision

**1. Custody posture.** For any client whose operator handles sensitive
information (legal, medical, financial — any seat where correspondence
itself is confidential), our **default recommendation** is that the
operator's email identity is a dedicated mailbox on the **client's own
email system**, and **AgentMail is unbound for that seat** — not
supplemented, not kept as a shadow path. One mail path, one custody story.
Clients without that sensitivity may keep AgentMail; it remains a quality,
fast-start default. The client chooses; we recommend.

**2. Provider-neutral by design.** The unit of this decision is "the
client's email system," **not Microsoft 365**. The architecture MUST NOT
hard-couple to any one provider the way it historically coupled to
AgentMail (see the 2026-07-24 channel-coupling audit). The seam is a
provider-neutral one; each provider is an adapter behind it:

- **Tier 1 — Microsoft 365** (first adapter, drives A&P): app-only Graph
  auth to a dedicated mailbox, scoped by `ApplicationAccessPolicy` to that
  mailbox only. Proven end-to-end on the `smdopslab` sandbox 2026-07-24
  (verify ledger `vfy_01KYAP100XPZFJWMCD57VSY4SY`,
  `vfy_01KYAQ7V6QWVY2R1ZS0Y271NN8`).
- **Tier 1 — Google Workspace** (second adapter, demand-gated): the exact
  analog exists — service account + domain-wide delegation scoped to the
  operator mailbox; schema groundwork already present
  (`google_auth.subject`, `managed_mailboxes`).
- **Tier 2 — generic IMAP/SMTP** (fallback adapter, demand-gated): covers
  the corporate tail (Zoho, Fastmail, on-prem Exchange, ISP mail) at
  reduced fidelity (no native drafts/threading semantics; polling or IDLE
  instead of push). Offered when neither Tier-1 provider applies and the
  client still wants custody.

Building M365 first is sequencing, not architecture. Any M365-specific
assumption outside its adapter is a defect of the same class as the
AgentMail coupling this ADR retires.

**3. The trust spine is channel-invariant.** Every inbound message, from
every provider and every future channel (messaging, voice), MUST pass
through the same security machinery — provenance envelope, nonce fence,
sticky taint, roster classification (ADR 0055), recipient-aware send
governance (ADR 0072) — before it can influence the model. The audit found
this machinery is already channel-agnostic in its core but **opt-in at the
edges** (native-gateway channels bypass it today — audit finding F1). This
ADR makes it an invariant: a channel that cannot be routed through the
trust spine is not a channel we bind. Enforcement is structural (the only
paths that can wake the agent are paths that fence), not conventional.

**4. Normalized message seam.** Adapters converge on a normalized inbound
message shape (sender, recipients, subject, body, message-id, provider
refs) and a normalized send/draft surface classified by ActionClass. All
governance operates on the normalized shape; nothing downstream of the
seam may branch on provider. The audit's fail-safe finding is preserved as
a requirement: an unmapped tool is refused, an unparseable payload routes
to draft — a half-integrated provider degrades to draft-only, never to an
ungoverned send.

## Why

**Custody, not cosmetics.** With AgentMail, every piece of operator
correspondence transits and rests with a third-party mail provider. For a
PI law firm, correspondence is itself privileged material. On the client's
own system, mail at rest lives only in their tenant — their retention,
their litigation hold, their eDiscovery, one fewer subprocessor holding
privileged mail. It also makes a sentence we already gave Christa in
writing — "we do not take a separate copy of your files to keep" — truer.

**The precise claim (do not oversell).** The custody claim is: _"the
operator's mail lives only in your email system."_ It is NOT "nothing else
ever touches it" — message content still transits the operator's compute
plane and the model API at processing time, exactly as it does when the
operator reads a document out of Smokeball. Client-facing language uses
the precise form. (No-fabrication policy applies; this wording is the
authored source.)

**Why provider-neutral is the lesson, not M365 support.** The 2026-07-24
audit's real finding was not "add Graph" — it was that we proved our trust
guarantees on exactly one channel and let the edges couple to it. Captain's
direction: the operator should be able to work through any email system
and, eventually, any communication channel the client designates. Fixing
the coupling by hard-wiring a second provider would repeat the mistake at
double width. Hence: neutral seam, providers as adapters, trust spine as
an invariant (Tenet 2 of ADR 0037 — the only hard limit is
connectability).

**Why AgentMail stays.** It is SOC-2-compliant, fast to provision, and the
right on-ramp for pilots, rehearsal seats, and clients without
confidentiality stakes in their mail. Demoting it from "the architecture"
to "an adapter with a default role" loses nothing.

## Consequences

- **A&P (first application):** go-live recommendation is
  `operator@firm.example` on their M365 via the app-only pattern,
  AgentMail unbound. Tracked as #1978; build list B1–B6 in the
  channel-coupling audit (`~/Desktop/channel-coupling-audit-2026-07-24.md`,
  to be committed alongside the #1978 work).
- **Config layer:** "AgentMail off" is already free (don't bind it; the
  provisioning script's secret staging is conditional). The app-only auth
  representation (provider auth block, per-customer secret custody per
  ADR 0010, mailbox address field) is net-new — audit deep-build #3.
  `PersonaSendAs.agentmail_identity` is generalized to a provider-neutral
  send-as identity.
- **Consent friction is accepted, verification deferred:** the M365
  admin-consent screen shows an "unverified publisher" banner (#1979).
  Admin consent is never blocked by verification status; at current scale
  the banner is a one-time, walked-through screen. Publisher verification
  is deliberately deferred until M365 client volume justifies the partner
  -program lift — it is polish on this posture, not a prerequisite.
- **F1 becomes work:** the fence/taint bypass for non-webhook channels is
  filed and fixed as its own item; the invariant in §3 is the acceptance
  bar.
- **Sales/positioning:** "your operator's mail never leaves your email
  system" (precise form above) becomes an authored differentiator for
  sensitive-data verticals.
- **Not in scope here:** messaging-app and voice channels (explicitly
  parked pending the channel-abstraction design session); migrating
  existing non-sensitive seats off AgentMail (no need).

## Alternatives rejected

- **Firm-branded send-as over AgentMail** (DNS/forwarding so AgentMail
  sends as `operator@<firm>`): looks like custody, isn't — every message
  still transits the third party. Worst of both worlds for a sensitive
  seat.
- **Delegated (hosted-MCP) M365 as the sensitive-seat default**: the
  already-templated `mcp:m365-mail` path authenticates as a _user_ with
  periodic interactive re-consent, and its scope set deliberately excludes
  `Mail.Send`. Wrong shape for a headless always-on employee with its own
  mailbox; app-only + mailbox scoping is strictly better custody and ops.
  (Delegated remains the right shape for reaching a _human's_ existing
  mailbox with their consent — a different job.)
- **M365-only support**: repeats the AgentMail mistake one provider wider.
