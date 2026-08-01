# Operator Output Provenance Audit — 2026-07-31

**Status:** findings complete; remediation not started.
**Trigger:** Captain review of pilot-smokeball Operator mail output, 2026-07-31.
**Method:** six parallel read-only agents; every claim carries a command and its literal output. No system was modified.
**Verify rows:** `vfy_01KYWHC60YNMNJDMVX8YFJ6W1Q` (superseded), `vfy_01KYWQ1VJZKBK8GCMMFK7MBBYA` (correction), `vfy_01KYWPW5YHX99VHQ9SN9EKT0CY` (tenant oracle), `vfy_01KYWQ617RG6YZBYJFR2JJFYBG` (no engine dates), `vfy_01KYWQHVER08Y55BA815Q0YE33` (authorship census).

---

## 1. The finding, in one paragraph

A Smokeball task exposes `matter: {href, id, rel}` — a GUID, no matter number. The number lives on the matter record. Rendering "2026-PI-101" beside a task therefore requires a `task.matter.id → matter.number` join. **Nothing performs that join in code.** The model performs it in context on every run, and re-derives it differently on different days. This is not a defect in the join; there is no join. It generalises: **0 of 204 catalogued output fields are projected from a record; 204 are composed by the model.** No renderer exists anywhere in the system.

## 2. The thesis

> **A control that is passing by disposition is not a control.**

Every matter-to-artifact binding checked against the live tenant came out **correct** (four checks: Bell/R&J → `2026-PI-106`; `2026-PI-107` clean; both 2026-07-28 records-chase letters). Nothing in the architecture made them come out right, and no mechanism could have made them come out wrong or right on purpose. The system has been guessing, and mostly guessing well.

## 3. What is proven

### 3.1 No projection layer exists

| Claim                                          | Evidence                                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 of 204 fields projected                      | 6 output classes, 51 skills, 102 declared artifacts; all 51 skills are markdown prose                                                                     |
| No renderer                                    | 14 skills carry `pre_run.py`; every one prints only `{"wakeAgent": bool}`                                                                                 |
| The one renderer is pure by design             | overlay `shared/report_render.py` declares purity as invariant #1; run confirms text-out == text-in                                                       |
| `extractive_only` unimplemented                | the only gate the registry declares for the `record` class (50 of 102 artifacts); `grep -rl extractive_only` returns one file — the registry declaring it |
| Registry inert at runtime                      | sole reader is `operator/bin/tests/test_output_class_conformance.py`, a CI test                                                                           |
| `session_output` ungated                       | 26 of 102 artifacts (every digest and scan) pass no content gate; the trust plugin has no `post_llm_call`                                                 |
| pilot-smokeball has no `output_classes:` block | the ADR 0083 spec gate is silent on the seat that produced the fabrications                                                                               |

**204 is a floor, not a total.** 14 skills describe their fields in SKILL.md prose rather than a template and are unclassified.

### 3.2 The identifier gate is doubly dead

- **Report-only by construction** — `plugins/hermes-smd-trust/outbound.py:342-345`: "emits an `IDENTIFIER_UNVERIFIED` audit signal and ALLOWS the draft. It never blocks." All 49 live rows show `"mode":"report"`.
- **Blind to this format even if it blocked** — `_CASE_RE` matches federal docket style only (`1:24-cv-01234`, `No. 24-12345`). `2026-PI-107` → `False`. `PI-2026-0001` → `False`. Money excluded by design.
- **Reports to nobody** — the per-customer audit ledger is Machine-local SQLite (`shared/d1_client.py` imports `sqlite3`; `d1_env.py` resolves `CUSTOMER_DB` as a file path), **not** D1. `ss-console-db` has no `audit_log` table. A report-only control whose signal no console surface reads is a control with no reader.

### 3.3 The entitlement dial cannot express this control

`classify_recipient(recipient, roster, *, from_tainted)` — three parameters, none of them a matter. The classifier resolving `RecipientClass` → output class → entitlement ceiling is **structurally incapable** of knowing which matter the body claims. Dial and identity are computed from disjoint inputs.

