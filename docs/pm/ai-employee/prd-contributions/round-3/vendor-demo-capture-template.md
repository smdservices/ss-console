# Vendor Demo Capture Template

**Author:** External competitive analysis team (engagement May 2026)
**Date:** 2026-05-21
**Scope:** Reusable template for mystery-shop competitor demos (Eve Legal, EvenUp PLAAS, Law Practice AI, and any future legal AI vendor)
**Audience:** Internal use by SMD or contracted competitive-intelligence specialist

---

## Purpose

Public competitor pricing and packaging for legal AI vendors targeting PI plaintiff firms has been scrubbed from marketing pages. Quote-grade intelligence requires direct vendor demos, anonymized buyer interviews, or community-source collection.

This template captures the standardized buyer profile, demo request scripts, target questions, and quote-log format needed to run mystery-shop demos consistently across vendors. The output is a comparable dataset, not isolated anecdotes.

---

## Ethical and operational notes

Mystery shopping is a common B2B competitive intelligence method. It is not without ethical exposure. Before running mystery-shop demos:

1. **Confirm the engagement is internal or properly contracted.** SMD or a hired BD/competitive-intelligence specialist should run these demos. Do not ask external research vendors who have not been scoped for human-source collection.
2. **Do not misrepresent material facts that could create legal exposure.** The buyer profile below is plausible (a 7-attorney PI plaintiff firm in Phoenix evaluating AI vendors for 2026 operations). It is not a real firm with real matters. Disclose nothing that would create misrepresentation risk if challenged later.
3. **Capture, do not record.** Take notes during the demo. Do not record audio or video without explicit vendor consent.
4. **Single-firm profile across vendors.** Use the same buyer profile for all three vendors. Different profiles produce non-comparable quotes.
5. **Do not engage in post-demo sales contact.** Once the demo and pricing are captured, decline follow-up calls. Avoid creating a relationship that could later be characterized as deceptive.
6. **Consult counsel if a vendor's terms of service prohibit competitive intelligence demos.** Some vendors' terms explicitly prohibit demos by competitors. Check before scheduling.

---

## Standardized buyer profile

Use this profile for all three priority vendors (Eve Legal, EvenUp PLAAS, Law Practice AI) and any subsequent legal AI vendor demo:

> **Firm profile:** 7-attorney plaintiff personal injury firm in the Phoenix metro. Roughly 65-120 active matters. Mix of pre-litigation and litigation work. Current operational pain: intake follow-up gaps, medical-record collection delays, inconsistent client status updates, demand package prep bottleneck, inbox triage overhead, lack of case-status visibility across the team. Evaluating AI vendors before committing to a 2026 operations upgrade. Current case-management system: disclose only if the vendor asks; if asked, say the firm is "evaluating Filevine, CASEpeer, and SmartAdvocate workflows" rather than committing to one.

Do not lead with "AI employee" or any SMD-adjacent language. Let the vendor reveal their own packaging vocabulary. The objective is to capture what they sell, not to test their reaction to our positioning.

---

## Demo request script

For initial outreach (email or web form):

> Hi,
>
> We're evaluating AI tools for a 7-attorney plaintiff personal injury firm in Phoenix. We're especially interested in intake follow-up, medical-record collection, demand package support, inbox triage, client status updates, and integration with common PI case-management systems.
>
> Could we schedule a demo and get pricing and package details for a firm of our size?
>
> Thanks,
> [name]

Keep the request short. Vendors prefer short outreach because their sales teams qualify quickly. Do not over-specify; the vendor's discovery call will surface the specifics.

---

## Demo target questions

Ask each vendor the same 15 questions. Record answers in the quote-log template.

### Pricing and packaging

1. For a 7-attorney PI firm, what is the standard package you recommend?
2. What is included in base pricing?
3. What is excluded or usage-metered?
4. Is pricing per seat, per case, per user, per module, percentage-based, flat fee, or hybrid?
5. Is there a minimum annual commitment?
6. Is there an onboarding, implementation, or data migration fee?
7. How many users are included?

### AI behavior and review boundaries

8. How do you handle client communications?
9. Can the AI send messages externally, or does a human approve and send?
10. Can we inspect and edit what the AI knows about our firm, voice, workflows, and rules?
11. If we leave, what do we export?
12. Can one firm run multiple AI agents or personas with separate roles?

### Integration and onboarding

13. Which practice-management systems do you integrate with today?
14. Which integrations are native versus custom or professional services?
15. What does the first 30 days look like?

These questions are calibrated to surface evidence on the specific competitive dimensions AI Employee competes on (see [ADR 0012](../../../adr/0012-ai-employee-positioning-doctrine.md)). Questions 10, 11, and 12 are particularly important because they cover the moats (memory ownership, portability, multi-persona) that competitors are least likely to address publicly.

---

## What to capture

Take notes on:

- **Pricing slide** (or whatever surface the vendor uses to present pricing)
- **Package or tier slide** (modules included at each tier)
- **Implementation timeline** (when the firm is operational)
- **Integrations slide** (which case-management systems are supported)
- **Security and compliance slide** (HIPAA, SOC2, HITRUST claims)
- **AI-human-review workflow** (how the vendor describes the human-in-the-loop posture, or its absence)
- **Claim about firm memory or knowledge base** (any language about what the AI "knows" about the firm)
- **Claim about client messaging** (any language about how the AI communicates with clients)
- **Cancellation and export rights** (what happens at the end of the engagement)

