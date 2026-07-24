# Ashton & Price — Smokeball Scope Reconciliation (internal)

> Prepared to answer the Smokeball partner-review email (James Rozos, partner
> support, 2026-06-29) that asks us to justify-or-remove six declared read
> scopes. This doc reconciles **three** things that must agree before we reply:
>
> 1. **Full-delivery lifecycle** — the A&P case lifecycle we are actually
>    contracting to deliver (complaint → discovery → motions → minor's compromise
>    → trial/settlement), per `SCOPING.md` Phases 1-4, `RESEARCH-SYNTHESIS.md`,
>    and the lane doctrine in `REDUNDANCY-AUDIT.md`.
> 2. **Declared Smokeball scopes** — the 22 scopes on the `SMD Operator` app
>    (client_id `4v0vu6...`, staging, "Requires Approval").
> 3. **Deployed skills** — the deployed persona's skill set in `customer.yaml`.
>
> The reply to Smokeball is **not** "Phase 1 needs." Full delivery is the unit.
> A scope used anywhere across the contracted lifecycle is kept and justified; a
> scope with no lane anywhere is dropped. We do not want to drop a scope full
> delivery needs and re-request it later.

## The settled lane (governs every keep/drop)

From `REDUNDANCY-AUDIT.md`: the Operator is the **connective layer**. It
assembles inputs, routes outputs, chases the gaps, and explains its work for
paralegal training. It does **not** re-perform what an incumbent owns —
specifically **settlement math, disbursement math, lien-reduction math, and
work-product drafting are CUT** (Smokeball produces the settlement statement
and disbursement; the attorney computes lien reductions). Every outbound to a
non-firm party is `draft_for_review` (ENTITLEMENTS.md; ADR 0005 law floor).

A&P is a **California plaintiff-side personal-injury firm — contingency model.**
The firm does not run client AR (hourly invoicing); the firm is paid its
contingency fee out of settlement, and case costs are advanced and reimbursed
from the recovery. This single fact decides the two financial reads that have
no lane.

## Master reconciliation — every declared scope

Legend: **Verdict** KEEP / DROP. **Demo now** = can we produce live staging API
telemetry today (read tools exist and reads are not gated by the approval block,
unlike writes which currently 403).

