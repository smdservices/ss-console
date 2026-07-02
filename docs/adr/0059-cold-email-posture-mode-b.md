---
title: Cold-Email Posture — Mode B (Low-Volume Personal) over Mode A (Scaled Campaign)
date: 2026-07-01
status: superseded
superseded-by: 0060-retire-automated-lead-gen-machine.md
captain: Scott Durgan
related-adr: 0058-lead-generation-portfolio-and-sequencing.md, 0039-operator-led-assessment-funnel.md, 0003-lead-gen-pivot-actor-identity.md
related-doc: docs/archive/lead-gen-strategy-2026-07-01.md
---

# ADR 0059 — Cold-Email Posture: Mode B (Low-Volume Personal) over Mode A (Scaled Campaign)

**Status:** Superseded 2026-07-01 by [ADR 0060](0060-retire-automated-lead-gen-machine.md) — the machine that fed this outreach posture was retired the same day; the Mode-A/Mode-B distinction is preserved here for history. Kept for history.

## Context

Cold email has been reopened repeatedly without ever closing: is it worthwhile at all, can we do it ourselves, and does it actually require mailbox warmup. The venture drifted for months — buying sending domains, half-planning warmup, filing it into the strategy — without a ruling that stuck. This ADR ends that.

The drift had one root cause: **"cold email" names two different activities, and every discussion slid between them.**

- **Mode A — scaled campaign.** Secondary sending domains, automated warmup, sequenced sends across multiple mailboxes, list-verification and deliverability-monitoring tooling. This machinery exists to push _volume_ (dozens to hundreds/day) without burning a brand. Warmup is mandatory (4-6 weeks of latency) and it carries ongoing tooling cost. It is a **volume instrument.**
- **Mode B — low-volume personal.** ~10-15 hand-personalized emails a week, each researched, sent from a real established mailbox. It is a **conversation instrument.**

Three facts settle the ruling:

