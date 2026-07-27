# 10 — Scott → Christa: answers to the nine diligence questions

- **Date:** 2026-07-27 (10:45 MST / 17:45:41Z)
- **From:** Scott Durgan (smdurgan@smdurgan.com)
- **To:** Christa Barrera (Christa@ashtonandprice.com)
- **Subject:** Litigation Lifecycle Solution
- **Gmail message-id:** `19fa4aee294dff3f` (sent as a fresh thread, not a reply into thread `19f9106a765c30ff`)
- **Status:** **CANONICAL outbound** — answers `09`'s two settings, grid acceptance, alert-routing requirement, and all nine diligence questions. Chris's review of this letter gates the Smokeball authorization.
- **Commitments this email creates:** portal kill switch + entitlement controls (#2003), per-matter alert routing (#2004), the two config settings (#2005), M365 mail channel (#1978, ADR 0078), connector-outage alerting (#1990), token-usage monitoring with re-scope conversation, Claude-application connector access for firm-chosen users (rides the firm's Claude Enterprise account), BAA/DPA + service agreement to Chris, COI naming Ashton & Price LLP, 14-day export / 30-day destruction windows as DPA terms.
- **Captain edits vs the approved 10-DRAFT (sent 2026-07-27):** "authorization call" → "authorization process"; "waiving for your firm" → "waiving for the firm"; "available beyond them" → "available beyond those routines"; "directly inside Claude" → "directly inside the Claude application" plus new sentence "This is a connector we specifically built per Chris' requested way of working."; "more useful in month six than in month one" → "becomes more and more effective over time"; "It's not unlimited: if the work grows well beyond what we've configured together, we re-scope together" → "We will monitor token usage and if the work grows well beyond what we've configured, we re-scope together"; "best available AI models" → "best suited frontier AI models"; "read in your portal" → "review it in your portal"; sign-off "Thanks, Christa. / Scott" → "Thank you, / Scott Durgan". Sent in the settled SMD Services HTML letter format.

> Archived verbatim from the sent message's plaintext body. Formatting artifacts (list
> flattening, missing blank lines around subheads) are the mailbox's plaintext rendering
> of the HTML letter, not edits.

---

SMD Services
LITIGATION LIFECYCLE OPERATOR

Hi Christa,

Everything you need from us is below. Once Chris has reviewed, we're ready to schedule the Smokeball authorization process.

Your settings and the grid

Your two settings, confirmed:

Client verification: 3 unanswered attempts, then it escalates to a person.
Treatment-gap flag: 45 days, adjustable to 30 whenever you want to tighten it.
Grid: no changes made. Everything runs the pilot at the proposed starting levels, including client verification and records chase. The caps you set stand: anything to opposing counsel or the court always takes a person's send, and nothing touching deadlines or money auto-handles.

Alert routing
Yes. Smokeball carries the responsible attorney and assisting staff on each matter, and the Operator reads both. Case-level alerts route per matter to whoever holds those roles: verification stalls, deadline flags, and drafts awaiting review go to the assigned attorney or paralegal, and tracked items land in the matter as tasks assigned to them, the same way work reaches them today. Nothing case-level funnels to a single inbox on your side. System and technical monitoring stays with us.

The nine, point by point

1. BAA
   Yes. We'll have the signed agreement covering medical and client data in place before any records flow. We have it drafted and will send it with the service agreement for Chris's review; if you have a form you prefer, send it over and we'll work from that.

2. Pricing
   The Operator is $5,000 per month as a fully managed service. There's a one-time $4,000 stand-up fee, which we're waiving for the firm. Month to month with 30 days written notice. Billing begins when implementation testing wraps; there's no charge until then.

Here's what that covers.

The Operator itself. It runs the litigation-lifecycle routines we've configured together, and it's available beyond those routines: anyone at the firm can hand it a task or ask it a question, the same way they would a coordinator. Your team can also work with it directly inside the Claude application, pulling documents from Smokeball to review, highlight, and draft against. This is a connector we specifically built per Chris' requested way of working. We set up that access for the people you choose and maintain it.

It gets better with time. The Operator learns your matters, your processes, and how each person at the firm prefers to work, so it becomes more and more effective over time. What it learns stays yours: your data is never used to train models and never benefits anyone but your firm.

Everything needed to run it is in the price. All AI usage is included, nothing metered, no per-task charges. We will monitor token usage and if the work grows well beyond what we've configured, we re-scope together. We keep the Operator on the best suited frontier AI models as they release, monitor it around the clock, and respond to problems on the timelines committed in the service agreement. Everything it does is logged in a record you can review it in your portal at any time, kept for the life of the engagement and handed over in full if it ends.

