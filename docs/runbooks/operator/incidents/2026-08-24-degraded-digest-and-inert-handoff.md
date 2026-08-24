# Post-incident note: the deadline digest arrived with every matter unnamed, and the fix that should have prevented it had been running dead for two days

| Field                   | Value                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Incident date           | 2026-08-24 (defect present since the ss#2547 fix deployed, 2026-08-22)                                                                                             |
| Seat / surface          | `pilot-smokeball`, the deadline-miss-escalator digest to scott@smd.services                                                                                        |
| Severity                | SEV3, assigned in this note (pilot seat, internal recipient, no client exposure; the class it revealed is SEV2-shaped on a client seat)                            |
| Detected by             | The Captain, reading the mailbox. The ss#2547 pager fired correctly on the 3 refusals, but no instrument judged the 4th send, the degraded artifact, as a failure. |
| Detection lag           | ~3 hours (send 14:04Z, Captain surfaced it in session ~17:00Z)                                                                                                     |
| Detection to resolution | Repo layer same day (overlay #318, console #2571/#2572); runtime resolution pending reprovision (see Open)                                                         |
| Client impact           | None observed, the pilot's recipient is the Captain. On a client seat the same chain delivers an unusable deadline digest to a firm principal.                     |
| Status                  | Open until the runtime proof lands; owned by ss#2390 (projection) and the OVERLAY_REF bump PR                                                                      |

**Sources.** vfy_01M0THACG928CA9ANNVECFBW95 (both defects probed live), vfy_01M0T4WS3CFP19Q38N57012PFE (refusal rows), ss#2547, ss#2390, ss#2405, overlay PRs #299-era ss#2547 train and #318, console #2548, #2571, #2572; `shared/pre_run_handoff.py`, `plugins/hermes-smd-trust/outbound.py:584`, `operator/skills/deadline-miss-escalator/pre_run.py`.

## What broke

Three independent defects, stacked:

1. **The ss#2547 handoff never bound in production, path half.** The scheduler runs `pre_run.py` with `HERMES_HOME` set to the persona home (`/opt/data/profiles/operator`), so the writer landed its file at `/opt/data/profiles/operator/.smd/pre_run/deadline-miss-escalator.json`. The reader (agent process, `HERMES_HOME=/opt/data`) searched `/opt/data/.smd/pre_run/`, a directory that has never existed on the seat. Every morning's handoff was written perfectly and read by nothing.
2. **Clock half (latent behind 1).** The cron session id stamps the fire time in the routine's cron timezone (Phoenix: `…_070026` for a 14:00Z fire) while the container's local clock is UTC (TZ unset). `_in_window` tried the naive stamp "as UTC" and "as seat-local", in a UTC container those are the same instant, 7 hours outside the 20-minute window. The docstring's premise ("the two readings differ by exactly the seat's UTC offset") assumed the container clock was the seat's civil clock; the scheduler's cron timezone is a third clock the module never saw.
3. **The refusal text offered the degraded path.** With the register empty, the tier3 gate refused the send three times, correctly, and its own message offered "or remove the unverified value and state that it needs confirmation." The model complied, fifteen items at a time, and the fourth send passed the gate with every line reading "matter number unavailable." Separately, matter numbers were never fetched anywhere in the chain (the pull carries GUIDs; the connector's join ran only on the MCP surface), so the "unavailable" text was the projection's permanent output, not a transient failure.

The class, named: **merged green, inert in production** (gate-regression). Both handoff tests passed because writer and reader shared `tmp_path` and a fabricated session stamp; no test ran the two halves under the runtime's actual environment split. Same family as the parser-tests-must-use-the-runtime-prompt-shape lesson.

## How it was detected

A human. The Captain read the digest in the mailbox and said it was unacceptable. The ss#2547 pager did fire on the three refusals (instrument working as designed), but its scope is refusals, nothing measured the artifact that passed. The inertness of the handoff fix had been invisible for two days because its failure mode is the status quo ante (refusals continue), which is exactly the "inert control with no signal" its own docstring warned about.

## Timeline as recorded

| Time (UTC)           | Event                                                                                     | Source                            |
| -------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| 2026-08-22           | ss#2547 handoff seeding merged both repos (console #2548, overlay #309-era train)         | git log both repos                |
| 2026-08-23           | OVERLAY_REF 0f84a625 pinned; pilot reprovisioned (seat runs the pinned ref)               | vfy_01M0THACG928CA9ANNVECFBW95    |
| 2026-08-24 14:00:24Z | pre_run writes the handoff (18 dates, 7 matter GUIDs) to the persona home                 | file `started_at`, seat probe     |
| 14:03:05–14:03:51Z   | Three tier3 refusals, `register_was_empty=true`, 10 past dates                            | audit_export; ss#2547 pager email |
| 14:04Z               | Fourth send passes: digest with all items "matter number unavailable" delivered to scott@ | mailbox                           |
| ~17:00Z              | Captain surfaces the artifact; session probes both defects live                           | this session                      |

## What changed to prevent recurrence

- **Landed (repo layer):** overlay #318, reader resolves the persona home from the routine name; binding is file recency on the reader's own clock (naive stamps rejected); handoff widened to validated `(matterNumber, dates)` records seeded as associations; empty-register refusal offers read-or-report-failure, never value-removal; heartbeat gains the `degraded` send-refusal kind. Console #2571, matter numbers projected in code end to end (connector join, typed absence). Console #2572, a digest with zero resolved numbers is withheld and paged; audit-failure on the degraded path wakes stripped instead of re-shipping the artifact; partial failure ships and pages.
- **Open (runtime layer):** OVERLAY_REF bump + pilot reprovision + one observed run with real numbers (crane_verify), and the staging budget-0 rehearsal proving the withhold-and-page path. Until those land, everything above is a repo claim (Law 9).
- **Open (class):** ss#2573, the other three pre-run handoffs are dates-only and the law-seat boilerplate predates the wake-payload source.

## Shadow-firm scenario

Not yet written. The candidate: a scheduler-shaped environment split (writer under the persona home, reader under the data root, cron stamps in a non-UTC zone) that the 2026-08-22 tests would have failed against.

## Ladder consequence

None, the escalator stays at its current rung. The digest recipient is the Captain (pilot), the refusal gate held three times, and the shipped fix makes the degraded output impossible rather than demoting the routine that produced it.

## Not recorded

Why the escalator's digest routes to scott@smd.services while client-verification-tracker routes to smdurgan@smdurgan.com, nothing in `customer.yaml` obviously selects between them; unprobed. Whether the 08-22 and 08-23 escalator runs also refused (only 08-24 was pulled in detail).