| Scope                       | Verdict         | Lifecycle requirement it serves                                                                                                                                                                                                                                 | Connector tool → endpoint                                                                        | Demo now         |
| --------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------- |
| `matters/read`              | KEEP            | The hub. Every skill reads matter state.                                                                                                                                                                                                                        | `list_matters`,`get_matter` → `/matters`                                                         | yes              |
| `mattertypes/read`          | KEEP            | Stage-model join; matter-type drives form set + workflow.                                                                                                                                                                                                       | `list_matter_types` → `/mattertypes`                                                             | yes              |
| `stages/read`               | KEEP            | Stage-model join (where a matter is in the lifecycle).                                                                                                                                                                                                          | `get_stage_sets`,`get_stage_to_matter_mappings` → `/stagesets`,`/stages`                         | yes              |
| `contacts/read`             | KEEP            | Parties, opposing counsel, GAL, lienholders — addressing + form population.                                                                                                                                                                                     | `get_contacts`,`get_contact`,`get_contact_relations` → `/contacts`                               | yes              |
| `roles/read`                | KEEP            | Party roles on the matter (plaintiff/defendant/insurer) — form fields, M&C addressing.                                                                                                                                                                          | `get_roles_on_matter`,`get_relationships_on_matter` → `/matters/{id}/roles`                      | yes              |
| `staff/read`                | KEEP            | Responsible attorney resolution — `matter-memo-on-update` (named ask), notify/escalate.                                                                                                                                                                         | `search_staff`,`get_staff` → `/staff`                                                            | yes              |
| `documents/read`            | KEEP            | Read served discovery, medical records, opposing responses, lien letters.                                                                                                                                                                                       | `get_files_on_matter`,`get_file`,`get_download_url`,`list_folders` → `/matters/{id}/documents/*` | yes              |
| `documents/write`           | KEEP            | Stage inputs for BriefPoint/CoCounsel, separate-statement + M&C drafts, folder structure.                                                                                                                                                                       | `add_file`,`create_folder`,`delete_file` → `/matters/{id}/documents/*`                           | gated (write)    |
| `events/read`               | KEEP            | Read calendar/deadlines for the digest + conflict checks.                                                                                                                                                                                                       | `list_events` → `/events`                                                                        | yes              |
| `events/write`              | KEEP            | Calendar the computed discovery/responsive-pleading/GAL deadlines.                                                                                                                                                                                              | `create_event`,`update_event`,`create_event_reminder` → `/events`                                | gated (write)    |
| `tasks/read`                | KEEP            | Open tasks for the digest + propounded-discovery tracker.                                                                                                                                                                                                       | `list_tasks`,`get_task` → `/tasks`                                                               | yes              |
| `tasks/write`               | KEEP            | Write deadline tasks + chase follow-ups.                                                                                                                                                                                                                        | `create_task`,`update_task` → `/tasks`                                                           | gated (write)    |
| `memos/read`                | KEEP            | Read the internal matter log (idempotency for the memo skill, digest).                                                                                                                                                                                          | `get_memos_on_matter` → `/matters/{id}/memos`                                                    | yes              |
| `memos/write`               | KEEP            | `matter-memo-on-update` — Chris's named ask; internal supervision log; lien ledger notes.                                                                                                                                                                       | `create_memo` → `/matters/{id}/memos`                                                            | gated (write)    |
| `webhooks/read`             | KEEP            | Reconciler reads existing subscriptions before reconciling.                                                                                                                                                                                                     | `get_webhook_subscriptions`,`get_event_types` → `/webhooks`                                      | yes              |
| `webhooks/write`            | KEEP            | Reconciler creates the `matter.updated` (and richer) subscriptions.                                                                                                                                                                                             | `create_webhook_subscription` → `/webhooks`                                                      | gated (write)    |
| `layouts/read`              | **KEEP**        | **Matter field data** (date of loss, venue, carrier, policy limits, case no.). Foundation for **court-form population** (CM-010, SUM-100, POS-010, MC-350) and the facts every deadline computation reads. Obviously in-lane for a case-coordination assistant. | **none yet** — `get_matter_layouts` lands with the form-prep skill (Phase 2/3)                   | no (no tool)     |
| `expenses/read`             | **KEEP**        | **Advanced case costs** = the disbursement _inputs_ the Operator assembles for the settlement statement (REDUNDANCY-AUDIT.md:27 — "assembles the inputs: lien payoffs, **costs**"). Smokeball produces the statement; we feed it.                               | `get_expenses` → `/matters/{id}/expenses`                                                        | yes              |
| `bankaccounts/read`         | **KEEP (lean)** | Enumerate the trust account to read its matter balance (need the account id for matter-balances). Settlement-disbursement lane.                                                                                                                                 | `get_bank_accounts` → `/bankaccounts`                                                            | yes              |
| `bankaccountbalances/read`  | **KEEP (lean)** | Confirm settlement funds **landed in trust** before triggering disbursement-input assembly/chase. Read-only; fund movement is hard-banned.                                                                                                                      | `get_matter_balances` → `/bankaccounts/{id}/matter-balances`                                     | yes              |
| `fees/read`                 | **DROP**        | AR fee/time entries. Contingency firm = no hourly client AR. The contingency fee is a settlement-statement line **Smokeball produces natively (CUT)**. No connective lane.                                                                                      | `get_fees` → `/matters/{id}/fees`                                                                | (n/a — dropping) |
| `billingconfiguration/read` | **DROP**        | AR billing configuration (rate/method). Nothing to read against with no hourly billing; not an input to any lane we own.                                                                                                                                        | `get_matter_billing_config` → `/matters/{id}/billingconfiguration`                               | (n/a — dropping) |

## The two drops, in one line for the reviewer

