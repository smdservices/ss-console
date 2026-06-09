# Workers Migration — Validation Checklist

Run this checklist against the Worker preview URL (`https://ss-web.<subdomain>.workers.dev`) **before** flipping the three custom domains from Pages to the Worker. Tick each item; do not cut over while any item is failing.

Pair this with `wrangler tail ss-web --format pretty` running in a second shell — any unhandled exception during these checks blocks the cutover.

## Static + SSR

- [ ] `GET /` → 200, contains marketing nav markup
- [ ] `GET /book` → 200, contains Turnstile widget markup
- [ ] `GET /contact` → 200
- [ ] `GET /get-started` → 200
- [ ] `GET /scorecard` → 301 redirect to `/` (retired in PR #702/#703)
- [ ] `GET /404-nonexistent` → 404 with prerendered 404 body
- [ ] `GET /favicon.svg`, `/og-image.png`, `/scott-durgan.jpg`, `/robots.txt` → 200 from `[assets]` binding
- [ ] `GET /sitemap-index.xml` → 200 (Astro sitemap integration)

## Auth

- [ ] `POST /api/auth/login` with valid admin creds → 200 + `Set-Cookie`
- [ ] `POST /api/auth/login` with bad creds → 401
- [ ] `GET /api/auth/google/connect` (with admin session) → 302 to `accounts.google.com` with correct `redirect_uri`
- [ ] `POST /api/auth/magic-link` (client email) → 200, triggers Resend send
- [ ] `POST /api/auth/logout` → 200, `Set-Cookie` clears session

## Admin API (session-required)

- [ ] `GET /admin` without session → 302 to `/auth/login`
- [ ] `GET /admin` with valid admin session → 200
- [ ] `GET /api/admin/engagements` → 200 JSON (D1 read path)
- [ ] `POST /api/admin/invoices` → 201 (D1 write path)
- [ ] `POST /api/admin/assessments` with file → 201 (R2 write via STORAGE)
- [ ] `POST /api/admin/resend-invitation` → 200 (Resend outbound)

## Portal API (session-required)

- [ ] `GET /portal` with client session → 200
- [ ] `GET /api/portal/documents/<id>` → 200 (R2 read via STORAGE)
- [ ] `GET /api/portal/consultants` → 200, consultant-photo URLs resolve (CONSULTANT_PHOTOS public R2)
- [ ] `GET /api/portal/quotes/<id>` → 200

## Booking

- [ ] `GET /api/booking/slots?date=...` → 200, non-empty (Google Calendar free/busy path)
- [ ] `POST /api/booking/reserve` with valid Turnstile token → 201 (KV rate-limit write, D1 hold insert)
- [ ] `POST /api/booking/reserve` without Turnstile → 403
- [ ] `GET /book/manage/<token>` → 200 (magic-link token validation)

## Webhooks

- [ ] `POST /api/webhooks/stripe` with valid `Stripe-Signature` → 200 (verifies `STRIPE_WEBHOOK_SECRET`)
- [ ] `POST /api/webhooks/stripe` with invalid signature → 400
- [ ] `POST /api/webhooks/signwell` with valid signature → 200 (verifies `SIGNWELL_WEBHOOK_SECRET`)
- [ ] `POST /api/webhooks/signwell` with invalid signature → 400

## Misc

- [ ] `POST /api/ingest/signals` with `Authorization: Bearer $LEAD_INGEST_API_KEY` → 200
- [ ] `POST /api/contact` → 200 (Resend send)
- [ ] `GET /api/health` → 200 JSON with all bindings defined

## Session lifecycle

- [ ] Log in, wait ≥ 6 minutes, hit `/admin` → session renews (sliding window)
- [ ] Log out → subsequent `/admin` redirects to login (KV delete confirmed)

## Observability

- [ ] `wrangler tail ss-web` → no unhandled exceptions across the full run
- [ ] Cloudflare dashboard analytics widget shows request volume matching the checklist traffic

## Subdomain rewrite middleware

**Cannot validate fully on `ss-web.<subdomain>.workers.dev`** — the middleware keys off `admin.` / `portal.` hostnames. Options:

- Spot-check with `curl --resolve admin.smd.services:443:<worker-ip> https://admin.smd.services/` before DNS cutover
- Defer full validation to the post-cutover smoke

## D1 migrations

- [ ] `wrangler d1 migrations list ss-console-db --remote` → no pending migrations

## Cutover blockers

**Do not flip DNS while any of the above is red.** If a check fails, fix it on the Worker deployment; leave Pages serving the live hostnames until the Worker is green.

## Post-cutover smoke (after DNS flip)

Run against real hostnames:

- [ ] Top nine marketing GETs against `https://smd.services/`
- [ ] One end-to-end booking flow: hold → confirm → email received
- [ ] `wrangler tail ss-web` clean for 10 minutes
- [ ] Stripe dashboard → resend a recent test event → verify 200 + D1 side-effect
- [ ] SignWell → resend a recent event → verify 200

Delete the Pages project once the cutover smoke passes. SS is not yet in production use — there's no rollback-retention requirement.