Compounding: `internal_write: draft_for_review` **does not gate**. `enforce.py:377-388` returns `allowed=True` and merely relabels the audit row. Only an _unauthored_ value refuses. All four seats permit unattended internal writes; three of them say `draft_for_review` and behave identically to the one that says `autonomous`.

Consequence: **lowering entitlement dials is not a mitigation for this defect class.**

### 3.4 The laundering loop is real

Memo `4d2e6632` (2026-07-14, `2026-OPS-001`), closing line:

> "No date was computed by this escalator. All dates are authored task due dates read from Smokeball."

Thirty lines above, in its own body:

> "PROPOSED DEADLINE (confirm before relying): Response to RFP Set One proposed July 25, 2026."

Those tasks (`9b55b1db`, `a2208b10`, `dcf7d063`) were created 2026-07-06 by `discovery-response-tracker` — the Operator. It computed the dates, wrote them into Smokeball as task due dates, and eight days later a second Operator skill read them back under the framing "authored … read from Smokeball."

**Qualification, stated not buried:** the escalator did **not** strip the proposal labels; individual rows still read "confirm before relying." The laundering is in the _framing sentence_. "Authored" reads as _authored by the firm_ and means _present in a field_. A mislabeled provenance claim, not a stripped one.

**Scale:** 32 of 37 tenant tasks are Operator-written; **32 of the 33 non-seed tasks assert a date**; 25 were created on 2026-07-06 alone. Of 154 memos, 150 are the seat's (the seed script creates zero).

### 3.5 The arithmetic is wrong, in the tenant

Two contradictory non-deleted events for one deadline:

| event      | date       | its own description                                          |
| ---------- | ---------- | ------------------------------------------------------------ |
| `198a79ab` | 2026-07-25 | "= July 25. **July 25 is a Friday**; no weekend roll needed" |
| `d3e70cad` | 2026-07-27 | "= July 25; **July 25 is Saturday**, roll to Monday July 27" |

**July 25, 2026 is a Saturday.** The first states a false calendar fact and skips the CCP §12a roll on that basis. On `2026-PI-106`, two events propose **Sunday July 26** with no roll. Both cases are duplicate pairs — each run recomputes rather than reading back what it calendared.

### 3.6 The engine-reading branch is unreachable

The tenant carries **no** court-rules-computed dates. 11 of 16 events are Operator-authored and self-labeled PROPOSED. `additionalData` is `{}` on all 16; `categories` is `[]` on all 37 tasks; `source_tag` / `sourceTag` occur **0 times** in a full tenant dump.

The skill gates its engine lane on `source_tag: "court-rules-engine"` — a field taught by fixtures at `operator/fixtures/law-firm/deadline-and-sol-tracker/` that **does not exist in the Smokeball API**. `list_tasks` (`operator/connectors/smokeball/server.py:341-349`) is a pure passthrough with no enrichment, unlike `list_matters`, which _does_ inject a composed caption.

**The engine branch cannot fire on any tenant, A&P's included.** Every deadline falls through to hand computation permanently. The fixture was authored, not captured — a failure class that may repeat across all 51 skills.

The skill's own cardinal invariant is violated in both clauses (`references/output-format.md:65`): _"No computed dates — ever … the skill writes no calendar entry."_ It computes, and it writes calendar entries.

### 3.7 Fabrication pressure is authored into the skills

```
$ grep -rl "2026-PI-101" operator/skills/ | wc -l   →  37
$ ls -d operator/skills/*/ | wc -l                   →  51
```

37 of 51 skills instruct: _"refer to the matter by its NUMBER (e.g. 2026-PI-101), never by its case caption."_ The instruction demands an identifier on every line and supplies a plausible one. On a seat with no connector the model emits the example — which explains the phantom `2026-PI-101` / `2026-PI-103` / `2026-PI-105` rows in ashton-price's escalation ledger (2026-07-29), matters that do not exist in A&P's tenant.

`2026-PI-100` appears in no skill and no fixture: genuine free composition. Both mechanisms are live.

### 3.8 Provenance is unattributable