> `fees/read` and `billingconfiguration/read` were carried from a generic
> law-firm template. Ashton & Price is a contingency personal-injury practice
> with no hourly accounts-receivable workflow, and settlement/fee math is
> produced natively by Smokeball, not by our app. We have no use for these two
> and are removing them.

## Wiring gaps named (so we never claim usage we don't have)

1. **`layouts/read` has no connector tool yet.** It is declared for the
   upcoming court-form-population work (Phase 2 complaint/CM-010, Phase 3
   MC-350). The `get_matter_layouts` read tool ships with that skill. We can
   either (a) justify it in writing now (it is plainly case-data, the least
   exotic of the flagged scopes) or (b) build the tool and demonstrate a live
   `GET /matters/{id}/layouts`. Recommend (a) with (b) on offer.
2. **The settlement-coordination skills are Phase 3/4, not yet built.** The
   `expenses` / `bankaccounts` / `bankaccountbalances` justification rests on
   those skills. The endpoints are read-demonstrable today, but the _skills_
   that consume them land later. Honest framing to Smokeball: declared for the
   contracted settlement lane, demonstrable as reads now.
3. **`customer.yaml` is pre-reconciliation.** The deployed persona spine still
   carries `trust-balance-nudge` (a top-up-your-retainer pattern that does not
   fit contingency) and the AR section of `matter-status-digest` (fees/billing).
   When we trim the two AR scopes, those skills must be updated in the same
   wave so the deployed config references no removed scope:
   - `trust-balance-nudge` → drop for A&P, or re-aim at the settlement-funds-
     landed confirmation (which is the real trust read in this model).
   - `matter-status-digest` → drop its AR (fees/expenses/billing) section for
     A&P; keep the matter/stage/task/event/trust reads.

## Reverse check — does full delivery need a Smokeball scope we did NOT declare?

No. Walking Phases 1-4, every Smokeball touch maps to a declared scope (kept
above). The remaining integration work is in **ancillary systems, not Smokeball
scopes**: M365/Graph (inbound-email discovery, calendar consolidation, Teams —
Track E), and InfoTrak/Greenfiling/YoCierge/Adobe/Dropbox (mostly observed via
the Smokeball hub per the architectural insight in SCOPING.md). One watch item:
**Smokeball E-Sign** (InfoTrak-powered client verification) — confirm whether it
surfaces via existing Smokeball document/event reads before requesting any
e-sign scope. Do not request it speculatively.

## Recommended posture for the Smokeball reply

- **Keep + justify (no removal):** `layouts/read`, `expenses/read`,
  `bankaccounts/read`, `bankaccountbalances/read`. Give the one-line
  case-lifecycle use for each (rows above). Offer live staging read demonstration
  for the three that have tools; note `layouts` tool ships with form-prep and
  offer to demonstrate then if they prefer.
- **Remove + re-save:** `fees/read`, `billingconfiguration/read`.
- This trims real over-scope (smaller footprint on the firm's data — the client-
  protection instinct) while preserving everything the contracted full delivery
  touches. Least privilege at the full-lifecycle grain.

## Billing model — resolved (verified, not assumed)

A&P runs **no hourly/AR billing — pure plaintiff-side PI contingency.** Basis:

- **Public practice areas are exclusively plaintiff PI** (motor-vehicle,
  premises liability, wrongful death, product liability, government negligence,
  per ashtonandprice.com). No transactional/advisory area exists that could bill
  hourly.
- **Their own site uses lien-basis medical language** — providers paid "at the
  conclusion of your case, from your settlement or jury award." The signature of
  contingency economics (client pays nothing out of pocket).
- **All A&P research frames fees as contingency** (net recovery after fees/costs,
  minor's compromise, lien resolution). No hourly/retainer thread anywhere.
- **Lane clincher (makes the billing model moot):** even if a stray hourly matter
  existed, no skill in the contracted A&P delivery reads `fees`/`billing` for a
  purpose we own — settlement-fee math is Smokeball-native (CUT) and AR-chasing is
  not in the PI lifecycle. The drop holds on the lane analysis regardless.

`fees/read` + `billingconfiguration/read` drop cleanly. No hold.
