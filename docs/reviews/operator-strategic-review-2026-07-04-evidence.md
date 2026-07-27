---
title: Evidence Audit - Strategic Review Wave (2026-07-04)
---

# Evidence Audit: everything claimed done, re-observed cold

**Date:** 2026-07-04, end of the execution wave.
**Method:** every claim from the wave was re-verified from live state with fresh commands at audit time, against `origin/main @ 77474cd2` and the running production systems. Nothing below is cited from session notes; each line is a fresh observation. One claim failed the audit and is reported as a red finding, not explained away.

## Red finding (claim was wrong)

**#1681 was reported "closed, consolidated into the A&P plan." It is OPEN.** The repo's own `unmet-ac-on-close` gate reopened it ten seconds after the close (closed by SMDurgan 17:33:12Z, reopened by github-actions[bot] 17:33:22Z, "closed with 5 unchecked AC items") and the session reported the close without noticing the reopen. The gate is right: the substance (ashton-price reprovision picking up PI v0.2.0 + the heartbeat emitter, and the live lifecycle test) is genuinely not done and is pending in the A&P go-live ladder (#1669). Corrected tally: **10 of 13 wave issues fully done**, #1681 open-pending, #1686 and #1687 open.

## Repository state (origin/main @ 77474cd2)

All fourteen claimed artifacts exist on main (checked with `git cat-file -e origin/main:<path>`): ADRs 0050, 0064, 0065; the substrate-watch doc; the DPA template; the review doc; `security.astro`; `ai-disclosure.astro`; the Stripe subscriptions client; the subscription webhook handler; migration 0084; the CI coverage-conformance test; the handbook incident-response page; the 485-line task-execution framework doc.

Content spot-checks (grep against `origin/main`, counts as observed):

| Check | Result |
| --- | --- |
| DPA blanks remaining (`\_\_`) | 0 |
| ADR 0040 "Amendment (2026-07-04)" present | yes |
| Talk-track EvenUp rows | 3 |
| Substrate CI full pytest invocation (`bin/tests workspace_broker/tests templates/tests tests skills`) | yes |
| `home.ts` calls `readMachineRuntime` | yes |
| `aliveness.ts` reads `fleet_status` | yes |
| Webhook route dispatches retainer + lifecycle handlers | yes |
| `docs/adr/index.md` entries for 0050/0064/0065 | 3 |
| Footer links `footer-security` / `footer-ai-disclosure` | 2 |

## Live production state (fresh at audit time)

| Claim | Fresh observation |
| --- | --- |
| Trust pages live | `GET smd.services/security` 200; `GET smd.services/ai-disclosure` 200; footer link present on the live homepage |
| Migration 0084 applied AND tracked | `d1_migrations` has the 0084 row (count 1); `stripe_subscription_id` column queryable |
| Pricing authored on live seats | 2 services rows with `recurring_price` authored at list |
| Pilot seats deliberately unbilled | 0 subscriptions rows with `stripe_subscription_id` attached (correct per ADR 0063: pilot/dogfood invoice $0) |
| Heartbeats live | 2 seats with `last_heartbeat_ts` under 5 minutes old (smd, pilot-smokeball; ashton-price has no row until its reprovision - known, honest) |
| Stripe webhook endpoint | enabled, 5 events: invoice.paid, invoice.payment_failed, invoice.finalized, customer.subscription.updated, customer.subscription.deleted |
| Retainer Product | `prod_UpCCwaGbxwpeu3` exists, active |
| Billing smoke artifacts safe | smoke subscription `status=canceled`; its draft invoice `status=draft, auto_advance=false` (inert, will never email) |
| Runtime-read seam | `GET /runtime/audit_log` returns 200 with entries on both live Machines (hermes-smd, hermes-pilot-smokeball), per-customer HMAC bearer |
| Prod webhook runs the NEW dispatch | signed synthetic `customer.subscription.updated` returns `{"ok":true}` (the new handler's honest-skip; the legacy ack echoed the event name) |
| Prod webhook rejects tampering | same payload with a forged signature returns **401** |
| Deploy green at main HEAD | deploy.yml `completed:success` at 77474cd2 |
| Substrate CI green at main HEAD | operator-substrate.yml `completed:success` at 77474cd2 (running the full 640-test invocation) |
| Overlay README fixed | overlay `origin/main` README says "Twelve plugins" |

## Issue ledger (fresh)

Closed: #1678, #1679, #1680, #1682, #1683, #1684, #1685, #1688, #1689, #1690.
Open: **#1681** (red finding above), #1686 (audit hash-chain), #1687 (invariant-8 decision), #1709 (heartbeat-red alerter, filed from ADR 0064's honesty banner).

## Verification ledger

Cross-session `crane_verify` records written during the wave, each carrying the literal command output: `vfy_01KWQ1H3RHWM5YWECEF4H2FR4Q` (audit_log seam), `vfy_01KWQ1H8K24BATTVSF6AYCR04P` (fleet_status aliveness source), `vfy_01KWQ29GGE8EP59MGM0HFJR18E` (substrate CI ran its own rewiring), `vfy_01KWQ4JASKF8D7ZZ9ZQH8FRTSK` (billing engine live against Stripe), `vfy_01KWQ4K297HY86C69DYGTEXFFC` (prod webhook new dispatch), `vfy_01KWQDQMPAQB4XG8MMGAP2YB1V` (trust pages live).

## What this audit deliberately does NOT claim

- The portal dashboard's rendered HTML behind Clerk auth was not fetched (requires a signed-in session); the wiring is proven at the seam (Machine serves the data; code on main consumes it; deploy green). A signed-in visual check remains worth one human minute.
- The retainer invoice mirror (webhook inserting a local `retainer` row) has run against synthetic and unit fixtures, not yet a real cycle invoice - no billing is attached to any seat yet by design. First real activation is the live proof.
- The offboarding sequence has tooling and doctrine but no staging dry run yet (named as the gate in ADR 0065 before the first paid contract).
- Heartbeat-red paging does not exist (#1709); ADR 0064's honesty banner says so.