- **67 of 68 staging writes cannot be attributed to a routine.** `metadata.skill` is `None` on all 68; the `skill_name` column is NULL on every row. The only handle is the cron job id, and `bootstrap/cron_materialize.py:13` removes and re-adds all managed jobs each run, minting new IDs. 58 writes point at IDs that resolve to nothing.
- **The Operator has no machine identity in the client's system of record.** All 37 tasks carry `createdBy = ba848ad4` (Scott Durgan). The seat runs `authorization_code` under the Captain's consent, so Operator writes and human writes are **indistinguishable by identity in Smokeball**.

### 3.9 Uncleaned state in a client-shaped tenant

Eight leftover probe artifacts still live, including a contact named "Seam Test", `seed-probe@example.com`, and a task reading "PROBE deadline task (tool-wall probe, delete after)". `PI-2026-0001`'s matter description contains a webhook-test string and an API endpoint path (`smd.services/api/operator/<slug>/mcp`); the Operator filed a SECURITY ALERT task against it and **the payload is still present**.

`PI-2026-0001` itself is a webhook test fixture created 2026-06-22/23, twelve days before the seed run, which the Operator has worked as a live client matter for five weeks — and which the 2026-07-14 escalation _led with_.

### 3.10 The corruption is downstream of the tenant write

The email format is `matter <number> (<guid-prefix>)`. **Across 154 memo bodies, zero of those pairings disagree.**

| surface                                  | wrote                           | truth                           |
| ---------------------------------------- | ------------------------------- | ------------------------------- |
| tenant memo `8f9f07f4`, 2026-07-31 13:26 | `2026-PI-101 (f220c8e4)`        | `f220c8e4` **is** 2026-PI-101 ✓ |
| 2026-07-30 digest email                  | `matter 2026-PI-107 (062d73bd)` | `062d73bd` is 2026-PI-**106** ✗ |

Same skill, same format, correct when written to Smokeball, wrong when written to email. Whatever assembles the email is not what assembles the memo, or it re-derives the number after the GUID is already correct.

Memo-binding scan: 154 scanned, 116 carry a matter number, **0 fabricated numbers, 0 foreign GUID citations, 0 number/GUID disagreements**. Fifty body≠binding hits resolve to 46 legitimate digest roll-ups on `2026-OPS-001` and 4 client-matter cases, of which two are correctly-attributed cross-matter summaries, one is ambiguous, and **one is a genuine mis-attribution**: memo `e8a51cf3` (2026-07-14, bound to `2026-PI-101`) states _"tasks 0705cf01 and d1daf4fd from matter PI-2026-0001"_ — `0705cf01` is on `2026-PI-101`.

_Caveat:_ the scan keys off matter-number strings. A memo that mis-describes a matter without naming its number — wrong caption, wrong party, wrong document title — would not be flagged. Identifiers were checked; narrative accuracy was not.

### 3.11 The ACK write-back does not exist

Traced end to end: `customer.yaml:611-614` → `matter-inbox-router/SKILL.md:57,90` → `deadline-miss-escalator/SKILL.md:68` → `plugins/hermes-smd-escalation/__init__.py:157-183` → `shared/escalation_ledger.py:59`. **No `create_memo`, no `update_task`, no Smokeball call anywhere in the chain.**

