# Law Pitch Readiness — Operator

**Purpose.** One view of the gap between the law talk-track and the product, so we can watch second-meeting → pilot close. Built from three rounds of attorney pitch simulation (2026-06-08). Round 3 assumed every Round-1/2 product ask was in the room and converted **5 of 6** stalls to conditional pilot. This doc maps each buyer-converting artifact to its real product status — what's built, what's tracked, and what's genuinely net-new — and records the two scope decisions that came out of the run.

This is a tracking artifact, not doctrine. Doctrine lives in the ADRs cited below. When an item ships, update its status here; when the whole column reads BUILT/DEMOABLE, the why-us is no longer a claim.

---

## What actually converted (Round 3), in conversion-priority order

The original handoff ranked items by "how many buyers it blocked." Round 3 tells us what actually _flipped_ people. It is not the same order. Lead the proof sequence in this order for sophisticated/procurement buyers.

| Lever                                                                                                       | Who it flipped                                                   | Status                                                                                                          | Anchor                                                                                              | Gap to "demonstrable in the room"                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Rule 5.3 action journal** — append-only, tamper-evident, exportable                                    | Anthony, Diane, Karen ("the journal is the thing that moved me") | **NEAR** — immutability shipped (#892 closed: Worker-layer + Logpush mirror). Packet signing in flight (#1171). | `audit-log-immutability.md`, `compliance-evidence-packet.md`, `audit-retention.md` (7-yr), ADR 0030 | On-screen demo surface: watch it resist an edit, export it, verify the signature. Likely rides #1219 portal deep-dive. **Capability is built; the demo is the gap.** |
| **2. Provider zero-retention/no-train term + sample DPA in hand**                                           | Anthony, Diane, Karen                                            | **TEMPLATE built**                                                                                              | `data-processing-addendum.md`, `baa-equivalent-confidentiality.md`, ADR 0007/0009 isolation         | A one-page security sheet that names the provider + its written no-train term + hosting region + SOC 2 _status_, handed across the table. Assembly, not build.       |
| **3. Correction-holding across _conflicting_ corrections** (messy multi-attorney data)                      | Universal — killed the "canned demo" suspicion                   | **IN-FLIGHT** — voice infra built; #855 open (Voice Layer 2); #800 closed (D1 schema)                           | ADR 0028, `operator/voice-gate/`, `operator/adapter/voice/transform.py`, ADR 0016 (memory)          | A demo harness running conflicting corrections from different attorneys on realistic mess. This is the provable-trio demo _and_ the voice-hard-register demo in one. |
| **4. Leading with the procurement packet** (structural tell: "he can survive my carrier and ethics review") | Karen, Anthony, Diane                                            | **ASSEMBLY** of levers 1+2 + pricing                                                                            | below                                                                                               | Package and lead with it, rather than making the buyer extract it.                                                                                                   |

---

## Full backlog map

Status legend: **BUILT** · **NEAR** (built, demo/wiring left) · **IN-FLIGHT** (issue open) · **SPEC** (designed, unbuilt) · **DECIDED** (doctrine, no build) · **NET-NEW** · **BACKLOG** (deliberately deferred).

### Track A — Demonstrable trust core (engineering; the conversion levers)

| Item                                                                       | Buyer                     | Status                                  | Anchor                                                  | Net-new work                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------- | --------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action-journal on-screen demo                                              | Anthony, Diane, Karen     | NEAR                                    | #892 (closed), #1171, #1219                             | Demo surface: resist-edit + export + verify-signature                                                                                                                                                    |
| Conflicting-corrections demo harness (voice hard register + provable-trio) | Rebecca, Karen, universal | IN-FLIGHT                               | #855, ADR 0028, ADR 0016, 0007/0009                     | Messy-data harness: conflicting corrections from different attorneys; correction holds across matters and into month two                                                                                 |
| Legal data-accuracy module                                                 | Priya                     | DECIDED + provenance gate BUILT-UNWIRED | ADR 0028, ADR 0031, ADR 0035                            | Wire the provenance gate on live output; **identifier-integrity gate** (never send an unverified name/date/A-number/case-number — language-agnostic); never-does contract one-pager                      |
| Deadline tracking, rescoped                                                | Priya                     | SKILL BODY EXISTS (deferred)            | `operator/skills/deadline-and-sol-tracker/`, `wedge.md` | Pull into pilot scope: works to firm-authored dates, **never computes the legal deadline**; add unactioned-flag escalation ladder (re-surface → re-route → escalate to named attorney as the date nears) |

### Track B — Procurement packet (assembly + business + one engineering round-trip)

| Item                            | Buyer                  | Status                             | Anchor                                                   | Net-new work                                                                                                                                                                                           |
| ------------------------------- | ---------------------- | ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Security one-pager              | Anthony, Diane, Karen  | TEMPLATE                           | `data-processing-addendum.md`, #1100                     | Assemble: provider + no-train term + hosting + SOC 2 status. Pre-empt "SOC 2 status ≠ Type II report" out loud (diligence gate the demo can't satisfy).                                                |
| Clio integration spec           | Karen                  | SPEC pinned + ambiguity documented | `clio-surface.md`, `wedge.md`, ADR 0020, ADR 0038 step 5 | Sandbox round-trip to resolve v1 write scope → honest reads/writes/scopes/failure-behavior spec                                                                                                        |
| Pilot pricing + economics frame | Marcus, Karen, Rebecca | NET-NEW (business)                 | ADR 0004 (deferred), #917                                | Scoped pilot price band + onboarding/time-cost. **Frame by buyer:** salary/replacement math for firms with a seat to replace; marginal-stack-cost + the buyer's one die-on metric for no-seat solos/PI |

### Track C — Guardrails as shown/exported artifacts

| Item                           | Buyer                   | Status                                      | Anchor                                                         | Net-new work                                                                                                               |
| ------------------------------ | ----------------------- | ------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Portability / exit             | Anthony                 | SPEC + DPA §8                               | `memory-export.md`, `decommission-customer.md`, #805, ADR 0008 | Finalize non-proprietary, human-readable export **format** another vendor could use; data-egress clause in the agreement   |
| Client-visibility dial         | Diane, Rebecca          | DECIDED persona-level (fail-closed default) | ADR 0005/0035, `send_as`, #1194, #1146, #1219                  | Per-engagement granularity + show it as a real config in the portal                                                        |
| Privileged-access support flow | Diane, Anthony, Rebecca | DECIDED doctrine (flagged not-shipped)      | ADR 0040 pillar 2, ADR 0030, #1219                             | Design request → firm-authorize → time-limit → audit mechanism; reflect in the agreement a carrier can rely on             |
| Wrong-learned-rule governance  | Anthony                 | NET-NEW                                     | ADR 0016 (Captain dismissal removes Honcho state)              | A rule one attorney taught that's wrong must be auditable and reversibly flagged, not silently compounding                 |
| Periodic voice-audit artifact  | Rebecca                 | NET-NEW                                     | voice infra, #855                                              | Monthly hard-register sample so the attorney catches voice drift, not a client                                             |
| Net-time-saved instrumentation | Anthony, Priya          | NET-NEW                                     | `cost-attribution-rollup.md`, `cost-telemetry-events.md`       | Per-pilot net-time-saved measurement — or the value claim stays unproven where flagging just relocates work to a paralegal |

### Track D — Continuity / SLA (business + infra)

| Item                      | Buyer          | Status  | Anchor                                     | Net-new work                                                                                                                                                                                                           |
| ------------------------- | -------------- | ------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continuity / SLA / escrow | Anthony, Karen | NET-NEW | ADR 0004 (deferred), `service-contract.md` | Team-depth answer; SLA with availability under deadline pressure; escrow instrument **plus warm-standby/recovery-time commitment** (escrow returns data but doesn't keep a worker running at 9pm if a thin team folds) |

---

## Decisions locked (2026-06-08)

1. **Full multilingual operation → backlog.** Important, not build-now. The narrow Round-3 ask — a **name/transliteration accuracy gate before any client-facing send** — is _not_ multilingual operation; it's identifier integrity (the same failure class as a wrong date) and rides the Track-A data-accuracy module, language-agnostic. Priya's actual P0 is covered without building multilingual.
2. **Deadline handling — works to, never computes.** The Operator tracks firm-authored deadlines, chases against them, and escalates to a named attorney as they near — like any employee who manages a calendar. It never originates the legal computation (no deriving a statute of limitations or statutory filing date from first principles); that is the attorney's legal judgment and the UPL line. The deferred `deadline-and-sol-tracker` skill comes into the law-pilot scope under this boundary. Reconciles Priya's converting line ("never calculates the deadline itself") with the employee-grade expectation that it works to deadlines.

---

## Backlog (deliberately deferred)

- **Full multilingual operation** — inbound understanding + client-chase in Spanish/Hindi/Mandarin in firm voice. Revisit post-first-pilot. (Identifier-integrity gate is _not_ deferred — see Decision 1.)
- **Speed-to-lead / PI wedge** — sub-minute inbound capture + instant callback + time-to-first-contact dashboard. The PI metric Marcus would buy on, but the PI add-on (`law-firm/pi`) is already out of the current wedge per `wedge.md`. Pairs with the no-seat economics reframe. Revisit if PI becomes a target vertical.

---

## The pilot → production ceiling (not a product problem)

Named by all six buyers: **reference-zero.** It did not block second-meeting → pilot — the capped, non-production-first, escrow-backed pilot is the instrument that absorbs it. It now caps pilot → production. The move (Karen's reframe): turn reference-zero into **founding-firm advantage** — concrete early-design-partner terms (pricing, roadmap influence, co-built case study), led with honestly up front ("project-manage my fear," per Diane).

Two honest caveats, recorded so this isn't a victory lap: every pilot is **conditional and unsigned**, contingent on each buyer's carrier/ethics counsel independently clearing the paper and on each buyer rebuilding the replacement math themselves. And the **executable-paper round** — a real SOC 2 Type II report vs. "status," a DPA counsel can mark up vs. a sample — is a diligence gate the demo cannot satisfy. Proof converts to scoped pilot _intent_, not revenue.
