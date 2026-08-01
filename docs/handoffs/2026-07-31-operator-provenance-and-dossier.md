# Handoff — 2026-07-31

Two workstreams ran today. One is finished and shipped. One is three-quarters done and unpushed. Read the "Do not redo" section before starting anything.

---

## Where everything sits (resolved at /eos, 2026-07-31)

|                         |                                                                          |
| ----------------------- | ------------------------------------------------------------------------ |
| **engagements PR #13**  | **MERGED.** The source-of-truth work is on `main`.                       |
| **ss-console PR #2115** | Open, CI running. The three Operator commits + this handoff + the audit. |
| **overlay PR #208**     | Open, CI running. The identifier-filter fix.                             |

All three repos clean, nothing unpushed, nothing local-only.

**One thing to know:** the overlay commit was briefly made on `main` — a rule violation. It was moved to `fix/identifier-filter-matter-numbers` and `main` was reset to `origin/main` before any push, so nothing reached the remote's main. Recorded because it happened, not because it needs action.

**Before you build:** `origin/main` in ss-console was 13 commits ahead of this worktree at session end. Fetch and rebase; anything you were briefed on predates those.

---

## Workstream A — engagement source of truth. DONE, PUSHED, GREEN.

**Repo:** `~/dev/engagements`, branch `docs/ap-letters-15-16`, PR #13, CI green, clean tree.

**Why it happened.** The A&P dossier asserted "Deadline engine: Smokeball court-rules/InfoTrack" while letter 06 says the inverse: _"We do not currently run Smokeball's court-rules calendaring tied to InfoTrack."_ It survived ~3 weeks, propagated into `correspondence/README.md` and into a PDF sent to the client, and caused repeated wrong reasoning. Root cause: the dossier was a **summary composed from** the archive rather than **citations into** it, so drift was undetectable by construction.

**What now exists:**

|                                            |                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Fenced fact ledger in `dossier.md`         | Every load-bearing claim quotes its source and names the file; a test verifies the quote is really in that file |
| `tests/dossier-integrity.test.ts`          | 9 kill-tested checks, incl. polarity agreement — the only one that catches the original inversion               |
| `tests/letter-manifest.test.ts`            | All 19 letters pinned by SHA-256. Ground truth is immutable                                                     |
| `tests/document-status.test.ts`            | 24 docs declare SENT / RECORD / HISTORICAL; internal analysis non-governing by construction                     |
| `.claude/hooks/dossier-citation-check.mjs` | PostToolUse — runs the gate in-session on any dossier edit                                                      |
| `CONTRADICTION-SWEEP-2026-07-31.md`        | 7 open conflicts in the sent record, each with `file:line`                                                      |

**Verify in 10 seconds:** `cd ~/dev/engagements && npm test` → 35 pass. Then change any quote inside the `FACTS` fence in `dossier.md` and re-run; it fails naming the letter.

**What the gate does NOT do:** it proves the source contains those words. It does **not** prove the claim follows from them. Stated in the test file header. Three rows carry `· polarity-checked`, meaning a human compared them and the machine did not.

---

## Workstream B — Operator emits only what it read. 3 of 4 done, in PR #2115 + #208.

**The product defect, concretely.** On 2026-07-30 the Operator emailed the firm: _"matter 2026-PI-107 — RFP and SROG confirm tasks."_ Those tasks belong to **2026-PI-106** (Bell v. R&J Construction). 2026-PI-107 is a different case with a different client. A lawyer reading that goes to the wrong file.

**Full audit:** `docs/audits/operator-output-provenance-2026-07-31.md` (committed in this worktree). Headline: **0 of 204 catalogued output fields are projected from a record; 204 are composed by the model.** No renderer exists anywhere.

### Done (ss-console PR #2115)

