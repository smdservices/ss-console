# 05 — Round-Two Addendum: Endemic Channels, Show-Rate, Platform Shifts

_Compiled 2026-07-05 by a second research pass run in parallel with the dossier
(three tracks: competitor teardown, channel benchmarks, funnel/tracking). Most of
that pass independently converged on the dossier's findings and ADR 0066's
decisions; this file records only what the dossier does not already cover. It
changes nothing about round one. Everything here is round-two input or feeds an
already-filed issue._

## 1. Legal-endemic and partnership channels (round-two candidate)

ADR 0066 §4 defers "legal-tech podcast/newsletter sponsorship" to round two.
Specifics gathered for when that decision comes up:

- **How incumbents actually grow.** Clio, Smokeball, Smith.ai, and Lawmatics lead
  with content, owned events, and integration partnerships, not cold paid social.
  The concrete pattern: Smith.ai and Lawmatics run joint webinars and cross-promote
  through their integration, each marketing to the other's installed base
  (smith.ai/blog/video-smith-ai-lawmatics-webinar-growth-tactics-for-the-modern-law-firm).
- **The highest-leverage single endemic move for SMD is Smokeball co-marketing.**
  We are already inside their ecosystem via the pilot integration. A joint
  webinar or integration-directory listing reaches PI-firm owners with borrowed
  trust that no cold impression buys. Requires a Captain-approved outreach
  conversation; costs relationship capital, not media dollars.
- **Named venues where law-firm owners are reachable** (rate cards are not public;
  request directly):
  - Podcasts: Maximum Lawyer (explicitly for firm owners scaling, active Facebook
    community), Lawyerist, LawNext, Technically Legal
    (naegeliusa.com/blog/the-best-legal-podcasts-for-2026).
  - Conferences: ABA TECHSHOW (practical tool-buying lawyers; 2026 edition was
    March, next cycle spring 2027), ClioCon (Oct 26-27, 2026), ILTACON (Aug 2026,
    big-law skew) (clio.com/blog/best-conferences-for-lawyers/).
  - Publications: Law.com/ALM topic sponsorships, Law360 (2.7M legal
    professionals, limited ad inventory) (law.com/advertise-with-us/).

## 2. Show-rate economics (feeds #1738)

A held call, not a booked one, is the unit the funnel buys. The dossier's funnel
track touches no-show follow-up in passing; the numbers:

- Unmanaged B2B discovery-call no-show runs up to ~40%; managed programs get to
  ~20% individual and ~10% net (calendly.com/blog/reduce-no-show-rates-sales).
- Levers, in order: qualify before booking (already our form-first shape), offer
  slots within 5 business days (never more than 10), reminders at 24h and 2-3h
  before the call. SMS reminders cut no-shows ~35% on top of email (98% open
  rate; strongly corroborated across sources, e.g.
  notifyre.com/us/blog/reduce-appointment-no-shows-with-sms-text-message-reminders).
  SMS adds a vendor and phone-compliance surface, so it is a separate Captain
  decision; email reminders are the floor (#1738).

## 3. Platform shifts not yet in the dossier (measurement posture)

Both reinforce the ADR's D1-as-source-of-truth stance:

- **Meta retired the 7-day-view and 28-day attribution windows in January 2026.**
  B2B advertisers with 2-4 week cycles lose an estimated 20-40% of attributed
  conversions from dashboards, and 40-60% of Meta's reported conversions are now
  modeled rather than observed (dojoai.com/blog/meta-ads-attribution-2026-changes-fixes,
  conversios.io/blog/meta-attribution-window-changes-2026-fix-your-tracking/).
  Platform dashboards are directional; the weekly readout (ADR 0066 §6) computes
  from D1.
- **Google moved offline and Enhanced-Conversions-for-Leads uploads to the Data
  Manager API on 2026-06-15**; the old path in the Google Ads API is blocked.
  The offline loop (#1736) must build on Data Manager API only
  (support.google.com/google-ads/answer/15713840).
- Safari's 7-day client-storage cap is already neutralized for us: the gate-1
  attribution cookie is server-set and HttpOnly (shipped in #1728), so the
  durable record lives server-side as intended.

## 4. Keyword price-frame note (complements the ADR §3 copy rule)

The Google harvest lane ("ai receptionist for law firms" and adjacent intent,
ADR 0066 §4) borrows intent from a product category priced at $29-400/mo
(Dialzara from $29, Rosie $49, Goodcall $59, Smith.ai from $95; sources in the
dossier's Track A and cloudtalk.io/blog/best-virtual-receptionist-for-law-firms/).
A searcher arriving from that lane carries a bot-priced anchor. The LP that
catches this traffic should reframe from the phone to the role in its first
beat (the coordinator work around the call: intake follow-through, matter
deadlines, referral updates), consistent with pricing against a salary
(ADR 0037 Tenet 1) and the salary-anchored-no-dollars copy rule (ADR 0066 §3).
This is an LP-craft note for #1726, not a strategy change.

## 5. LinkedIn round-two supporting evidence

The dossier's Track B already carries LinkedIn benchmarks and the deferral
rationale. One additional datapoint for the round-two case: a 2025 eMarketer
study found LinkedIn the only major platform with positive B2B ROAS (121%,
vs Google Search 67% and Meta 51%)
(emarketer.com/content/linkedin-achieves-121--roas-leads-b2b-marketing-paid-performance).
At Operator economics, partner-title CPLs of $150-250 are comfortably viable
once a winning message exists to spend behind.
