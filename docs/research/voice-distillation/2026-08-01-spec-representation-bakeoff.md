<!--
  PROVENANCE. Machine-generated synthesis, 2026-08-01, from a 17-agent offline
  bake-off run against the FICTIONAL Brannock & Ferreira rehearsal corpus
  (operator/customers/pilot-smokeball/seed/voice/). No client material was read
  and no seat was involved.

  WHAT IT SETTLES. ADR 0083 requires the firm voice to be derived from a
  customer's own documents, and the Captain ruled that a spec must not retain
  their sentences. Whether a spec can carry a voice WITHOUT those sentences was
  the open question the build was waiting on. It is answered here: three of four
  independently-proposed zero-verbatim representations beat the verbatim-exemplar
  control, the winner by 7.9 points on a 39.6-point scale between no-spec and
  control. Six arms, four designs proposed blind to each other, a rubric authored
  before any of them was seen, three judges scoring blind against four documents
  no candidate was allowed to read.

  READ SECTION 5 BEFORE CITING SECTION 1. The corpus is synthetic and was written
  to instantiate eight named traits, so every arm was partly rediscovering a
  specification rather than discovering a voice. 93.7 is an upper bound on a task
  easier than the real one, and the synthesis says so itself.

  STATUS: input to the build, not a decision record. Where it and an ADR
  disagree, the ADR governs.
-->

# Build spec: voice specification as a compiled diff

## 1. Verdict — does a zero-verbatim spec reach the verbatim ceiling?

**Yes, and it clears it. Decisively.**

| arm                             | mean     | "sounds like the firm" |
| ------------------------------- | -------- | ---------------------- |
| A3 Delta Card (zero-verbatim)   | **93.7** | 3/3                    |
| A2 Move Grammar (zero-verbatim) | 89.3     | 3/3                    |
| A4 TTG (zero-verbatim)          | 87.4     | 3/3                    |
| **CEIL — verbatim exemplars**   | **85.8** | 3/3                    |
| A1 Stratigraphy (zero-verbatim) | 84.7     | 3/3                    |
| **FLOOR — no spec**             | **46.2** | **0/3**                |

Set the scale first. The distance from no-spec to verbatim-exemplar is **39.6 points**. That is the entire value a voice spec delivers, and the floor's 0/3 confirms it is a difference in kind: three judges independently described FLOOR as competent, thorough, and belonging to no particular firm.

Against that 39.6-point span, **A3 beats the verbatim ceiling by 7.9 points — 20% of the total available range added on top of the ceiling.** Three of four zero-verbatim designs beat the ceiling; the fourth missed by 1.1. Every spec'd arm, verbatim or not, took 3/3 on the gestalt question. The exemplars bought nothing that abstraction did not buy more of.

**The mechanism matters more than the margin.** Verbatim exemplars did not merely fail to help — they actively produced the field's single worst artifact. All three judges, independently, named the same sentence as the clearest counterfeit in the set: CEIL's `She was thirty-seven.` standing alone at a section boundary in a document that expressly disclaims permanency. In the corpus, the age sentence is immediately followed by the argument the age carries (a career built on a pair of hands and a neck that bends over a chair). CEIL got the string and not the reason. Judge 1: "the clearest evidence in the set of a string transmitting where a logic did not."

That is not a defect of CEIL. It is the failure mode of exemplars as a representation. A string arrives detached from its trigger, so the model fills the slot wherever the slot fits syntactically. An abstraction that names the trigger cannot be misfired the same way.

**The honest counterweight, which shapes the design.** A3 won on compression and temperament and lost content: it dropped the arm symptoms, delivered wage loss as a lump, and cut the phone-records asymmetry. Judge 3: "It sounds exactly like the firm. It says less than the firm would have said." CEIL won on completeness and discipline. Judge 1 named the trade exactly: A3's format transmitted judgment about what to leave out, CEIL's transmitted judgment about what to prove, **and neither transmitted both.**

