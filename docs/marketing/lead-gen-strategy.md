# Lead-Generation Strategy

**Status:** Living. v1 draft 2026-06-30.
**Owner:** Captain.
**Source research:** `docs/research/lead-gen/` (6-panel expert research + internal grounding, 2026-06-30).
**Companion decision:** a thin ADR (next free number 0058) can record this once confirmed.

---

## 1. The one objective

This document governs a single objective: **find good-fit prospects and drive them to an assessment, and produce as many good ones as we can.**

It is about acquisition only. Everything downstream of the assessment is explicitly **out of scope here**: who or what runs the assessment, how it converts, and how much it can handle are not constraints this strategy plans around. If prospect supply ever outstrips our ability to assess and close, that is a success condition we will solve when it arrives, not a limit we design for now.

"The assessment" is the single front door (the site's one-door model). This document is everything to the **left** of that door.

## 2. What "good" means, and the two-geography rule

The only quality bar is **fit**. A good prospect is a right-fit candidate for one of our two offers, reachable and drivable to an assessment. Fit is coupled to geography, because the two offers reach in different ways:

- **Arizona-local consulting.** Owner-led Arizona businesses we can serve in person (the Phase-1 default). Found and reached locally.
- **National Operator packs (12 verticals).** Right-fit firms anywhere, reached digitally.

**Split every channel and every lead on this line first.** A national lead is junk for in-person consulting; a non-fit local business is junk for a pack. "Good" is defined per offer, never in the abstract.

Qualification is by fit in conversation, not by a guessed revenue figure. The prior revenue-band gate is retired (ADR 0003).

## 3. Current-state ground truth

Build from fact, not memory. As of 2026-06-30:

- **The engine exists and runs daily.** Four signal pipelines (job postings via SerpAPI, new-business filings via city open-data, reviews via Outscraper, social listening via Reddit which is unwired), a 13-module enrichment layer, an admin CRM, and outreach drafting. 357 entities to date, still producing each morning on cron.
- **~100 enriched, drafted prospects sit untouched** in the `signal` stage (102 carry a drafted outreach message). **Not one has ever been sent to a real lead.** No real outbound conversion test has ever run. (The `outreach_events` table holds only internal/test rows, no engagement events.)
- **Two authenticated sending domains are ready:** `getsmdservices.com` and `smdurganservices.com`. Google Workspace mailboxes, with SPF, DKIM, and DMARC complete on both. They were **never warmed** and no warming vendor was ever connected (a conscious deferral, not a half-finished build).
- **No acquisition measurement.** Outreach sends are not instrumented, so replies and bounces are unseen.

**Do not re-propose** (settled, retired):

- Outside View / public-footprint diagnostic scraping (surfaced nothing useful; ADR 0002 superseded).
- The prior revenue-band qualification gate (ADR 0003).
- Phoenix-only geography at the lead-gen layer (now statewide Arizona).

## 4. The channel portfolio

Six channels. For each, the questions are only: does it find **good-fit** prospects, and does it drive them to the assessment? They are grouped by how quickly they can produce good prospects and how ready we are to run them. There is no capacity gate anywhere below; more good prospects is always better.

### Fast: can produce good prospects in the near term

- **Founder network and local rooms** (BNI, chambers, EO, Vistage, accountant and bookkeeper contacts). The warmest, highest-fit Arizona-local prospects. Every conversation routes to the assessment. Ready today, nothing to build.
- **Partner-as-customer placements.** Place an Operator inside a friendly bookkeeper, fractional CFO, or (where compliant) attorney firm. One relationship yields a paying customer, a live demo of the work, a case study, and a warm referral source, with the referral riding on a real working relationship rather than a cold ask. The partner sees the operational pain from the inside, so their referrals are the highest-fit leads available. Lead with the least-regulated partners (bookkeepers, fractional CFOs) where a clean referral arrangement works; use reciprocity, not fees, for regulated professionals (no referral fees to attorneys or attest-client CPAs, per their conduct rules).
- **The ready-inventory cold-email test.** Hand-send a small batch of genuinely personalized emails to the best Phoenix-metro signal leads, from a ready Workspace mailbox. This is the first real test of whether signal-based outbound produces a good prospect at all. Low volume needs no warming program; the only prerequisite is mailbox access.

### Medium: build now, produces over the following weeks

- **Acquisition measurement and deliverability foundations.** Wire reply and bounce tracking so any send is instrumented (see Section 5); confirm mailbox access; choose a sending and warming tool only if the cold test shows real signal worth scaling.
- **Organic foundations.** Complete the Google Business Profile (Arizona-local discovery) and bring each pack page to a direct, sourced answer for its comparison query (the "should a [vertical] hire a coordinator or use a managed Operator" question), so inbound prospects self-select and arrive warm. Build to `pack-standard.md`.
- **Signal-engine completion.** Finish the outreach-to-assessment seam so the running scrapers actually drive prospects to the front door, instrumented end to end.

### Slow: plant now, compounds later

- **The Operational Drag Index.** An anonymized, aggregate data study built from the signal corpus, sliced by vertical. This is the one earned-media asset no competitor can copy: everyone pitches "AI for the back office," but only we hold the data. It feeds digital PR, podcasts, pack-page SEO, and founder thought leadership at once. Make it a recurring release.
- **Organic and topical authority** plus founder thought leadership (concrete, data-backed posts, not hot takes).
- **Community presence**, seeded and human, pack-aligned, on a genuine-participation discipline.
- **Paid acquisition.** A scale-and-optimize lever, not the first dollar. It needs a validated, converting message and funnel before spend is efficient, otherwise it optimizes against nothing and teaches a false negative. On the radar for visibility; turn on once a channel has shown which message converts.

**Geography overlay:** network, partners, local SEO, and Phoenix press serve Arizona consulting. Cold email, community, trade press, and pack-page SEO serve the national packs.

## 5. Acquisition measurement

We cannot tell which channels produce **good** prospects without measuring the path: source, touch, reply or click, front-door visit (UTM-tagged), assessment booked. Wire this before or alongside running any channel. The metric that matters per channel is **good-fit assessments booked**, and the effort or cost per booked assessment. Read replies and bounces, not opens (opens are noise after Apple Mail Privacy Protection). This is the instrument that tells us which channels earn more investment.

## 6. Ready-inventory activation runbook (the fastest first signal)

The cheapest real learning we can buy, using inventory and infrastructure we already own:

1. **Split** the ~100 drafts on geography: Phoenix-metro to consulting or a pack; out-of-metro to a pack.
2. **Grade** a sample of drafts (Captain); kill any that imply pre-knowledge of the prospect's business (voice law: no claim to know the prospect's business).
3. **Confirm** Workspace mailbox access on a sending domain.
4. **Hand-send** a small first cohort: personalized, opening on the observed signal, with one soft front-door call to action. Read the replies.
5. **Decide** from real data: if it produces good conversations, invest in warming and a tool to scale; if not, we have learned cheaply and reallocate effort to the warmer channels.

## 7. What to validate first

- Does signal-based cold outbound produce good-fit prospects who book? (Never tested.)
- Which signal types (job postings, new-business filings, reviews) yield the best-fit prospects?
- Draft quality, which is unvalidated against a single real reply.
- The invisible-pain problem: owners do not search for their objective and rarely post it cleanly, so demand-capture channels must target symptom language and adjacent commercial queries, and demand-gen must dramatize the symptom rather than wait for the owner to name it.
- Which partner types refer fastest and within their compliance limits.

## 8. The assessment is the destination, out of scope here

This document ends at the front door. The form of the assessment, and anything about how much of it we can run, are deliberately not part of this strategy. Our job is to fill the front door with good-fit prospects.

## 9. Maintenance

Living document. Update it in the same pull request that changes what it says (the handbook maintenance contract). The companion decision record is the place to log a material change of direction.
