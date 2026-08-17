# Post-incident notes

The record `docs/handbook/incident-response.md` step 5 has always mandated and nobody had written. Six qualifying incidents had occurred by 2026-08-17 with zero notes on disk; the loop from incident to permanent immune-system change lived in issue bodies and one agent's memory (issue [#2391](https://github.com/venturecrane/ss-console/issues/2391)).

## The contract

- **One note per incident**, filename `YYYY-MM-DD-short-slug.md`, dated by the day the incident began (not the day it was found and not the day it was filed; when those differ, the note says so).
- **Every fact cites its source** inline: an issue number, an audit section, a doctrine law, a file path, or a `vfy_` id. A fact with no source does not go in the note.
- **Where a source does not state something, the note says `not recorded`.** Detection-to-resolution time in particular is usually not recorded, because the timestamps that would establish it were never captured. Writing a plausible number instead is the fabrication class these notes exist to document.
- **Backfilled notes say they are backfilled**, and reconstruct nothing that the sources do not state.
- A note is not a status page. It closes nothing and it does not track a fix; the linked issue does that. What the note owns is the causal chain and the answer to "what changed so that this class cannot recur silently".

## Template

`_TEMPLATE.md`. Copy it, keep every heading, and delete no section; an empty section is filled with `not recorded` or `none`, which is information.

## How a note connects to the rest of the loop

An incident produces four things, and the note is the one that outlives the others:

1. A **paused seat and a demoted routine**, per the pre-committed demotion rule in `docs/runbooks/operator/enable-gate-checklist.md`.
2. A **root-cause change** with the evidence its own acceptance criteria demand.
3. A **shadow-firm scenario** replaying the incident, shown to fail against the unfixed state before it is trusted (`#2389`).
4. This **note**, which is what a successor reads when the same shape appears again.

## The notes

| Note                                            | Incident date            | What it is                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-07-02-retired-persona-name-removal.md`    | 2026-07-02 to 2026-07-26 | A retirement reported complete four times while runtime layers kept the artifact. Source: CLAUDE.md "Gone means gone".                                                     |
| `2026-07-28-entitlement-control.md`             | 2026-07-28               | Four honest PRs summing to less than the feature; the client could not perform the act. Source: Law 9.                                                                     |
| `2026-07-31-escalation-ledger-item-identity.md` | 2026-07-31               | The seven-day snooze promise fails because the item key hashes model-composed text. Sources: audit §3.11, [#2151](https://github.com/venturecrane/ss-console/issues/2151). |
| `2026-08-11-unaudited-send.md`                  | 2026-08-11               | A message left a client seat's inbox with no audit row. Source: [#2258](https://github.com/venturecrane/ss-console/issues/2258), including its own retraction.             |
| `2026-08-13-silent-filing.md`                   | 2026-08-13               | The demand letter was filed correctly and the reply that would have said so was held. Source: [#2367](https://github.com/venturecrane/ss-console/issues/2367).             |
| `2026-08-13-send-tool-dispatch-shape.md`        | 2026-08-13               | The Operator's only send tool raised on every call. Source: [#2348](https://github.com/venturecrane/ss-console/issues/2348).                                               |
