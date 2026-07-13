# Law-firm compliance floor — what the Operator never does, and where that is held

**Purpose.** A single readable index of the five safety floors the law-firm pack declares, each traced to the rule it encodes, the [`wedge.md`](./wedge.md) invariant it backs, and **the exact point where it is enforced** — runtime, or author/fixture time. This is the artifact a firm's principal or outside ethics counsel can read to see what is mechanically guaranteed versus what is held by skill design and graded testing. It does not overclaim: where a floor is enforced by review and fixtures rather than by a runtime gate, it says so plainly.

The floor slugs are authored in [`vertical.yaml`](./vertical.yaml) (`compliance:`); the invariants are in `wedge.md` §"Safety invariants the wedge holds". This document is the map between them and the code. Runtime enforcement lives in the overlay (`hermes-smd-overlay`): the trust plugin (`hermes-smd-trust/enforce.py`), the outbound gate (`shared/outbound_gate.py`), and the banned-tool registry (`shared/action_classes.py`).

**Enforcement legend.** **Runtime** = a code gate on the live Machine refuses or downgrades the action regardless of what the model attempts. **Author/fixture** = held by the skill's authored contract (`SKILL.md` invariants) and proven by blind-graded adversarial fixtures, not by a runtime gate. Several floors are _both_: a runtime slice plus author/fixture coverage for the part a gate cannot see.

---

## The five floors

| Floor (slug)                | The rule, plainly                                                                                                                                                                                      | Backing `wedge.md` invariant | Enforcement point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`trust-funds-read-only`** | Report trust-account balances; never move money. Zero fund-movement calls, independent of what the connector _could_ do.                                                                               | #3 Trust funds read-only     | **Runtime.** `payments_*` tools (`initiate_transfer`, `send_payment`, `refund`, `authorize_charge`, `void_authorization`) are in `BANNED_TOOLS` (`shared/action_classes.py`) — refused before policy even runs. LawPay is wired read-only.                                                                                                                                                                                                                                                                               |
| **`upl-boundary`**          | Connective work only. Never legal advice, a recommended course, a computed legal deadline, or any legal substance.                                                                                     | #1 UPL / no legal advice     | **Both.** Runtime slices: the outbound gate's Tier-2 citation scan (`shared/outbound_gate.py`) refuses citation-shaped strings (a law message never cites), and the **date computation-guard** (planned, ships with the deadline skill — see below) flags a firm-internal note carrying a date with no traceable source. The broader advice-substance line ("you have a case," a recommended strategy) is **author/fixture-enforced** — `SKILL.md` invariants + adversarial advice-bait fixtures graded `fails`.         |
| **`conflict-routing`**      | On any possible conflict, capture and route to a human; never auto-clear.                                                                                                                              | #2 Conflict detect-and-halt  | **Author/fixture** (today). `new-matter-intake` carries a detect-and-halt invariant: a cross-check hit halts the consult/engagement chain and surfaces "human clearance required." Clearance is definitionally human. Proven by conflict-hit fixtures graded `fails` on any auto-advance. A runtime conflict-state precondition is a scoped follow-on (it needs a matter-state signal the plugin can read); until then this floor is held by skill design + grading, **stated honestly, not claimed as a runtime gate.** |
| **`privilege`**             | Privileged content stays inside firm surfaces; no matter detail to a referrer or third party without consent.                                                                                          | #5 Privilege                 | **Both (partial).** Runtime: outside sends follow the firm's authored `external_send` ceiling (fail-closed refused when unauthored, ADR 0035), and the content-sensitivity floor (ADR 0031) downgrades legal-weight content to draft even under an authored autonomous ceiling. A dedicated recipient-class gate (refuse privileged content addressed to a non-firm/non-client party) is **not yet a runtime check** — that slice is author/fixture-enforced today.                                                      |
| **`aba-512-supervision`**   | The firm supervises the nonlawyer assistant (ABA Model Rule 5.3 / Formal Opinion 512): every action is reviewable, attributable, and the assistant never acts beyond its authorized, supervised scope. | (whole posture)              | **Architectural.** Realized by three mechanisms together: fail-closed entitlement (an unauthored action does not execute, ADR 0035), the firm's authored per-action-class send posture enforced in code, and the **append-only, tamper-evident action journal** (`audit-log-immutability.md`) as the supervision record. 512 is not a single gate — it is the combination, and the journal is what makes the supervision auditable after the fact.                                                                       |

## Removed floor — external-send-draft-floor (2026-07)

The pack previously declared a sixth floor: `external_send` pinned to
`draft_for_review`, non-raisable — every client-/tribunal-bound message could
only ever leave as a draft under a human's send, no matter what the firm
authored. It was removed by Captain decision in 2026-07 ([ADR 0073](../../../docs/adr/0073-remove-law-external-send-floor.md)):
outside-send is the firm's authored dial (ADR 0035), and the Rule 5.3 / Formal
Opinion 512 supervision obligation is discharged by the journal, attribution,
and fail-closed entitlement — the row above — not by a send gate the firm
cannot turn off. A firm that wants every outside message human-sent authors
`external_send: draft_for_review`; that remains the recommended starting
posture for a new engagement. What did NOT change: the trust-account write
bans, the fabricated-citation gate, the content-sensitivity floor (ADR 0031),
and the ban on the Operator sending from a human's own mailbox identity.

---

## The deadline boundary (UPL, made concrete)

The Operator **works to** firm-authored deadlines like a competent assistant — it tracks a date a human entered (a Clio calendar entry, a task due-date, an intake field), chases against it, and escalates to a named attorney as it nears. It **never originates the legal computation**: it does not derive a statute of limitations, a statutory filing date, or any deadline from first principles. Setting the legal date is the attorney's judgment and the UPL line; tracking the calendar is the assistant's job.

This boundary is held three ways:

1. **By construction** in `deadline-and-sol-tracker` (`SKILL.md`): the skill's only date arithmetic is `authored_date vs. today` for proximity bucketing — there is no `incident_date + limitation_period` path anywhere in it.
2. **By adversarial fixture:** a computation-bait case (a context that tempts "three years from the incident") is graded `fails` if any self-computed date is surfaced.
3. **By a planned runtime backstop** (the `date_provenance` computation-guard, shipping with the deadline skill, observe-first): a firm-internal note that carries a date token with no traceable `source_ref` is the runtime signature of a computed date, and is flagged. This guard lands _with_ the skill that stamps `source_ref` on observed dates, not before it — shipping a date gate before the date-stamping contract exists would only flag legitimate notes.

## Deadline-watch is advisory, never the system of record

The deadline-tracking and escalation capability is **advisory and supplemental**. It does not replace the firm's own calendar, docketing, or deadline-management system, and the firm must not rely on it as the system of record. Operationally this matters because the escalator is cron-triggered: it emits a heartbeat every tick so a silently-stopped watcher is detectable (a missing heartbeat raises an alert), but a firm that treats an automated watcher as its only deadline guard is taking a risk no vendor should let it take silently. A gap in the watch is a **disclosed, detectable degraded state — never a silent false assurance.**

---

_Authored 2026-06-08 as the readable index over `vertical.yaml` compliance slugs + `wedge.md` invariants; external-send-draft-floor removed 2026-07 (ADR 0073). Update the enforcement column as runtime gates land (conflict-routing precondition, recipient-class privilege check, the date computation-guard flip from observe to enforce)._
