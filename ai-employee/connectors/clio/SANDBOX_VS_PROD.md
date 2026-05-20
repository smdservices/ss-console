# Clio sandbox-vs-prod gap notes

## Clio's developer environment posture

Clio does not provide a free public sandbox separate from production. The dev model is:

1. **Developer Application registration** at https://app.clio.com/settings/developer_applications (or regional equivalent). Free; requires a Clio account.
2. **Clio API access from your own production tenant.** Test against your own data in production. There is no "sandbox.app.clio.com" with isolated test data.
3. **Regional endpoints** for EU / Canada / Australia via env vars; default is US `https://app.clio.com/api/v4`.
4. **App Directory listing** required for commercial multi-tenant use. Free testing in your own tenant doesn't require listing.

For SMD's pre-demo pilot, we have two options:

### Option A — Test on a borrowed Clio tenant

Captain provides a Clio account (his own or a sandbox account from a friendly law firm contact). We OAuth into that tenant, run read-only tools against whatever data exists there, validate the tool surface works.

**Risks:**
- Real data in someone else's tenant. Must constrain to read-only operations.
- Any `create_task` / `create_note` writes pollute the tenant. Skip those during validation; verify schema-only.

### Option B — Test against Clio's API without any tenant data

Some Clio SDK examples use seeded test data via Clio's "Test Mode" feature in Developer Apps. Test mode allows API calls against a mock backend. Limited to a subset of endpoints.

**Risks:**
- Mock-mode coverage may not include all endpoints we use. Verification gaps.
- Mock data shape may differ from real prod data shape (custom fields, regional quirks).

### Option C — Defer until firm meeting; demo with skills wired to oktopeak but Clio integration unverified

Demo runs against synthetic data + LawPay sandbox + DocuSign Composio. Clio integration is shown as "wired to your Clio" with a code walkthrough, not a live round-trip.

**Risks:**
- Firm may probe "show me a live query against your test Clio."
- We don't get to surface tenant-specific gaps (custom fields) before meeting.

## Captain decision required

**Recommendation: Option A.** Captain stands up a personal Clio trial account (https://www.clio.com/sign-up/free-trial — 7-day free trial, no CC required at signup). We OAuth into that tenant, populate 3-5 mock PI matters with synthetic-but-realistic data (real-looking contacts, time entries, calendar entries — all `[SYNTHETIC]` flagged), and use it as the demo backend for the meeting.

**Captain action items if Option A:**
1. Sign up for Clio free trial. Use a venturecrane.com address that doesn't go to Captain's primary inbox so trial-expiry emails don't clutter.
2. Inside the trial Clio tenant: Settings → Developer Applications → Create new app. Name: "SMD AI Employee — Demo." Redirect URI: `http://127.0.0.1:5678/callback` (oktopeak default; we can change for hosted use).
3. Capture `client_id` + `client_secret`. Paste via pbpaste into `fly secrets set` once `hermes-demo-law` is provisioned (Step 4).
4. Inside the trial tenant: seed ~5 synthetic PI matters using Clio's matter-creation UI. Watermark each matter notes with `[SYNTHETIC FIXTURE — NOT A REAL MATTER]`.

**If Option B or C preferred:** flag during Captain async review on the calibration packet.

## Documented endpoint gaps (oktopeak)

Run live against trial tenant to confirm or refute:

| Endpoint | Expected (per oktopeak README) | Verify against trial |
|---|---|---|
| `list_matters(status=open)` | Returns paginated list with std fields | ✓ status filter works |
| `get_matter(id)` | Returns full matter incl. parties | ✓ check custom fields |
| `search_contacts(query)` | Name/email/org search | ✓ check fuzziness |
| `list_calendar_entries(from, to)` | Calendar in date range | ✓ check time-zone |
| `list_time_entries(matter_id)` | Time entries per matter | ✓ check billable-vs-non-billable flag |
| `get_billing_summary(matter_id)` | Outstanding balance + invoice history | ✓ check trust balance NOT exposed (good) |
| `create_task(matter_id, ...)` | Creates task | ✓ check task is visible in Clio UI after |
| `create_note(matter_id, body)` | Creates note | ✓ check note appears with correct author |

Update this table with PASS / FAIL / NOTES after the live round-trip.

## Custom fields strategy

If the trial Clio tenant supports custom fields (it does — Clio standard feature on all tiers), we should:

1. Add 3-4 custom PI-relevant fields to one or two matter types: `Case Value`, `Defendant Insurance Carrier`, `Statute of Limitations Date`, `Settlement Stage`.
2. Test whether oktopeak's `get_matter` returns custom field values.
3. If NOT, document the gap and decide between (a) thin extension to oktopeak via fork/PR (~2 hours), (b) demo without showing custom-field access and narrate the gap.

This is the single likely-discovery from the pilot. Surface to Captain at end of Session 1 calibration packet.