Negative probe: `ACK-` appears 30× and `ESCALATION_ACKNOWLEDGED` 38× in the tenant — **all on `3c191bed` (`2026-OPS-001`, the Operator's own notepad), zero on any client matter.** No D1 table; `/opt/data/memories/` empty.

**What does work:** ACK tokens are deterministic — `token_for() = sha256("ack-token:" + item_key)` folded to six Crockford characters. 88 token rows, 88 recomputed matches, **zero true collisions**. `ACK-76FNK7` has one identity and was written once; on 07-25 it led the alert and on 07-28 the same item was folded into a collapsed group. The code was right both days; the prose was re-composed. The ledger _is_ read back (`__init__.py:157-167` refuses a token no prior raise carries), and snooze arithmetic is implemented (`escalation_ledger.py:298-301`).

**Why the seven-day promise fails anyway:** `item_key = sha256(matter_id, source_id, label, authored_date)` and **`label` is model-composed free text.** 86 fired events, 83 distinct item_keys, only 5 keys ever recur — the same deadline arrives as a new identity daily. Acking `K` snoozes `K`; tomorrow it is `K′`, unacked, and it fires. Compounded by duplicate tasks: two source_ids for one obligation means two keys and two codes, and acking the one you were shown leaves the other live.

**Do not rebuild the store.** Stop the label being model-authored, and stop the duplicate tasks.

**Live code, never exercised:** 86 fired, 2 acked — both on 2026-07-15, three minutes after a manual cron trigger recorded in `/opt/data/probe-1935-escalator.log`. Zero acks in the 16 days since.

**The worst finding: a naive fix would be worse than the absence.** Even with a write-back, the confirming attorney cannot be recorded. Three independent blockers: the `escalation_append` schema has nine properties under `"additionalProperties": False` with no actor field; the replying sender is tested only as a boolean roster gate and then discarded; and `auth_mode: authorization_code` on both seats means every write lands under whoever clicks Allow. A write-back built the obvious way would satisfy the _letter_ of the commitment while producing an **affirmative false record on a legal matter** — "Chris confirmed" when Christa replied. A confirmation is precisely the fact a malpractice question turns on.

Correct order: capture the verified replying sender in the ack event, then write it **as content** — a memo naming the confirmer. Never lean on Smokeball `createdBy`; under `authorization_code` it cannot be right for any multi-attorney firm.

### 3.12 Sentry: client data has already crossed the boundary

**A live Smokeball matter GUID is in the shared Sentry project today.** `SMD-OPERATOR-5`, first seen ~2026-07-07:

```
gate: suppression audit write failed (suppression stands): route=smokeball
reason=excluded-matter:3c191bed-cdda-48b9-a6ed-a51a349f3f94
```

`3c191bed` is `2026-OPS-001`. Source is `webhook_gate.py:473`, a real seat path. Plaintext, third party, no redaction.

**The init is genuinely good** (`shared/sentry_init.py:255-271`): `send_default_pii=False`, `before_send=scrub_then_throttle`, `before_breadcrumb=scrub_breadcrumb`, `traces_sample_rate=0.0`, `include_local_variables=False` — with a comment naming DPA Exhibit B-1 directly. The two richest surfaces are closed.

**Four gaps, descending risk:**

1. **No redaction exists for matter numbers, matter GUIDs, party names, or captions.** `redact_text` covers emails, provider key shapes, and named headers. Nothing would have caught `2026-PI-101`, `Alvarez v. Draper`, or the GUID above. This is why `SMD-OPERATOR-5` shipped.
2. **`event["extra"]` and `event["contexts"]` are never walked.** Proven: `SMD-OPERATOR-10` shipped an unredacted absolute filesystem path. Anything attached via `set_extra` ships verbatim. Call-site discipline exists (the reply plugin sends digests, not bodies) but that is authorial care, not a control.
3. **`logentry["params"]` is not scrubbed** — only the `%s` template. A client address in `SMD-OPERATOR-10` was caught by **Sentry's own server-side scrubbing, not ours**.
4. **Every `logger.error` becomes an event.** No `integrations` argument is passed, so LoggingIntegration is on at `event_level=ERROR`. Overlay format strings are not written with a data boundary in mind.

Sentry is armed on pilot-smokeball, ashton-price, and smd. **Documented behaviour does not match shipped behaviour:** `contracts/consumes.yaml:122` says the DSN is staged when `customer.yaml observability.sentry.enabled` is set; no seat authors any such key and arming is unconditional per-Machine.

**Contractual bottom line:** the structural protections named in DPA Exhibit B-1 are real and verifiable. The claim that Sentry receives _"technical error data only"_ is **not currently true**. Narrow and fixable — add identifier shapes to `redact_text`, walk `extra`/`contexts`/`logentry.params` — but it should not be signed off as verified in its present state.

Also: ~20 of 37 open issues in the production project are dev-laptop test fixtures (`server_name: mac23`, pytest argv, `RuntimeError: kaboom`). The `FLY_MACHINE_ID` gate added 2026-07-27 stops new ones; the existing ones were never cleaned.

### 3.13 Portal is not a sink — proven negative

Every outbound write call site in `shared/`, `plugins/`, `bootstrap/`, and `webhook_gate.py` resolves to one of five destinations: the console heartbeat (`shared/heartbeat.py:180`, the only control-plane write), Microsoft Graph, OAuth token exchange, AgentMail send, or in-Machine localhost webhooks. Sticky-stop and entitlement flows are **inbound** (console → gate), correctly directioned. No inventory row needed.

## 4. Corrections made during this audit

Recorded because they are the same error class as the defect under investigation — grading against fixtures and seed scripts instead of the record.

| Claim                                             | Correction                                                                                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PI-2026-0001` is fabricated                      | **Real.** `54bc1371-…`, Johnson v. Reyes, 9 files / 11 memos / 2 tasks. Absent from the seed script only.                                                                                                               |
| The SOL date is fabricated                        | **Real and correctly attributed.** Memo `1653e23e` (2026-06-22, pre-Operator) reads "SOL 04/20/2028." Survives as: off-schema and unverified, not invented.                                                             |
| `Sutter Roseville` is fabricated                  | **Real**, from the June webhook-test fixture.                                                                                                                                                                           |
| 07-14 → 07-31 was a regression                    | **Not a regression.** Two contradictory persisted tasks; different runs read different ones.                                                                                                                            |
| 22 T1 skills carry identifier + party             | **15.** Two counts conflated.                                                                                                                                                                                           |
| ACK codes are minted per emission and collide     | **Wrong.** Deterministic from a stable `item_key`; 88/88 recompute, zero true collisions. The seven-day promise fails because `label` — an input to `item_key` — is model-composed, not because the codes are unstable. |
| The 2026-07-31 flagged write was the loop closing | **No.** Memo `8f9f07f4` hedges every proposal in place and surfaces the July 25 / July 27 contradiction rather than smoothing it. It is the honest end of the behaviour.                                                |

`2026-PI-100` remains the only identifier with zero support in seed, tenant, skills, or fixtures.

## 5. Blast radius

**Production tenant is clean.** ashton-price has made **zero** Smokeball calls ever (416 audit rows). Its volume is clean.

**But the path is shared by construction.** Skills are one library, byte-identical at runtime (`1a64b46b…` on both seats); all 12 cron-armed skills diff to no differences. The sole differentiator is a credential.

**11 tier-1 skills are enabled on ashton-price, zero disabled.** Five fire unattended: `client-verification-tracker`, `deadline-miss-escalator`, `lien-ledger-tracker`, `medical-records-chaser`, `minors-compromise-packet`. Three carry money + identifier + party to third parties over the firm's name — `lien-ledger-tracker` and `minors-compromise-packet` (both scheduled) and `trust-balance-nudge` (manual, IOLTA).

The four work_product drafters are **not** authored on A&P; the PI drafting lane is correctly fail-closed.

**The trigger is one OAuth authorization.** A&P has all 12 cron routines armed and scheduled. On the day the Smokeball refresh token lands, they begin writing under `internal_write: draft_for_review` — which allows — with `metadata.skill` NULL and cron IDs that rotate away.

## 6. Commitments at risk

Both appear in the routines-detail PDF sent to the client 2026-07-30, and in `routine-grid.yaml` on **both** seats (pilot-smokeball `:75-78`, ashton-price `:82-84`).

1. _"It reads the dates Smokeball's court-rules calendaring computes."_ — Not provably false; the model can retype a date correctly. **Unguaranteed**: no mechanism carries a value from record to page without model composition, and the engine branch is unreachable. The PDF frames proposing as a narrow exception when it is the only mode that exists.
2. _"Every confirmation is logged on the matter with the attorney's name and a timestamp."_ — **UNBACKED, and not partially.** The write-back does not exist (§3.11), and the confirming attorney's identity is never captured at any layer, so it could not reach the matter even if a write were added tomorrow. Both halves of the sentence fail.
3. **DPA Exhibit B-1** — Sentry receives _"technical error data only."_ **Not currently true** (§3.12): a live matter GUID is in the shared project. This is a signature-blocking item, and "Sentry-scrubbing verification" is already one of three named open fill-ins in the agreement package.

Whether _"never computes and commits a deadline on its own"_ was breached is a construction question for the Captain: the Operator computed and wrote to the firm's calendar, but every entry is labeled PROPOSED.

## 7. Remediation plan

Ordered by severity, not by ease. Items 3–5 finish ADR 0083 rather than adding architecture.

1. **Bind the `matter.id → matter.number` join in code.** Highest value; source exists (`number` is first-class on the live matter record). Kills the largest defect class.
2. **Projection layer for remaining unwired fields** — caption, parties, SOL. `_attach_caption` already composes captions in code, proving the pattern. Model composes prose _around_ values, never values.
3. **Implement `extractive_only`** — the gate the registry already declares.
4. **Make the registry live at runtime**, not CI-only.
5. **Identity on the outbound path.** `_SEND_SCAN_KEYS` has no identity key, so third-party sends have nothing to compare a body against — the highest-severity path has the least ground truth.
6. **Compare, don't just record, on internal writes.** `extract_scope_metadata` (`plugins/hermes-smd-audit/emit.py:245`) already lifts the true `matter_id` into the audit row; nothing compares it to the body. Cheap, immediate.
7. **Deadlines.** Either wire a real engine read — which requires fixing the fictional `source_tag` fixture — or make the Operator refuse to state a computed date. Dedupe the contradictory persisted tasks.
8. **Remove the fabrication pressure**: the `e.g. 2026-PI-101` example in 37 skills.
9. **Give the seat a machine identity** distinct from the consenting human.
10. **Restore attribution**: populate `metadata.skill` / `skill_name`; stop rotating cron IDs, or record a stable routine key alongside them.
11. **Route audit signal somewhere a reviewer reads.** A report-only gate on Machine-local SQLite reports to nobody.
12. **Fixture audit across all 51 skills** for the authored-not-captured failure.
13. **Clean the tenant**: 8 probe artifacts, the live injection payload, the duplicate deadline events.
14. **Sentry scrub** — add matter-number, matter-GUID, party-name and caption shapes to `redact_text`; walk `event["extra"]`, `event["contexts"]`, and `logentry["params"]`. Reconcile `contracts/consumes.yaml:122` with the fact that arming is unconditional. **Signature-blocking for the A&P DPA.**
15. **ACK item identity** — derive `item_key` from a stable source rather than a model-composed `label`, and eliminate the duplicate tasks that mint two keys for one obligation. Do **not** rebuild the token store; it is correct.
16. **Capture the replying sender** on an ack event and write the confirmer as memo content. Build this _before_ any write-back, never after — a write-back without it manufactures false attribution on a legal matter.

### Sequencing note

Items 14–16 are the ones with a client commitment already delivered behind them. Items 1–6 are the ones that stop new defects. Item 13 is the one that stops old defects being read as current. The three groups are independent and can run in parallel.

## 8. Open items

| Item                                                                                | Status                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| ACK write-back existence and attribution                                            | **CLOSED** — absent, and unfixable-as-designed (§3.11)                          |
| Sentry payloads carrying matter identifiers                                         | **CLOSED** — a matter GUID has already crossed (§3.12)                          |
| Portal as an agent write sink                                                       | **CLOSED** — proven negative (§3.13)                                            |
| Money-tier tenant sources                                                           | unverified; `get_matter_balances` / `get_fees` / `get_expenses` would settle it |
| Seat-vs-App-1 OAuth scope diff                                                      | needs the refresh token on the Fly volume                                       |
| Narrative accuracy of the 154 memo bodies                                           | unchecked — identifiers were scanned, descriptions were not                     |
| Who holds the A&P OAuth consent                                                     | undetermined; governs whose name every write lands under                        |
| R2 orphaned skill bodies; residual AgentMail probe threads; ~20 stale Sentry issues | deferred, non-blocking                                                          |

## 9. Epistemic bounds

The tenant oracle **is** authoritative for matter numbers, GUIDs, captions, parties, and document titles — seed- or human-authored, not written by the Operator. It is **not** authoritative for dates: those are largely the Operator's own arithmetic, which is provably wrong about the calendar.

Authorship partitioning is inferential (timestamp clustering plus subject-line patterns), because Smokeball identity cannot distinguish seat from human. Attribution that would survive challenge must come from the seat's audit log joined on `session_id`.