- **`0a933688`** — the Operator no longer computes discovery deadlines. `discovery-response-tracker` Branch 2 now reports the inputs and the gap instead of producing a date. **Two fixtures that taught the defect were inverted with it** — one required the model to assert "2026-08-15 is a Saturday", and in production it made exactly that kind of assertion and got it wrong.
- **`614e88ac`** — the matter number comes from the record. Connector attaches `matterNumber`/`matterCaption` to tasks and events; 37 skills cite the field instead of composing. **These two halves must ship together**: skills reach a seat via git→R2→volume, the connector only via image rebuild (`Dockerfile:623`). Wrong order prints "matter number unavailable" on every line.
- **`61eaf39b`** — a write may not name a matter other than the one it lands on. `create_memo` / `create_task` / `create_event` refuse it. Also stamps `[Operator]` into content, because Smokeball records every write under the OAuth-consenting human and content is the only channel that reaches a human reading the matter.

### Done (overlay PR #208)

- The identifier gate could not see a matter number **at all**. `2026-PI-107` → no hit. Every `IDENTIFIER_UNVERIFIED` row showed only date shapes, reading as "no problems" when it meant "blind to this firm's identifiers." Now visible. **Still report-only** per the documented tune-on-traffic discipline in `plugins/hermes-smd-trust/outbound.py` — do not flip that without measuring false positives.

### BLOCKED — step 4, block outbound on a matter mismatch

**Evidence:** 23 send-related audit rows since 2026-07-14 carry **zero** `matter_id`. The outbound path has no matter identity, so "wrong matter number" is undeterminable there — only "a number is present", and blocking on presence would block every correct records-chase letter.

**What would unblock it:** matter identity on the send path. That means changing AgentMail / msgraph tool signatures, which are vendor MCPs. Needs a design decision, not more effort.

### Not started — 11 remaining audit items

Highest value first: implement `extractive_only` (declared in the output-class registry, implemented nowhere); make the registry live at runtime rather than CI-only; gate `session_output` (26 of 102 artifacts, every digest, no content gate at all); Sentry scrub (a matter GUID is already in the shared project).

---

## Do not redo — verified dead ends and settled facts

- **`skill_name` cannot be populated from the audit hook.** `post_tool_call` receives `tool_name, args, result, task_id, session_id, tool_call_id, duration_ms, turn_id, api_request_id, status, error_type`. No skill identifier. Upstream limitation.
- **`pre_tool_call` can only BLOCK.** It cannot modify args — "other return shapes are ignored." Do not try to stamp or rewrite content from a hook.
- **Our audit log already records `actor="agent"`.** The "created by Scott Durgan" problem is Smokeball's `createdBy`, fixed by the OAuth grant (`authorization_code`, ADR 0054). Different things; do not conflate them.
- **The engine-reading branch is unreachable on any tenant.** Skills gate on `source_tag: "court-rules-engine"`, taught by fixtures. That field does not exist in the Smokeball API — 0 occurrences in a full tenant dump. **Check other skills for the same authored-not-captured fixture failure.**
- **The firm runs no court-rules engine** (letter 06) and **permitted** Operator computation as a gap-filler, conditioned on attorney confirmation logged with name and timestamp. That condition exists in no code and no contract clause.
- **`prove-out/` is 263 of 326 engagement files, frozen 2026-07-28.** Out of scope.

## Live conflict the Captain has not resolved

`agreements/service-agreement.md:93` §2.3(b) — **sent to the client as a letter-11 PDF on 2026-07-27** — says the Operator _"does not calculate deadlines"_ and that it reads dates from _"the Firm's systems (which compute court-rules deadlines)"_. The firm has no such engine, and four later sent documents say it proposes dates where none runs. Read literally the contract leaves its own Schedule A-1 routine #2 with no lawful source for any date. **Do not edit the agreement** — it is in the client's hands and amending it is a Captain decision.

## How today went wrong, so you avoid it

- **Four of my findings were wrong** and had to be corrected: a fact I called fabricated was real, a quote I called manufactured was two-thirds legitimate, a document I bannered SENT was not sent, and the fence's own conflict note named the wrong conflict. Every one came from **inferring instead of reading the record**.
- **Twice I "verified" a check against clean input**, which proves only that it exits 0. One of those hid a real bug — a `continue` that silently skipped self-citations, letting every claim verify itself.
- **Kill-test committed work, not uncommitted work.** `git checkout` restores to HEAD and destroyed my changes twice.
- **The Captain does not want implementation menus.** Decide mechanism yourself; bring him objective, product behaviour, commitments, and spend. He said this three times today before it landed.