Screenshots are valuable if the vendor shares slides via screen-share. Note: many vendors disable screen-sharing copy or require explicit consent. Do not capture screenshots without permission.

---

## Quote-log template

The output artifact. Use the same row structure for every vendor.

| Field                        | Description                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| Vendor                       | Eve Legal, EvenUp PLAAS, Law Practice AI, or other                                           |
| Source type                  | Vendor quote, buyer quote, or community (defined below)                                      |
| Firm profile quoted          | 7-attorney PI Phoenix (per standard profile)                                                 |
| Modules included             | What the standard package contains                                                           |
| Contract term                | 12 months, 24 months, month-to-month, etc.                                                   |
| Onboarding or setup fee      | One-time fee amount and what it covers                                                       |
| Monthly price                | Recurring monthly cost; note per-seat or per-case if applicable                              |
| Annual price                 | Annual prepay discount if offered                                                            |
| Minimum commitment           | Seat minimum, case minimum, or financial minimum                                             |
| Standard deployment includes | Integrations, training, support tier, SLA                                                    |
| Notes                        | Any qualitative observations (sales tactics, urgency, escalation, custom-quote-only signals) |
| Confidence                   | Quote-grade, community-grade, or rumor (defined below)                                       |

### Source type definitions

**Vendor quote:** SMD or contracted researcher received the quote directly from the vendor during a demo or sales call.

**Buyer quote:** A real PI firm or law-firm operator shared what they were quoted by the vendor. Anonymize the source. Capture firm size, geography, and stack to assess comparability.

**Community:** A pricing or packaging discussion observed in a forum (Reddit, legal-ops Slack, AAJ Slack, Discord, listserv) where the source is uncorroborated.

### Confidence definitions

**Quote-grade:** Vendor quote, buyer screenshot, proposal document, pricing email, contract excerpt, or first-person report from an attorney or operations lead who received pricing.

**Community-grade:** Reddit, Slack, Discord, listserv, consultant hearsay, secondhand "my friend was quoted" discussion. Useful as a directional signal, not as a binding number.

**Rumor:** Unsourced number, anonymous claim without firm size or module context, stale discussion older than 12 months.

---

## Adjacent intelligence-gathering motions

The mystery-shop demo is one of four collection motions that together produce quote-grade competitive intelligence. The other three:

### Direct attorney network outreach

Find PI attorneys in Arizona or comparable markets who have demoed Eve, EvenUp, or Law Practice AI in the last 6 months. Outreach template:

> Hi [Name],
>
> I'm doing some private buyer-side research on AI vendors for plaintiff PI firms, specifically Eve Legal, EvenUp PLAAS, and Law Practice AI.
>
> Have you demoed or priced any of them in the last 6 months?
>
> I'm not looking for confidential details, just practical buyer intel: rough pricing shape, what was included, contract length, onboarding fees, and what made you lean buy or no-buy.
>
> Happy to keep anything you share anonymous.
>
> Thanks,
> [name]

### Implementation consultant interviews

Independent consultants who implement Filevine, CASEpeer, or SmartAdvocate often see AI vendor adoption across their client base. Outreach template:

> Hi [Name],
>
> I'm researching how PI firms are evaluating AI vendors alongside Filevine, CASEpeer, and SmartAdvocate.
>
> A few questions, all high-level:
>
> 1. Which AI vendors are showing up most often in your PI client conversations?
> 2. Are firms asking about Eve, EvenUp PLAAS, or Law Practice AI?
> 3. What pricing or packaging patterns are you seeing?
> 4. Which case-management systems are most common in 3-20 attorney PI firms?
> 5. Are firms treating AI as a practice-management feature, a managed service, or a separate operational layer?
>
> Happy to keep your comments anonymous. This is for internal strategy, not publication.
>
> Thanks,
> [name]

### Community monitoring

Plaintiff-attorney Slack and Discord communities, AAJ member channels, and Reddit forums (r/Lawyertalk, r/Lawyers) host occasional pricing and evaluation discussions. Search for vendor names, "quote," "pricing," and "demo" terms over the last 12 months. Capture findings in the quote-log template with confidence labeled appropriately.

---

## Cadence and ownership

The quote-log is a living artifact. Recommended cadence:

- **Initial sprint:** 10 business days. Three vendor demos, three buyer interviews, two implementation consultant calls, community monitoring across the priority forums.
- **Refresh cadence:** Every 90 days. Vendor pricing changes; new packaging launches; community discussions surface new data points.
- **Owner:** SMD internally or a contracted BD/competitive-intelligence specialist. The external research team that produced rounds 1-3 is **not** scoped for human-source collection.

The quote-log lives at `docs/pm/ai-employee/prd-contributions/competitive-intelligence/quote-log.md` once collection begins. Until then, the template above is the empty form.

---

## References

- [ADR 0012](../../../adr/0012-ai-employee-positioning-doctrine.md) — AI Employee positioning doctrine (the dimensions the demo questions are calibrated against)
- [Round-2 competitive analysis](../round-2/competitive-analysis.md) §5 (pricing posture context)
- [Round-3 ethics architecture](./ethics-architecture.md) (the moats the demo questions probe)
