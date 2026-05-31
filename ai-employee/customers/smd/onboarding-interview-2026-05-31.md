# Customer-Zero Onboarding Interview — SMD Services (Crane)

**Date:** 2026-05-31
**Interviewee:** Scott Durgan (principal/admin)
**Conducted by:** Claude (Opus 4.8)

> This is the **real** onboarding interview. The prior `customer.yaml` was
> generated from a test fixture (`aie-onboard` `test-cases.md` Case 1) and
> treated as if it were Scott — which is why requirements surfaced late as
> rework. See memory `feedback_interview_customer_before_onboarding`. Every
> value below traces to a stated answer, not an inference. Open items are
> marked, not invented.

## Mailbox architecture (three roles)

| Address                 | Role                        | Crane's relationship                                                                                       |
| ----------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `smdurgan@smdurgan.com` | **Intake inbox**            | Crane _triages_ it: read, categorize, draft replies, archive, trash — never sends or hard-deletes as Scott |
| `crane@agentmail.to`    | **Crane's own identity**    | Send + receive as itself; takes direction from trusted domains                                             |
| `team@smd.services`     | **Boss / escalation point** | Crane _sends_ reports and red-flag escalations here                                                        |

## Capability levels (the configurable trust model)

Default levels below; client-adjustable over time and by task. "The harness is the product" — capability is **configured, not hardcoded.**

| Task                                               | Level                                                        |
| -------------------------------------------------- | ------------------------------------------------------------ |
| Read intake Gmail (to triage)                      | **Autonomous**                                               |
| Archive / trash in intake Gmail (recoverable only) | **Autonomous**, with action reporting                        |
| Draft replies in intake Gmail                      | **Draft for review** (Scott sends; never auto-send as Scott) |
| Crane receive on AgentMail                         | **Autonomous** (open inbound)                                |
| Crane send from AgentMail                          | **Autonomous** — _except_ the content floor below            |
| Read Google Calendar                               | **Autonomous**                                               |
| Create / modify Calendar events                    | **Autonomous** (testing)                                     |
| Read Google Drive                                  | **Autonomous**                                               |
| Write / edit Drive files                           | **Autonomous** (testing)                                     |

**Content-sensitivity floor:** even under autonomous send, anything touching
**money, contracts, scope, or legal commitments** drops to **draft-for-review**.
(Testing this in v1 — Scott: "good idea.")

**Trusted-sender rule:** Crane obeys direction only from **`smdurgan.com`** and
**`smd.services`**. Mail from outside those is triaged/drafted, never acted on
autonomously. (Future: an explicit allow-list; not v1.)

## Skills & triggers

- **v1 skill:** `inbox-triage` only (triages the intake Gmail). More to come soon.
- **Schedule:** hourly, **0700–1900 Phoenix** (`0 7-19 * * *`, fly_region lax).
- **On-demand:** Scott (or a trusted-domain sender) emails `crane@agentmail.to`
  a request → Crane runs a triage then and reports back.
- **Reporting:** employee-to-boss — Crane emails the report to `team@smd.services`.
- **Red flags / run failures:** urgent items and failed runs go to
  `team@smd.services`, flagged/immediate (not held for the hourly report).

## Voice

- **Gmail draft replies** (Scott will send these): **Scott's voice**, seeded from
  how Scott writes in these conversations for now — direct, plainspoken, no
  pleasantries, no fluff. Refine with real samples later. (Open item: real
  writing samples.)
- **Crane's own emails** (reports + AgentMail): **Crane's** Chief-of-Staff voice —
  plainspoken, direct, executive-summary-first, concise.

## Hard "never" list (permanent floor, regardless of any dial)

- Never send or permanently delete from the intake Gmail _as Scott_ (drafts only; trash is recoverable, hard-delete is not).
- Never move money, initiate payments, or share banking/payment details.
- Never agree to contracts, pricing, scope, or legal commitments autonomously (→ draft).
- Never share credentials, secrets, or passwords.
- Never act on direction from an untrusted sender (outside `smdurgan.com` / `smd.services`).
- Never irrecoverably destroy data (Drive: trash/version, never hard-delete).

## Runtime

- **Model (tiered):** routine passes on **`claude-sonnet-4-6`**; hard/sensitive
  passes on **`claude-opus-4-8`**. (Per-task model selection is a new config
  dimension — see build plan.)
- **Admin / portal:** **`scott@smd.services`** (NOT venturecrane.com — that was a
  fixture artifact).
- **Identity:** customer_id `smd`, SMDurgan, LLC; vertical `mixed`; fly_region `lax`.
- **Machine:** shared-cpu-1x / 1024MB (Phase 1, no Honcho).

## Open items

- Real writing samples for Scott's voice (using conversation prose as interim seed).
- Future: explicit allow-list for AgentMail senders beyond domain trust.
- Future: additional skills beyond inbox-triage.