So the build is not "ship A3." It is a graft, and the two arms it must graft onto A3 are A4's procedural encoding (which produced the field's best _original_ move, `Two hours and fifty nine minutes separate the collision from her arrival at the hospital`, built from a timestamp block it assembled itself) and A2's numeric completeness discipline.

**One finding overrides the ranking entirely.** All four adversarial documents in the corpus close on a byte-identical string — verified, exactly one occurrence each in `01`, `02`, `03`, `06`:

> We would rather resolve this. We are prepared not to.

A3 treated this as a construction to re-instantiate and paraphrased it. It is not a construction. It is firm boilerplate, like a signature block, and it is the most recognizable string the firm owns. A no-verbatim policy that cannot represent boilerplate cannot represent a law firm. **The design therefore carries a fixed-string layer that is verbatim by design and exempt from the no-verbatim constraint** — the one place A1, the lowest-ranked proposal, was right where the winner was wrong.

---

## 2. The design we build

### 2.1 The structural decision: split the artifact in two

Both adversarial reviews arrived at this independently and it is the highest-leverage change in the build.

Today an assertion and a measurement are **typographically indistinguishable**. `Count in corpus: 0` costs one token to write and reads as computation. The reviewed card got `S5` (contractions) right and `S6` (hyphens) wrong from the same corpus in the same format, and no reader could tell which was which by inspection. That is not a diligence problem; it is a representation problem, and it is fixed structurally or not at all.

```
operator/customers/<slug>/voice/
  manifest.json        COMPILER   files + sha256 + human labels + date
  profile.json         COMPILER   every integer in the system
  fixed-strings.json   HUMAN      Layer Zero, verbatim, per-approval
  card.md              AGENT      prose. CONTAINS ZERO INTEGERS.
  gate.json            COMPILER   the exit gate, executable
  card.compiled.md     COMPILER   card.md + profile.json rendered together
```

**Hard invariant, CI-enforced: `card.md` may not contain a digit outside a `{{profile.*}}` interpolation token.** Every number the drafter sees is rendered from `profile.json` at compile time with its support count attached. An agent cannot assert a count into this system because there is no field for one.

### 2.2 The rule schema

Every rule in every layer is one object. No exceptions, no prose-only entries.

```json
{
  "id": "S6",
  "layer": "suppress",
  "statement": "Spelled-out numbers are open. No hyphen.",
  "replacement": "thirty four, not thirty-four",
  "probe": {
    "type": "regex",
    "pattern": "\\b(one|two|...|ninety)-(one|two|...|nine)\\b",
    "zones": ["prose"]
  },
  "evidence": {
    "support_docs": 11,
    "hits": 0,
    "docs": ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"],
    "counterexamples": [
      { "doc": "12", "line": 32, "span": "eighty-eight" },
      { "doc": "12", "line": 36, "span": "twenty-four" },
      { "doc": "13", "line": 40, "span": "twenty-five" },
      { "doc": "13", "line": 40, "span": "thirty-three" }
    ]
  },
  "confidence": "tendency",
  "gate": "warn",
  "scope": { "speech_act": ["*"], "audience": ["*"] },
  "budget": null
}
```

**The confidence ladder is the load-bearing addition.** It is computed, never authored:

| confidence     | condition                                                               | max gate tier                                             |
| -------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `rule`         | ≥3 documents, ≥2 speech acts, **zero** counterexamples                  | `block`                                                   |
| `tendency`     | ≥3 documents, or counterexamples present, or confined to one speech act | `warn`                                                    |
| `insufficient` | <3 documents                                                            | `advisory` — renders in an appendix, never the main table |

This one mechanism resolves four separate defects the adversarial reviews found. The `S6` hyphen rule, which the reviewed card asserted as an absolute `0`, auto-demotes to `warn` and prints its four counterexamples inline. A construction observed once (`O5`, the percent-decomposition) can no longer be given the Default/Here contrast grammar of a habit. A two-instance appositive frame (`O8-rank`) can no longer be abstracted away from its fixed wording. And `§0`'s assertion of "no measurable stylistic split between authors" — which silently closes a required ADR 0083 axis — emits as `insufficient` instead.

