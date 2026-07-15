# Track D: Internal Audit of smd.services Ad-Tracking / Funnel Readiness

Audit date: 2026-07-05. Scope: can smd.services attribute a paid-ad click to a
booked assessment call today? Source: direct read of the `ss-console` repo.

## TL;DR

The site has honest, privacy-conscious first-party analytics and a fully
owned booking funnel, but it is **structurally unable to attribute a booked
call to a paid ad**. Entry attribution (UTM / gclid / fbclid) is discarded at
every layer by design. There is no Meta pixel, no Conversions API, and no
offline-conversion loop. Before spending a dollar on ads, the click-ID capture
layer has to be built. The good news: because the booking system is
first-party (not a vendor iframe), the offline-conversion loop is easier to
build here than in a typical Calendly setup.

## What exists today

### 1. GA4 is live on the marketing surface (with ad signals OFF)

- `src/components/Analytics.astro` loads GA4, gated on
  `PUBLIC_GA4_MEASUREMENT_ID` and suppressed on `admin.`/`portal.` subdomains.
- The ID is set for production: `.env.production` -> `PUBLIC_GA4_MEASUREMENT_ID=G-QL8FNDRB7W`.
- `public/js/ga4-init.js` configures GA4 with `allow_google_signals: false`,
  `anonymize_ip: true`, and internal-traffic filtering (`?internal=1`
  localStorage flag + host patterns). There is a reusable `window.ssTrackEvent`
  helper for custom events.
- **Implication:** `allow_google_signals: false` disables Google Ads
  remarketing audiences and cross-device signal. GA4 is currently a
  reporting-only analytics install, not wired to power Google Ads optimization.
  It is included via `Base.astro` (marketing) and `AdminLayout.astro`.

### 2. First-party event pipeline (D1-backed) — but query strings are scrubbed

- `src/components/EventsTracker.astro` tracks `page_view` and `cta_click`
  (via `data-ev` attributes), keyed to a 30-day first-party session cookie
  `ss_sid`, batched and flushed to `/api/events` (sendBeacon on unload).
- `src/pages/api/events.ts` persists to a D1 `events` table with columns:
  `session_id, event_name, path, ts, metadata, user_agent, referrer, country`.
  So the **HTTP referer and country are captured**, but campaign params are not.
- **The decisive constraint:** `EventsTracker.astro` `scrubPath()` strips
  everything after `?` and `#`, and its header comment states explicitly:
  "Never pass form values or URL query strings into metadata." Metadata is
  whitelisted client-side and re-validated server-side. This is a deliberate
  privacy choice, and it means **UTM / gclid / fbclid never enter the
  first-party pipeline**.
- At the time of this audit there was an admin analytics view with a 7-day
  conversion funnel over these events. **(Retired 2026-07-14, ADR 0077: the
  dashboard and its query layer were deleted as a dead pipeline-funnel surface.
  The `events` capture pipeline still writes; funnel reporting comes back only
  when there is a real question to answer.)**

### 3. Booking funnel is fully first-party (a real advantage)

- `/book` (`src/pages/book.astro`) is a native intake/booking page:
  `IntakeIntroCard` + `IntakeSlots` + signed prefill tokens (`?t=<token>`) for
  admin-issued links, and an `?interest=<sku>` param (allow-listed in
  `src/lib/booking/config.ts`) carried from marketing CTAs (e.g.
  `/operator -> /book?interest=operator`).
- Reservation is handled by `src/pages/api/booking/reserve.ts` (own endpoint,
  D1-backed), which stores a coarse `source` field of `'website_intake_booking'`
  or `'admin_booking_link'`. No campaign/click-ID attribution.
- **Why this matters:** the booking "conversion" happens on SMD's own server,
  not inside a Calendly/Cal.com iframe. The "one-way mirror" problem that Track
  C flags for vendor calendars does not exist here. The reserve handler is the
  natural, already-owned place to fire a server-side conversion (Meta CAPI +
  Google offline import) the moment a real call is booked.

## What is missing (the gap list)

| Capability                         | Status                             | Needed for                                        |
| ---------------------------------- | ---------------------------------- | ------------------------------------------------- |
| UTM capture on landing             | MISSING (scrubbed)                 | Attributing creative/campaign to a booked call    |
| gclid capture (Google)             | MISSING                            | Google Ads offline conversion import              |
| fbclid / `_fbc` capture (Meta)     | MISSING                            | Meta CAPI attribution                             |
| Meta Pixel                         | MISSING (none in repo)             | Meta ad optimization / retargeting                |
| Meta Conversions API (CAPI)        | MISSING                            | Reliable server-side conversion signal            |
| Click-ID persisted on lead/booking | MISSING (`source` only)            | The offline booked-call loop                      |
| Offline conversion upload          | MISSING                            | Optimizing ads to qualified calls, not form-fills |
| GA4 <-> Google Ads link + signals  | OFF (`allow_google_signals:false`) | Google Ads audiences/conversions from GA4         |
| Cookie-consent banner (marketing)  | NONE found                         | CCPA notice / any future EEA exposure             |

No Meta/Facebook pixel, CAPI, or business SDK reference exists anywhere in
`src/` or `public/` (verified by grep). There is no marketing cookie-consent
banner (the `consent` hits in the tree are OAuth/operator internals, not a
site cookie banner). A `privacy.astro` page exists and loads Analytics.

## Readiness verdict

- **Analytics hygiene: good.** Internal-traffic filtering, first-party session,
  privacy-first posture, an existing funnel view. This is a clean base.
- **Ad-attribution readiness: not ready.** A booked call today is an
  unattributable event. If ads ran now, SMD could see aggregate GA4 traffic and
  a coarse referrer, but could not answer "which ad/creative produced this
  booked assessment" — the only question that matters for a high-ticket,
  low-volume offer, and the exact loop Track C identifies as the strategic core.

## Minimum build to be ad-ready (feeds the Phase 2 ADR / engineering scope)

Ordered, smallest-first. Each is a discrete unit of work; sizing is Captain's call.

1. **Capture entry attribution without breaking the privacy posture.** On first
   marketing landing, read `utm_*`, `gclid`, `fbclid` from the URL and persist
   them to a first-party cookie or the `ss_sid` session record server-side
   (NOT into the scrubbed `events` metadata — keep that pipeline clean). This is
   the linchpin; nothing else works without it.
2. **Thread click IDs through `/book` into `reserve.ts`.** Store `gclid`,
   `fbclid`, and the UTM set on the booking/lead row alongside the existing
   `source`.
3. **Fire server-side conversions from `reserve.ts` on a real booking.** Meta
   CAPI (`fetch` to the Graph endpoint) + Google Ads offline conversion import,
   keyed on the stored click IDs, using `ctx.waitUntil()` for fire-and-forget
   (matches the repo's Workers convention). This is the booked-call loop.
4. **Add the Meta Pixel** (browser) with a shared `event_id` matching the CAPI
   event for deduplication (see Track C).
5. **Decide GA4 posture:** either link GA4 to Google Ads and turn signals on for
   the marketing property, or keep GA4 reporting-only and drive Google Ads
   purely off the offline-conversion import. (Recommend the latter for privacy
   consistency; the offline import is the higher-quality signal anyway.)
6. **Add a lightweight CCPA cookie/privacy notice** before any pixel ships;
   confirm US-only ad geo so the heavier EEA Consent Mode v2 path can be
   deferred (see Track C, section 2).

## Cross-references

- The booked-call offline loop rationale and implementation patterns: `03-funnel-and-tracking.md`.
- Why qualified-call optimization matters for this offer's economics: `02-channel-economics.md` (Task 2, minimum viable test budget).