1. **Primary-source deliverability authority draws the line for us.** Google/Yahoo classify a domain as a "bulk sender" only at 5,000+/day to their users ([Red Sift](https://redsift.com/guides/bulk-email-sender-requirements)); Mode B is ~0.2% of that. The deliverability guides themselves carve out the exact exception — _"5-10 hyper-personalized emails a week, ~20 minutes of research each, from your primary domain"_ is the case where **warmup and secondary domains are not needed** ([Ground Leads](https://www.groundleads.com/blog/primary-domain-vs-cold-email-domain), [MailReach](https://www.mailreach.co/blog/google-workspace-email-sending-limits)). Warmup exists to build reputation for _new/secondary_ domains at _volume_ — not for an established mailbox sending tiny volumes of genuinely personal mail ([UnifyGTM](https://www.unifygtm.com/explore/cold-email-2026-domain-setup-deliverability-sequences)).

2. **SMD's binding constraint is Mode B by definition.** The constraint (ADR 0039) is close-calls × conversion-per-call — a handful of high-fit conversations, not raw lead volume. A volume instrument is the wrong tool for a business that needs conversations, which is precisely why Mode A never felt right.

3. **The inventory confirms Mode A was never built, and Mode B's skeleton already exists.** A live code audit (2026-07-01) found: no bulk sender, no sequences, no campaign engine (bulk actions ship only dismiss/export). The secondary domains (`getsmdservices.com`, `smdurganservices.com`) appear nowhere in code — they exist only as external DNS. Meanwhile the Resend webhook is live, Svix-verified, and already writes `sent/delivered/open/click/bounce` to `outreach_events`; the "139 events, zero bounces" was never a broken webhook but the absence of any real send. The admin surface is a legitimate, live CRM cockpit plus a 1:1 booking-link send path — Mode B's skeleton.

## Decision

1. **Adopt Mode B as SMD's cold-email posture.** Cold outreach is low-volume (~10-15/week), hand-personalized, sent from an established mailbox, and **led by a real observed signal** from the job-monitor engine ("saw you're hiring a third dispatcher"). The signal is also the answer to the invisible-pain problem: it gives a genuine, non-generic reason for the touch, so the mail is not interruption spam.

2. **Warmup ruling (definitive).** Mode B **does not require warmup, secondary domains, or a cold-email tool.** This is per primary-source authority (above), not convenience. Mode A does require warmup; that requirement is one reason Mode A is deferred, not adopted.

3. **DIY ruling (definitive).** Mode B is **fully in-house** — a real mailbox plus the existing enrichment pipeline repurposed as a _research brain_ (one brief per prospect, not draft-at-scale). No agency, no sending vendor, no new infrastructure.

4. **Send mechanism.** Default is **hand-sent from Scott's real mailbox** (`scott@smd.services`) during the validation phase: authenticity dominates, and at ~10-15/week outcomes are trivially tracked by hand (replies land in the inbox; log them via the existing admin reply-log). Routing sends through the app/Resend — which buys automatic delivered/bounce/open instrumentation from a real from-address — is a **later option**, taken only if volume grows or automatic funnel metrics become worth the small loss of hand-written authenticity. Both are valid Mode B; the tradeoff is authenticity vs instrumentation.

5. **Shelve Mode A until a message is validated.** Mode A is a later scale-and-optimize lever, unlocked only when (a) a message is _proven_ to convert and (b) the binding constraint has shifted from "need first conversations" to "need volume of conversations." Scaling an unvalidated message is waste. The two external sending domains stay **parked** — unwired, and labeled "Mode A, not until message is validated" — so they stop haunting the roadmap.

6. **Mode B doubles as the message validation that gates Mode A and paid.** 15-30 real, personal sends over a couple of weeks, replies read by hand, is a genuine read on whether the pitch lands — cheap, fast, reversible, zero infra. It resolves the "no validated message" gap the six-email hand-test could not (six sends is below any threshold that could teach anything). This is the concrete first execution step.

7. **Operating envelope.** Soft, single CTA to `/book`; no pricing in the email (voice law); no fabricated content (P0). Keep addresses valid (individual mailboxes preferred over role addresses) to hold bounce and complaint rates well under the 2% / 0.3% enforcement lines. Kill any draft that implies pre-knowledge of the business (voice law #7).

8. **Relationship to ADR 0058.** This refines 0058, it does not overturn it. 0058's single objective (find good-fit prospects, drive to assessment) and portfolio sequencing hold. What changes: 0058's cold-email fast-channel is realized as **Mode B**, and its "ready-inventory activation runbook" (warm the domains, ship a ~20-email measured cohort) is the Mode-A shape and is **shelved** with Mode A.

## Consequences

- **Keep (live, in use):** the admin CRM cockpit (entity board + detail), the drafted-outreach decision rail, generators/pipeline-settings, follow-ups, the Resend webhook → `outreach_events` funnel, `promote-contacts`, and the 1:1 booking-link send path. Mode B leans on infrastructure that already works.
- **Cleanup (filed as follow-on issues, not this PR):** dead `scan_requests` table + its migrations; Outside View residue (stale comment in `get-started.astro`); the permanently-dead `scorecard_start` analytics metric + `website_scorecard` badge; a build-or-drop call on the never-built `reply` event parser (#590). Bulk "send outreach" stays deferred/unbuilt — Mode B does not need it.
- **External sending domains** remain registered but unwired; parked per Decision 5.
- The living detail in `docs/marketing/lead-gen-strategy.md` is annotated to point cold-email posture at this ADR; a full rewrite of its activation runbook is a follow-on.
- **Reversal triggers.** If Mode B at ~15/week for a few weeks yields near-zero replies _with_ clean deliverability and good-fit targeting, that is a **message** signal (revisit positioning, ADR 0058 / positioning-spine), not a reason to jump to Mode A. Mode A is reconsidered only when a converting message is proven and the constraint has shifted to needing volume.