On that last point, precisely: the corpus is **not** author/audience-confounded the way one review claimed. Brannock signs 7 documents (`01, 03, 05, 06, 07, 09, 11`), Ferreira 6 (`02, 04, 08, 10, 12, 13`); both authors appear in both adversarial and client registers. The reason "no author split" is unestablished is simpler and worse: **the largest (author × speech-act) cell holds 3 documents.** There is no power here at all, and the correct emission is `INSUFFICIENT EVIDENCE — 13 docs, max cell n=3`, not a directive to the drafter.

### 2.3 The five layers, in generation order

**LAYER ZERO — FIXED STRINGS** _(from A1; the fix for the field's worst defect)_

Spans that are invariant across the corpus are reproduced byte-exact and marked non-negotiable. Not abstracted, not demonstrated, not paraphrased.

```json
{
  "id": "F1",
  "scope": { "speech_act": ["assert_claim", "reject_offer"] },
  "text": "We would rather resolve this. We are prepared not to.",
  "position": "closing",
  "evidence": { "exact_matches": 4, "docs": ["01", "02", "03", "06"] },
  "policy": "verbatim_required"
}
```

Promotion rule, compiler-computed: a span of ≥6 tokens appearing byte-identical in ≥3 documents is a Layer Zero candidate and is escalated to human approval. It never becomes an INSTALL construction. If retention policy forbids carrying the literal string in the card, Layer Zero emits a retrieval pointer — _"this document class closes on a fixed firm formula; retrieve `F1` from the matter template"_ — and never invents a replacement.

**LAYER ONE — SUPPRESS** _(from A3; the cheapest and highest-yield layer)_

Habits the model emits that the corpus contains zero of. These do the heaviest lifting and cost nothing to carry, because each is one grep and they fire before any positive instruction is read.

Verified by my own measurement across all 13 documents: **zero em dashes, zero semicolons.** Exactly **one** true contraction in 10,975 words — `didn't` at `08-mediation-brief-facts-nakashima.md:27`, inside quoted deposition testimony. The client letters are warm and achieve warmth with zero contractions, which inverts how a model reaches for warmth; that inversion is worth more to a drafter than any paragraph about tone.

Every SUPPRESS entry carries a `replacement`. A bare prohibition makes a model stall or fall back to default. This is A2's rule and it is non-negotiable.

**LAYER TWO — OVERRIDE**

Jobs both registers do, done differently. Same schema, same confidence ladder. The reviewed card's `O4` (numerals vs spelled) is the canonical `tendency`: the corpus itself writes `You produced 212 pages.` and `a 48 ounce bottle` and `clinical photographs at 48 hours, six months, and eight months` — both conventions inside one clause. It gates `warn`, never `block`, and it states the split (spelled for durations, event counts, ages and percentages _in argument_; numerals for measured quantities with units and anything read off an exhibit).

**LAYER THREE — INSTALL, as trigger/transform/budget** _(A4's encoding grafted onto A3's layering)_

This is the graft that recovers what A3 lost. A3's INSTALL entries are named constructions with demonstrations; A4's are trigger/transform pairs. The difference showed up in the results: A4 built an original emphatic beat nobody handed it, out of a timestamp block it assembled itself. A construction with a named trigger cannot be fired into a slot that has not earned it — which is exactly the `She was thirty-seven.` failure.

```json
{
  "id": "I7", "name": "pivot_on_earned_fact",
  "trigger": "A passage has just established a fact whose consequence is not yet stated,
              AND that consequence is adverse to the reader.",
  "transform": "Emit one sentence, under eight words, no subordination,
                stating only the consequence. Do not restate the fact.",
  "antitrigger": "The preceding passage has not established the fact. If the fact is
                  not on the page above this sentence, DO NOT EMIT.",
  "budget": {"max_per_document": 2},
  "confidence": "rule",
  "evidence": {"support_docs": 6, "instances": 11}
}
```

The `antitrigger` field is the counterfeit guard. It is the only mechanism in this design aimed at the failure mode that beat every arm's checklist.

**Budgets are compiler-enforced.** A4's own draft used its refrain three times, the third after a section that was entirely argument. These devices work because they are scarce; scarcity that lives in prose advice is not enforced, and A4 proved it on itself.

**LAYER FOUR — SWITCHBOARD, re-keyed to speech act × audience**

The reviewed card indexes register to audience. **That is the wrong controlling variable, and I verified it directly.** `01-demand-mva-duarte.md` and `06-adjuster-lowball-pushback-duarte.md` go to the same named adjuster (Denise Whitcomb), same carrier, same claim number `MPC-2025-448216`, same signatory:

|               | doc 01 (assert claim) | doc 06 (reject offer) |
| ------------- | --------------------- | --------------------- |
| I : we        | **0 : 7**             | **7 : 6**             |
| you (raw)     | 7                     | 15                    |
| mean sentence | 10.3                  | 15.8                  |

Same audience. Institutional plural flips to first-person singular, second-person density roughly triples, sentences run half again as long. An agent told to reject a lowball, consulting an audience-keyed table, gets the register backwards.

The switchboard is therefore a matrix of `(speech_act × audience)` cells — seven speech acts observed, not five audiences — each carrying `n` and a confidence. Cells with `n=1` render as **`n=1 — observed, not established`** and are never presented as a band. The seven speech acts: `assert_claim`, `reject_offer`, `confer_procedural`, `advise_client`, `brief_neutral`, `engage_client`, `decline_matter`. The reviewed card has no row and no skeleton for `reject_offer` — the second-most-common adversarial document a plaintiff's firm writes.

**LAYER FIVE — EXIT GATE** _(A2's placement, made executable)_

Last, because recency is what survives a long generation. Rendered from `gate.json`, every item a compiler probe with a named repair. A drafter can fail assertion 12 and know what to do; nobody can fail "be concrete."

---

## 3. The distillation procedure

Marked **[C]** COMPILER-COMPUTED, **[A]** AGENT-JUDGED, **[H]** HUMAN-SUPPLIED. Anything a compiler can compute is never left to a model.

**1. [H] Label every document before anything reads it.** Four axes: `audience`, `speech_act`, `signing_author`, and `exemplary | incidental`. The customer supplies these, not the agent. Nothing in `06-adjuster-lowball-pushback-duarte.md`'s filename tells an agent it is a rejection rather than a demand, and nothing tells anyone whether `12`/`13` — the two documents that break the hyphen rule — are newer house style or associate drift. Without the fourth axis an agent averages house style with drift and calls the result a voice.

**2. [C] Freeze the corpus as a hashed manifest.** Path, SHA-256, word count, labels, date. Emit into the card header. **A card without a manifest is not re-runnable, and everything downstream of an unrecorded corpus boundary is unfalsifiable.** The reviewed card read 9 of 13 documents and did not say which 9; the four it skipped are precisely the four that falsify its hardest rules.

**3. [C] Zone-segment and discard non-prose.** Letterhead, recipient block, RE/claim block, salutation, signature block, enclosure inventory, tables, Bates parentheticals, and provenance frontmatter. This runs before any count and emits the discarded byte ranges for review. Concretely: a naive hyphen grep over `12`/`13` returns 4 body hits **and 4 frontmatter hits** from the `note: ... voice-derivation ... five-sample` line. Half the apparent violations are contamination.

**4. [C] Run the compiler over prose zones only.** All counts, all distributions, all pronoun profiles, all salutation/sign-off extraction. Output is `profile.json`. **No agent-authored integer survives into any artifact.**

**5. [A] Agent reads the corpus cold, before seeing `profile.json`,** and drafts INSTALL candidates as trigger/transform/antitrigger triples, each citing document and line. Reading after the statistics produces rationalization of the statistics.

**6. [A] Agent proposes SUPPRESS and OVERRIDE as _hypotheses_, never as counts.** "I believe this firm never uses discourse connectives" is the agent's job. Returning 0 or 3 is the compiler's.

**7. [C] Apply the confidence ladder** (§2.2). Nothing below 3 documents enters a table. Nothing with a counterexample gates `block`.

**8. [C] Promote Layer Zero.** Byte-identical ≥6-token spans in ≥3 documents escalate to human approval as fixed strings.

**9. [C] NEGATIVE TEST — run `gate.json` against the corpus itself.** _This is the single highest-value mechanism in the build._ Any `block`-tier item must pass on **100%** of in-manifest, `exemplary`-labeled documents. Not 90% — at n=13, a 90% threshold tolerates exactly the one falsifying document, and the falsifying document is the one carrying the information. A `block` item that fails on any exemplary document **auto-demotes to `warn` and prints its counterexamples into the card.** The demotion is not a failure; it routes an unresolved disagreement in the firm's own writing to the human who can resolve it.

Run today, this test fires immediately. Under my careful tokenizer the reviewed card's `≥15% of sentences at five words or fewer` gate — which the card itself calls "the load-bearing number" — **is failed by three of the firm's own letters**: `08` at 12.8%, `12` at 12.1%, `13` at 10.3%.

**10. [C] Held-out validation.** Two documents excluded from steps 4–9. Draft against the compiled card, grade against the held-out originals with the existing harness at `operator/voice-gate/`. **A card that cannot reproduce a document it never saw is overfit, and nothing in the current design tests for this.**

**11. [C] Re-compile over the full corpus including held-out and any excluded documents,** and print every violation of the card's own rules by the firm's own writing.

**12. [H] Customer approval is per-rule, not per-document,** and each rule is displayed next to the step-11 violations of it. ADR 0083 already requires approval; what it does not require is that the customer be shown where their own letters break the spec they are approving.

**13. [C] Emit `card.compiled.md` + `gate.json` as one versioned artifact** keyed to the manifest hash, so §7 is executed rather than read.

---

## 4. What the compiler must enforce

Beyond the 8-token leakage check:

**On the card, at build time**

1. **No digits in `card.md`** outside `{{profile.*}}` tokens. Structural, not advisory.
2. **Manifest-hash CI gate.** Any change under `voice/` that does not update the manifest hash fails the build. This alone catches the stale-sample failure that produced every falsified count in the reviewed card.
3. **Support count rendered at point of use.** `S6 [n=11, 4 counterexamples]` — never a bare `0`.
4. **Every SUPPRESS/OVERRIDE entry has a non-empty `replacement`.**
5. **Skeleton coverage.** Every `speech_act` in the manifest has a skeleton, or the build fails naming the gap.
6. **Internal consistency.** No gate item may contradict a skeleton. The reviewed card's meet-and-confer skeleton prescribes a close that its own checklist item 15 forbids.
7. **Placeholder invariant.** Zero unbracketed proper nouns, dates, or dollar figures anywhere in `card.md`. Compiler-checkable, not a promise in a preamble.
8. **Skeleton-similarity check, replacing the 8-token rule as the _primary_ leakage guard.** Mask content words; flag any demonstration with ≥50% function-word identity against any corpus sentence. The reviewed card passes an 8-token check trivially and still contains a two-verb-swap clone of `07-meet-and-confer-prosser.md`. Paraphrase-smuggling is invisible to n-gram checks, and it happens without anyone intending it — the card was likely distilled from `voice-profile.md`, which quotes the corpus verbatim, so it inherited prose at one remove.
9. **Demonstration ban at n=1.** A construction observed once may be described but not demonstrated. A demonstration built from one instance is a transcription.

**On drafts, at generation time**

10. **All Layer Zero strings present and byte-exact** for the document's speech act.
11. **Budget counts** per INSTALL construction. Over budget blocks.
12. **Antitrigger evaluation** — flag any INSTALL construction emitted where its antitrigger condition holds.
13. **Numeric envelope from `profile.json` bands with `n`,** as observed range ± tolerance. Never round numbers, never a mean without its distribution.
14. **Address-discipline check.** Ratio of `your insured` to the defendant's surname within adversarial documents — A4's clearest loss and fully mechanical.
15. **Arithmetic reconciliation.** Every stated total decomposes against its own itemization, and every decomposition is followed by a clause saying what the composition argues. This is the completeness discipline A2 held and A3 lost; it is the half of "done" that the winning arm dropped.

**Shipped as code, not as a number**

The tokenizer, versioned, beside the card. Three independent measurements of this corpus produced mean sentence lengths of 11.9, ~14.5, and 13.0, and ≤5-word shares spanning roughly 10 points. My own two splitters differ by 3.1 points on the same files. Every one of those numbers is defensible and none is reproducible from the card alone. **Max sentence length is the clean falsification: the reviewed card claims 73 and says "may reach 70+ once per document"; two independent measurements find 56, and the longest paragraph in all 13 documents is 81 words.** A gate whose threshold cannot be recomputed is not a gate.

---

## 5. Residual risk — what this evaluation could not establish

**1. The corpus is synthetic and was generated to instantiate eight named traits.** This is the dominant threat and it cannot be argued away. A spec that recovers planted traits is weak evidence for a procedure whose real job is finding traits nobody planted. Every arm was, to an unknown degree, rediscovering a specification rather than discovering a voice. **Measurement:** run the identical procedure against a real firm's corpus with no trait list supplied, and have the firm's principal grade blind. Until that runs, treat the 93.7 as an upper bound on a task easier than the real one.

**2. The judges are same-family models grading model output.** Known bias, and the unanimity is itself a warning: all six spec'd arms scored 3/3 on "sounds like the firm" across a 9-point mean spread. The instrument does not discriminate at the top of its own scale. **Measurement:** the A&P principal grades the top three blind.

**3. Zero divergence flags fired.** Checklist and gestalt agreed on every draft, which the judges read as "no arm transmitted rules without temperament." The alternative reading is that the instrument cannot dissociate them. Judge 2 found the one place they came apart — CEIL's high checklist coexisting with a hollow construction "that a partner would catch in one read and no box on the rubric would." **The counterfeit band is not compiler-detectable.** `She was thirty-seven.` passes every mechanical probe in §4. The mitigation is architectural — the `antitrigger` field and Layer Zero, which prevent the construction from being emitted rather than catching it after — and it is untested. Nothing in this evaluation validates that antitriggers work.

**4. One fact pattern, one document type.** Every score in the table is a demand letter about one collision. Zero evidence exists about client status letters, declinations, meet-and-confers, or briefs — and those are precisely the document classes where the corpus breaks the card's own rules (`06` inverts the register, `12`/`13` fail the short-sentence floor and the hyphen rule). **Measurement:** re-run the arms on `reject_offer` and `advise_client`, which is also the only way to test the speech-act re-keying in §2.4.

**5. n=13, ~11k words, one firm, one practice area, one jurisdiction.** Every band is a small-sample band and the largest (author × speech-act) cell holds 3 documents. "No author split" is unestablished — not because of confound (both authors appear in both registers), but because there is no power at all. The design emits this honestly; it does not fix it. Only more corpus fixes it.

**6. Nothing measured degradation.** All drafts were single-shot from a full spec. Unmeasured: whether voice holds across a long generation, across multi-turn revision, under retrieval pressure, or when the card competes for context with a matter file. The Exit Gate is placed last on a recency argument that this evaluation did not test.

**7. The negative test has never been run against a card the customer approved.** Step 9 will demote rules — the hyphen rule and the short-sentence gate demote today, on this corpus. Whether a customer accepts a spec that visibly disagrees with their own letters is a product question, not a measurement question, and it is the likeliest place this design meets resistance.

**Files:** corpus at `/Users/scottdurgan/dev/ss-console/.claude/worktrees/sos-2026-08-01c/operator/customers/pilot-smokeball/seed/voice/` (13 docs); existing harness at `/Users/scottdurgan/dev/ss-console/.claude/worktrees/sos-2026-08-01c/operator/voice-gate/` (`harness.ts`, `scoring.ts`, `panel.ts`, `cli.ts`) is the step-10 grader and needs no replacement.