The managed service is also a partnership. Technology is moving fast, and keeping up with it shouldn't cost your firm any attention; that's our job. We follow what's emerging, sort out what's actually useful for a practice like yours, and bring it to you: guidance, ideas, and ways to put the Operator to work that you may not have considered. We make sure the technology keeps working for you, quietly, without becoming one more thing you have to manage.

3. Business entity and insurance
   SMD Services is SMDURGAN LLC, an Arizona LLC formed in 2020, active and in good standing. We carry cyber liability and errors & omissions coverage that includes AI services coverage, extending E&O to claims tied to our AI services, plus privacy and regulatory coverage for personal and medical data. A certificate of insurance naming Ashton & Price LLP will follow.

4. Security certifications
   We don't hold SOC 2, ISO 27001, PCI DSS, or Cyber Essentials. The controls are architectural and enforced in code and CI:

We don't keep a copy of your matter files. The Operator reads them through authorized API calls, does the task, and writes the results back into your systems, with Smokeball remaining the system of record. Two things live on your dedicated machine and contain matter references: the audit trail and the Operator's working memory, both covered by the agreements in item 1 and the destruction terms in item 5.
One isolated machine per client, with its own encrypted volume. No shared data store between clients.
Connection credentials live only on your machine at restricted permissions, never in logs. The most sensitive are held behind a broker the agent can't read.
Fail-closed permissions: the Operator can't take a consequential action it wasn't explicitly authorized to take. Sending under a firm principal's identity is banned in code, inbound email is fenced so instructions hidden in it can't drive actions, and an output gate screens client-facing output for fabricated or unsupported content before any send.
A hash-chained, append-only audit log the agent can't rewrite.

Every code change runs dependency scanning (the build fails on high or critical findings), full-history secret detection, and static analysis against the OWASP Top Ten, on every change and daily. We maintain a threat model and review security against it on a regular cadence; the most recent full review was this month. Periodic adversarial audits verify findings by live exploit and track remediation to closure. Fly.io and Anthropic are SOC 2 Type II audited, and Cloudflare holds SOC 2 and ISO 27001.

5. Data on termination
   Matter data and drafts stay in your Smokeball throughout. The Operator writes tasks, calendar entries, folders, and drafts into your system and never keeps a separate copy, so at the end they're already yours with nothing to return or delete. The audit trail and the operational memory the Operator built sit on infrastructure dedicated to your account. On termination you receive both in exportable form within 14 days. Your dedicated machine and volume are then destroyed, with the full return-and-destruction window at 30 days and written destruction attestation on request. Our control plane holds only account and billing records and high-level governance summaries; those are deleted on the same window except records we're legally required to retain for tax and accounting. These windows are contractual terms in the data processing addendum we'll execute alongside the BAA.

6. Kill switch
   The way to stop the Operator is the pause control in the portal. It stops all activity immediately and stays off until it's turned back on, and your authorized portal users can do it without us. Cutting the Operator's connection to Smokeball entirely is also available to you through your Smokeball owner, but that's an emergency brake rather than the routine way to pause. Every pause and resume is logged.

7. Access control
   The portal gives authorized users access to the kill switch and the entitlement settings. We'll set that up for the two people you name, and every change is logged with who made it and when. On our side, we change entitlement settings only at the request of your named administrators, and every change, yours or ours, lands in the same audit record.

8. Subprocessors
   AgentMail is a third-party vendor, not a product we operate. It's the default mailbox we provide for Operators where that fits the client. For your firm our recommendation is that we not use it: we configure the Operator with its own mailbox in your Microsoft 365 tenant, so every email it sends or receives stays inside your system, under your retention and your controls, visible to you like any staff mailbox. Access is scoped at the tenant level so the Operator can reach only its own mailbox and no one else's. This removes AgentMail from your engagement entirely, and mail stays under your own Microsoft terms.

9. Failure mode
   Neither queue-and-guess nor silent skip. If Smokeball or the mail channel is unreachable, the Operator stops rather than working from stale or partial data. Its scheduled routines read what's outstanding from Smokeball on every run rather than relying on having watched events happen, so when the connection returns, the next run picks up exactly the work that's still pending. An outage delays work; it doesn't lose it. Event-driven triggers are backstopped by a scheduled reconciliation pass for the same reason. Every deadline the Operator flags is written into Smokeball, which remains your calendar of record, so an outage never removes anything from your calendar; it pauses the chasing until the connection returns. Connection and process failures alert us, and per your note, that system monitoring stays ours to own.

Thank you,
Scott Durgan
