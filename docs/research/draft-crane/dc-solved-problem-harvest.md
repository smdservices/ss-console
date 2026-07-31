# DraftCrane Solved-Problem Harvest

Read-only survey of `/Users/scottdurgan/dev/dc-console` (DraftCrane, shelved ~April 2026). Purpose: identify what this product already figured out that transfers to an agent-composed architecture (always-on per-customer agent, NL-primary interaction, UI composed at request time from authored view classes).

Method note: every claim below is cited to a file path. Where a documented decision and the shipped code disagree, I say so and cite both. Where something is not documented, I say "not documented" rather than inferring.

---

## 0. ADR index, with status and reversals

| ADR                      | Title                                                | Status in file                                                               | One line                                                                                                               |
| ------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 001                      | Editor Library Selection                             | **Accepted** 2025-02-10, **Reaffirmed** 2026-02-24                           | Tiptap (ProseMirror) over Lexical and Slate/Plate, decided on iPad Safari reliability.                                 |
| 002                      | —                                                    | **Does not exist**                                                           | Listed as a planned ADR in `docs/pm/prd.md:770` ("Google Drive Sync Strategy"), never written. No file in `docs/adr/`. |
| 003                      | AI Provider                                          | **Accepted** 2026-02-16                                                      | Swap Anthropic → OpenAI GPT-4o; keep standalone app, reject shipping as a ChatGPT App; abstract behind `AIProvider`.   |
| 004                      | PDF/EPUB Generation                                  | **Proposed** 2026-02-16 (never moved to Accepted, but **fully implemented**) | Cloudflare Browser Rendering REST `/pdf` for PDF + custom in-Worker JSZip EPUB. PDF is the priority.                   |
| 005                      | Content Storage Architecture                         | **Accepted** 2026-02-16                                                      | Four tiers; Google Drive canonical, R2 write-through cache, D1 metadata only, IndexedDB keystroke buffer.              |
| 006                      | Multi-Tier AI (Edge + Frontier)                      | **Accepted** 2026-02-17                                                      | Workers AI Mistral Small 3.1 as edge tier, GPT-4o as frontier, `AI_DEFAULT_TIER` env flag, "Go Deeper" escalation.     |
| 006-quality-gate-results | Spike results for the above                          | Results doc                                                                  | **The gate FAILED for edge.** Verdict: "Keep `AI_DEFAULT_TIER=frontier`."                                              |
| 007                      | Research Query Prompt Engineering                    | **Proposed — Pending review**                                                | Recommends Strategy A (schema-in-system-prompt) + GPT-4o; proposes adding `jsonCompletion()` to `AIProvider`.          |
| 008                      | Document Parsing                                     | **Accepted** 2026-02-19                                                      | `unpdf` for PDF, `mammoth.js` for DOCX, both in Workers; store as sanitized HTML.                                      |
| 008-spike-results        | Spike data                                           | Results doc                                                                  | 18/18 checks pass; per-format perf tables.                                                                             |
| 009                      | Content Chunking + Context Window                    | **Accepted** 2026-02-20                                                      | Strategy C hybrid: FTS5-first, Vectorize semantic fallback. 300/400/50-word chunks, 2-sentence overlap.                |
| 009-spike-results        | Spike data                                           | Results doc                                                                  | FTS5 **P@3 = 0.00 on paraphrase queries**; Vectorize never provisioned (API token scope).                              |
| 010                      | LLM Prompt Engineering for Structured Snippet Output | **Accepted** 2026-02-19                                                      | GPT-4o + `response_format: {type:"json_object"}`. Strict json_schema mode _reduced_ quality.                           |

### Reversals and supersessions

1. **ADR-010 de-facto supersedes ADR-007.** Both are dated 2026-02-19 and answer the same question (how to get structured, source-attributed snippets out of an LLM). ADR-007 is still marked "Proposed — Pending review"; ADR-010 is "Accepted." Neither file references the other as superseded. Worse, the strategy letters collide and mean different things: in ADR-007, "Strategy B" = few-shot prompting (`docs/adr/ADR-007-research-query-prompts.md:19`); in ADR-010, "Strategy B" = `response_format: json_object` (`docs/adr/ADR-010-snippet-prompt-engineering.md:31-33`). Reading them together without noticing this produces a wrong conclusion. **ADR-010 is the one that shipped** — its prompt text is verbatim in `workers/dc-api/src/services/research-query.ts:92-138`.
2. **ADR-006's central premise was disproven by its own quality gate.** ADR-006 justifies the edge tier on latency: "Expected TTFT < 1 second vs 2-5+ seconds" (`ADR-006-multi-tier-ai.md:26`). The gate measured the opposite: "Edge mean 2,626ms vs Frontier mean 2,077ms. Frontier is actually faster, which eliminates the usual latency argument for the edge model" (`ADR-006-quality-gate-results.md`, Latency section). The ADR body was never amended. `wrangler.toml:47` still reads `AI_DEFAULT_TIER = "frontier"`.
3. **ADR-006 reversed its own model choice mid-day.** Model Change History (`ADR-006-multi-tier-ai.md:73-77`): `@cf/zai-org/glm-4.7-flash` selected and rejected the same day (2026-02-17) — "only 3B active params, Chinese-origin with CCP censorship patterns, poor English nonfiction quality."
4. **ADR-003 reverses the PRD.** PRD Section 17 recommended "Direct Anthropic API" (`docs/pm/prd.md:784`). ADR-003 swapped to OpenAI on a _market_ argument, not a technical one: the target user knows "ChatGPT" as a brand (`ADR-003-ai-provider.md:15`).
5. **ADR-009's retrieval decision was never implemented.** See §4 below. This is the largest documentation/reality gap in the repo.
6. **The Design Charter reverses the Design Brief's own tab names.** `docs/design/source-review/design-spec.md` (2026-02-19) specifies tabs Sources / Ask / Clips. `docs/design/library-desk-spec.md:137` logs "2026-02-24: Renamed 'Sources'/'Ask' tabs to 'Library'/'Desk'." The older spec still says "Authoritative design document" at line 3.

---

## 1. Content storage + consistency (ADR-005)

**(a) Problem.** `docs/adr/ADR-005-content-storage-architecture.md:9-28`. Four storage tiers available (IndexedDB, R2, Google Drive, D1). Product promise is "Your book. Your files. Your cloud." Constraints: non-technical users, iPad Safari primary (iOS evicts IndexedDB under storage pressure), users may never connect Drive, "content loss is the worst possible failure mode."

**(b) Decision, verbatim.** Line 32:

> **Google Drive is the canonical store. R2 is a write-through cache. D1 stores metadata only. IndexedDB provides instant local saves.**

The full invariant section (lines 80-82) is exactly three sentences:

> ### Invariant
>
> **If R2 and Drive disagree, Drive wins.** R2 can be wiped and rebuilt from Drive at any time. R2 is disposable; Drive is not.

Save flow (lines 36-51): editor → IndexedDB (every keystroke, ~300ms debounce) → 2s debounce → API → fans out to R2 cache write (always), Drive write (async, non-blocking, only when connected), D1 metadata update.

Read path (lines 69-78): R2 first; on miss, fetch from Drive, populate R2, return.

What D1 stores (lines 84-89): title, sort_order, timestamps, word_count, drive_file_id, relationships. "**Never:** chapter body content, manuscript text, user prose."

Degraded mode when Drive is not connected (lines 57-65): R2 holds content, plus a **non-dismissible** banner — "Your work is saved, but not to your Google Drive. Connect Drive to keep your book safe." On later connect, R2 content migrates to Drive and R2 retains copies as cache.

**Conflict-resolution rules — the complete set.** There are only two, and one of them is not really conflict resolution:

- Drive-vs-R2 divergence: Drive wins, R2 is rebuilt (line 82).
- Concurrent-write detection: optimistic locking on an integer `version`, surfaced as HTTP 409. `ADR-005:120` specifies an `X-Chapter-Version` header. The shipped implementation puts version in the request body instead and compares before write — `workers/dc-api/src/services/content.ts:77-84`:

```ts
if (input.version !== chapter.version) {
  conflict(
    `Version mismatch: expected ${chapter.version}, got ${input.version}. Another save may have occurred.`
  )
}
```

There is **no merge, no three-way diff, no operational transform, and no CRDT.** The PRD is explicit that this is deliberate: `docs/pm/prd.md:774-776` rejects real-time OT as "overkill for Phase 0. Phase 0 is single-user." Crash recovery is a _prompt_, not a merge — "Crash recovery via IndexedDB comparison on editor mount" (`prd.md:305`).

**Offline.** Offline is explicitly **not supported**. `prd.md:168` competitive table lists Offline: DraftCrane "No" vs Atticus "Yes (PWA)". `prd.md:845` lists offline mode under "Explicitly NOT in Phase 0." IndexedDB is a crash buffer, not an offline mode — `prd.md:440` says IndexedDB "Does NOT Do: Long-term storage, cross-device sync."

Implementation guidance worth keeping (`ADR-005:115-120`): Drive write failures retry with exponential backoff and are **not surfaced as save failures** (R2 already has the content); the "Connect Drive" banner must be non-dismissible because "it's a safety warning, not a promotion"; R2 keys are `chapters/{chapter_id}/content` with no user-id prefix because chapter IDs are globally unique ULIDs.

Shipped detail the ADR does not mention: Drive write-through is **coalesced at 30s** at the route layer, not on every 2s autosave — `workers/dc-api/src/services/content.ts:91-93` comment: "Drive write-through is handled at the route layer (chapters.ts PUT handler) with 30s coalescing to avoid hammering Google API on 2s auto-save cadence."

**(d) Transfer assessment: SURVIVES WITH MODIFICATION — and the invariant transfers verbatim.**

The tier _names_ are DraftCrane's; the _shape_ is the reusable thing, and it is a shape an agent architecture needs more than DraftCrane did. Stated generically: **one store is canonical and customer-owned; every other copy is declared disposable and reconstructible from it; the disposable copies are where you get to be fast.** That is directly the answer to "where does agent-produced state live so the customer keeps it if we disappear," and it is a cleaner answer than "the agent's volume." The ss-console CLAUDE.md "gone means gone" discipline is the same idea in the negative direction — this is its positive twin, and it names the _ordering_ rule ("Drive wins") that makes convergence decidable.

What dies: the specific 2-second debounce, the IndexedDB keystroke log, and the entire dual-write save path are artifacts of a keystroke-level rich-text editor. An agent-composed UI has no keystroke stream to buffer. What survives: the tier table, the invariant sentence, the "cache miss backfills from canonical" read path, optimistic-version 409 as the only concurrency primitive, and the non-dismissible degraded-state banner as a _pattern_ (an unconfigured or disconnected canonical store must be loudly visible, not silently tolerated).

One caution: their conflict story is only adequate because Phase 0 is single-user and single-device-at-a-time. An always-on agent writing concurrently with a human is a genuinely multi-writer system. Version-mismatch-409 will fire constantly and there is no merge behind it. **Do not port the conflict model without deciding what happens on the 409.**

---

## 2. Trust / approval model

**(a) Problem.** The product needs AI help to be worth using without the author feeling the AI is writing their book. `docs/design/brief.md:97-119` records the target user's exact fear:

> "If DraftCrane calls the AI my 'Editor' and then the experience feels like autocorrect with better vocabulary, the metaphor will backfire. Hard. Because you have raised my expectations."

**(b) Decisions, verbatim.**

The metaphor, `docs/design/brief.md:27-34`:

> Every nonfiction book that reaches a bookshelf is the product of two people: the **Author**, who has the expertise and writes the manuscript, and the **Editor**, who reviews, refines, shapes, and strengthens that manuscript. The Author writes. The Editor reads what the Author wrote and makes it better. The Author always has the final say.
>
> [...] This is not branding on top of technology. This is the actual product architecture. The AI never writes autonomously. The AI never applies changes without approval. The AI reads the Author's text, proposes a rewrite, and the Author decides. That is what editors do.

The principle, `docs/process/dc-project-instructions.md:62`:

> **AI assists, never replaces.** Every AI action requires user approval. No silent rewrites. No ghost-generated content presented as the author's work. Source attribution is non-negotiable.

And `docs/pm/prd.md:122-124` (Principle 3):

> The author writes. The AI assists. Every AI-generated change requires explicit approval before it is applied. No silent rewrites.
>
> **In practice:** AI rewrite uses a bottom sheet with "Use This" / "Try Again" / "Discard." User always sees original and rewrite simultaneously. Acceptance is undoable via Cmd+Z.

Three hard negative constraints on what the Editor is (`brief.md:36-40`): **not a chatbot** ("No conversation thread, no message history, no 'How can I help?'"), **not a character** ("No name, no persona, no 'I' or 'we' in the interface"), **not a feature to be sold** (toolbar says "Editor," never "AI Editor"). Reinforced in `docs/design/charter.md:19` (Principle 5, Invisible Technology) and the anti-pattern table at `charter.md:284`: `"AI" in user-facing labels` — reason: "Invisible Technology principle."

Anti-inspiration is named explicitly (`brief.md:462-470`): Jasper ("AI as the primary actor"), Canva Magic Write ("'magic' is patronizing"), ChatGPT ("Conversation as paradigm. Wrong for a writing editor. An editor does not have a conversation about the text — an editor reads it, marks it up, and gives it back. No chat interface."), Sudowrite ("The Editor never writes first drafts. The sequence is never reversed.").

**(c) How a proposed change actually reaches the user and gets accepted.** Traced through code, not just docs:

1. Author selects text in Tiptap. A floating action bar appears ~200ms after the native iPadOS selection menu, on the opposite side of the selection (`prd.md:671`), deliberately not competing with the OS.
2. Tapping it opens the **Editor panel** — left side, violet accent — which replaced an earlier bottom sheet. `docs/design/editor-panel/chapter-mode.md:9`: the panel "persists after accept/reject actions," which the bottom sheet did not.
3. The panel has five explicit states (`chapter-mode.md:44-50`): Empty / Ready / Streaming / Complete / Error. Instruction is supplied by tapping one of five chips or typing freeform (`chapter-mode.md:52-62`).
4. `POST /ai/rewrite`. Server writes an `ai_interactions` row **before** the model call, with `accepted` left NULL — `workers/dc-api/src/services/ai-rewrite.ts:161-177`.
5. The SSE transform emits `{type:'start', interactionId, attemptNumber, tier}` **immediately, before any token**, "so the frontend can track it before tokens arrive" (`ai-rewrite.ts:193-198`). Then `token` events, then `done`. On `flush`, the row is updated with `output_chars` and `latency_ms`.
6. Author sees original and proposal simultaneously and picks one of three: **Use This** (replace + `POST /ai/interactions/:id/accept`), **Try Again** (new request carrying `parentInteractionId`), **Discard** (close, `.../reject`).
7. `attempt_number` is computed server-side by counting the retry chain — `ai-rewrite.ts:147-156` counts rows where `id = parentId OR parent_interaction_id = parentId`.
8. Accept/reject sets `accepted = 1|0` — `workers/dc-api/src/services/ai-interaction.ts:53-105`. Acceptance is undoable with Cmd+Z; the highlight flash respects `prefers-reduced-motion` (`prd.md:315`).

**The telemetry schema is the load-bearing part.** `ai_interactions` (`prd.md:486`, migrations 0005/0007/0008): `id, user_id, chapter_id, action, instruction, input_chars, output_chars, model, latency_ms, accepted, attempt_number, parent_interaction_id, tier, created_at`. The file header states the rule twice: "Logs interaction metadata to D1 ai_interactions table (**NO user content stored**)" (`ai-rewrite.ts:11`) and "Stores metadata only (no content)" (`ai-interaction.ts:8`). The _instruction_ is stored (truncated to 500 chars); the text and the rewrite are not. `accepted` is nullable and tri-state — NULL means the author never decided, which is a different and useful signal from an explicit reject.

The target metric this feeds: "AI rewrite usage/acceptance — 50%+ try AI; **40%+ acceptance rate** — Data source: D1 ai_interactions" (`prd.md:708`).

**(d) Transfer assessment: TRANSFERS, and it is the single most valuable asset here.**

Four things port with essentially no modification:

- **The propose/accept/reject/retry loop as the atomic unit of AI action**, with a durable row created _before_ the model call and closed by an explicit human verdict. This is exactly the shape ss-console already reaches for (draft-for-review, entitlement ceilings, `crane_verify`) but DraftCrane wrote down the _schema_, including `parent_interaction_id` retry chains and tri-state `accepted`.
- **Metadata-only telemetry.** Log the decision, never the content. This is a privacy posture _and_ a storage posture, and it lets acceptance rate be a first-class product metric without a content store.
- **The role metaphor as architecture rather than branding.** "This is not branding on top of technology. This is the actual product architecture." An agent-composed product will be tempted to name the agent and give it a persona; DraftCrane deliberately refused, and wrote down why (`brief.md:36-40`), and then wrote down the risk of refusing badly (`brief.md:105`).
- **`attempt_number` / retry chain.** Retry is a first-class modeled relationship, not a new unrelated request. Any agent that revises its own output needs this to answer "how many tries did that take."

One deliberate anti-pattern to _inherit_: **no chat.** `brief.md:466` rejects conversation as the paradigm for editorial work. For an architecture whose premise is "the user interacts largely through natural language," this is the most useful dissent in the repo — it is a documented argument that NL-in does not imply chat-transcript-out. DraftCrane's answer was: NL instruction in, structured artifact out, human verdict required. That is a shape worth stealing wholesale.

What is genuinely unresolved and left as an open question: **Decision 2, "Should Rewrite Results Include Explanations?"** (`brief.md:539-551`). Target user's framing: "The feature is the rewrite. The metaphor is the explanation. Without the explanation, 'Editor' is just a label. With it, 'Editor' is an experience." Never resolved, never built. For an agent architecture, this is the "why did you do that" question and it is still open here.

---

## 3. Document parsing (ADR-008) and chunking (ADR-009)

### Parsing

**(a) Problem.** `docs/adr/ADR-008-document-parsing.md:9-19`. Only `.txt`/`.md` supported; users need `.pdf`/`.docx`. Workers constraints: 128 MB memory, 30s CPU (Unbound), no `node:fs`, bundle < 25 MB compressed.

**(b) Decision, verbatim** (line 34): "**Adopt both `unpdf` for PDF and `mammoth.js` for DOCX.** Both libraries pass all quality and compatibility thresholds."

Ruled out with reasons (lines 26-30): `pdfjs-dist` (canvas/DOM assumptions), `pdf-parse` (unmaintained since 2023), DIY jszip+xml for DOCX.

Measured, not assumed. Combined bundle **757 KB gzipped** / 3.4 MB uncompressed (line 76). PDF parse time is **~5 ms/KB, linear** — 4 MB PDF = 21.8s, which is what sets the 20 MB upload cap against the 30s CPU limit (lines 81-113). DOCX is far cheaper: 109 KB / 3.19M words in 1,439ms.

Storage format is HTML for both (lines 115-122) — mammoth emits HTML natively, PDF text is wrapped by an existing `textToHtml()`, and Tiptap consumes HTML directly: "Zero architecture changes required."

Sanitization: mammoth output must pass `sanitize-html` before R2 storage, with an allowlist **derived from an actual element census across all test fixtures** (lines 128-138, census at `ADR-008-spike-results.md:144-163`), not from imagination.

Six known limitations are stated plainly (lines 186-198). The two that matter most: **PDF text extraction is structurally flat** ("it stores rendering instructions, not document structure"), and image-only PDFs silently produce zero text — the spike verified this "Confirms no silent hallucination" (`ADR-008-spike-results.md:60`).

**(d) Transfer: SURVIVES WITH MODIFICATION.** The library choices are Workers-specific and time-stamped, so re-verify before adopting. Three things transfer regardless of runtime: (1) **the acceptance-threshold table** — every check has a numeric threshold declared before the run (`ADR-008-spike-results.md:208-219`), which is how you make "we evaluated a library" falsifiable; (2) **deriving the sanitizer allowlist from an observed element census**; (3) **the negative test** — feed it an image-only PDF and assert _zero_ output, because the failure you fear is silent fabrication, not a crash. That third one is the same instinct as ss-console's kill-testing.

### Chunking

**(a) Problem.** `docs/adr/ADR-009-content-chunking.md:9-11`: "DraftCrane's AI rewrite currently sends zero source context to the LLM. [...] Source materials are fully implemented [...] but never injected into AI prompts."

**(b) Decision.** Line 25: "**Adopt Strategy C: Hybrid (FTS5-first + semantic fallback).** Use D1 FTS5 for keyword queries and Cloudflare Vectorize for paraphrase/conceptual queries. Route by BM25 score threshold."

**Chunking parameters** (lines 51-60), each with a stated rationale:

| Parameter         | Value       | Rationale (verbatim)                               |
| ----------------- | ----------- | -------------------------------------------------- |
| Target words      | 300         | Conservative for bge-small-en-v1.5 512-token limit |
| Max words         | 400         | Hard cap — zero chunks exceeded this in evaluation |
| Min words         | 50          | Avoids tiny fragments, merges into previous chunk  |
| Overlap           | 2 sentences | ~50 words continuity between adjacent chunks       |
| Sentence boundary | Always      | 100% compliance across all fixture types           |

**Two chunking modes** (lines 62-74), keyed off source structure, which is the genuinely clever part:

- **Structured HTML** (DOCX/MD): parse at element boundaries; each chunk carries its **parent heading hierarchy**, e.g. `["Chapter 3", "Methodology"]`.
- **Flat HTML** (PDF, which has no structure): heuristic heading detection — ALL-CAPS lines under 10 words, or short lines without terminal periods followed by longer content — falling back to positional context `Section N of M`.

**Metadata carried per chunk** (`ADR-009:77-89`, implemented identically at `workers/dc-api/src/services/chunking.ts:27-46`):

```ts
interface Chunk {
  id: string // sourceId:chunkIndex
  sourceId: string
  sourceTitle: string
  headingChain: string[] // ["Chapter 3","Methodology"] or ["Section 2 of 8"]
  text: string // plain text, HTML stripped
  html: string
  wordCount: number
  startOffset: number
  endOffset: number
}
```

The heading chain is **prepended to the text before embedding** for semantic context (`ADR-009:143-148`): `"Chapter 3 > Methodology: The grounded theory approach..."`.

Chunk invalidation (lines 216-248): each row stores `content_hash` (SHA-256 of source HTML at index time) and `indexed_at`; on any source update, recompute the hash, and on mismatch delete from D1 + FTS5 + Vectorize and re-index.

Measured results, `ADR-009-spike-results.md:31-39`: 885 chunks, **0 under 50 words, 0 over 400 words**, 87.3% landing in the 300-400 band, 100% sentence-boundary compliance across both structured and flat modes.

The shipped implementation matches the spec closely (`chunking.ts`), including a `ChunkAccumulator` that merges an undersized tail chunk into its predecessor (`chunking.ts:278-284`) and an abbreviation-protecting sentence splitter (`chunking.ts:90-108`) that null-byte-escapes `Dr.`, `e.g.`, `i.e.`, initials, and digits before splitting.

**(d) Transfer: TRANSFERS.** The parameter set is empirically justified, the two-mode structure/flat split generalizes to any corpus where some inputs carry structure and some do not, and `headingChain` is the reusable idea — **carry provenance in the chunk, not alongside it**, so that a citation is reconstructible from the chunk alone. `content_hash` + `indexed_at` invalidation is the standard correct answer and they wrote it down.

Caveat, and it is a real one: the 300-word target is tuned to a **512-token embedding model** (`bge-small-en-v1.5`). ADR-009's own Known Limitation #3 admits "No token-level validation. The 300-word target is a conservative proxy." If the new architecture uses a modern long-context embedding model or skips embeddings, this number is not yours — the _method_ is, the number is not.

---

## 4. Retrieval and context budget — read this section carefully

The team-lead asked me to read `workers/dc-api/src/services/prompt-builder.ts` in full and report the chunk-selection algorithm under a token budget. I did. **It is dead code.** This is the most important finding in the harvest and it inverts the answer to the question as asked.

### What the documented design says

ADR-009 §"Retrieval Architecture" (lines 92-186) specifies: a `source_chunks` table plus a `source_chunks_fts` FTS5 virtual table; a `dc-source-chunks` Vectorize index (384-dim, cosine); embeddings from `@cf/baai/bge-small-en-v1.5` at optimal batch size 25 (8 ms/text); FTS5 first, falling through to Vectorize when zero results or all BM25 scores fall below **2.0**; then context assembly = deduplicate → sort by source then document order → format with `[Source: "...", Section: "..."]` headers → enforce an **8K-token (~6K-word) budget**.

### What `prompt-builder.ts` + `context-window.ts` implement

`workers/dc-api/src/services/context-window.ts` implements the budget layer faithfully:

- `estimateTokens()` — word count × **1.33 tokens/word**, a deliberate over-estimate: "Conservative (overestimates) to avoid exceeding limits" (`context-window.ts:29-32`). No tokenizer dependency.
- `estimateChunkTokens()` — critically, it **charges the chunk for its own attribution header and separator**, not just its body (lines 65-72). Provenance costs budget and is counted.
- `DEFAULT_SOURCE_TOKEN_BUDGET = 8192`, `DEFAULT_MAX_CHUNKS = 8` (lines 35-38).
- `selectChunksWithinBudget()` (lines 107-148) — **the selection algorithm is a single greedy pass over a pre-sorted list.** Chunks arrive already sorted by relevance from retrieval; it walks them in order and stops at the first of two limits: `selected.length >= maxChunks`, or `totalTokens + chunkTokens > sourceContextBudget`. It **breaks** rather than skipping — it does not try to fit a smaller later chunk into the remaining space. Returns `{selectedChunks, totalTokens, excludedCount, budgetExhausted}`.
- `deduplicateChunks()` (lines 160-171) — by chunk `id` only. The header comment claims it "detects high-overlap pairs"; **it does not.** It is a `Set` of IDs. ADR-009 Known Limitation #5 admits the 2-sentence overlap means retrieved neighbours share sentences and "The context assembler deduplicates by chunk ID but not by content overlap."
- `sortChunksByDocumentOrder()` (lines 177-186) — group by `sourceId`, then ascending `startOffset`.

`prompt-builder.ts:178-205` composes these in a stated four-step order — **dedupe → select-by-relevance-under-budget → re-sort into document order → format**. That ordering is the design insight: _select on relevance, present in reading order._

### What actually runs in production

`workers/dc-api/src/routes/research.ts:158` instantiates `ResearchQueryService`. That service (`workers/dc-api/src/services/research-query.ts`) does **not** import `prompt-builder` or `context-window`. Verified by grep across `workers/`, `web/`, and `scripts/`: the only importer of `prompt-builder.ts` is `workers/dc-api/test/prompt-builder.test.ts`, and the only importers of `context-window.ts` are that same test and `prompt-builder.ts` itself.

What `ResearchQueryService.executeQuery()` actually does (`research-query.ts:297-445`):

1. `collectSourceContent()` — pulls **every** active source with cached content for the project from R2 (lines 246-291).
2. Chunks **all of them at query time**, on every query (lines 327-334). No index, no cache.
3. `distributeChunksAcrossSources()` (lines 169-202) — **round-robin across sources, taking chunks in document order**, until the budget of `MAX_CHUNKS_PER_QUERY = 8` is filled. For 3 sources it yields roughly 3/3/2.
4. Sends those 8 chunks to GPT-4o.

**There is no relevance ranking of any kind in the production path.** Not BM25, not embeddings, not keyword matching. The 8 chunks that reach the model are the **first ~3 chunks of each source** — i.e. the beginning of each document. If the answer is on page 40, it is never retrieved. `MAX_CHUNKS_PER_QUERY = 8` and `MAX_SNIPPETS = 8` are hard-coded constants at `research-query.ts:86-87`.

Corroborating evidence that the hybrid retrieval was never built:

- No `source_chunks` or `source_chunks_fts` table exists. The only FTS5 migration is `0014_create_source_content_fts.sql`, which is **whole-document** FTS (`source_id, title, content`) used solely by `SourceSearchService` for the Sources-tab keyword search box (`workers/dc-api/src/services/source-search.ts:1-6`). The design spec says so explicitly: "**NOT used for AI queries** (AI uses full source text via LLM). FTS is for the Sources tab search" (`docs/design/source-review/design-spec.md:1240`).
- No Vectorize binding anywhere in `wrangler.toml`. The only occurrence of the string "Vectorize" in the worker source is a comment at `chunking.ts:6`. `ADR-009-spike-results.md:121`: "**Not tested.** The automation API token (`CLOUDFLARE_API_TOKEN`) lacks Vectorize scope."
- ADR-009's stated integration into AI rewrite — `buildSystemPrompt(input, sourceContext?)` at `ADR-009:192` — was never done. The shipped signature is `buildSystemPrompt(input: RewriteInput)` (`ai-rewrite.ts:49`), with no source-context parameter. **AI rewrite still sends zero source context**, which was the exact problem ADR-009 opened by naming.

### The finding beneath the finding

The spike measured the thing that mattered and then it was not acted on. `ADR-009-spike-results.md:64`: FTS5 on paraphrase queries scored **P@1 = 0.00, P@3 = 0.00, P@5 = 0.00, MRR = 0.00** — total failure. ADR-009 draws the correct conclusion (line 29): "The Research Board use case is primarily paraphrase-oriented [...] FTS5 alone cannot serve the product." Then the semantic half was blocked on an API-token scope issue, and what shipped was neither half — it was round-robin-from-the-top, which is strictly worse than the FTS5 that was rejected as insufficient.

The pass/fail table records the failure honestly (`ADR-009-spike-results.md:155`): "FTS5 keyword P@3 (structured) — **FAIL** — 44% — threshold >80%."

**(d) Transfer assessment: the ALGORITHM transfers; the SHIPPED SYSTEM is a trap.**

Transfers, and is worth lifting almost verbatim:

- Charging attribution overhead against the token budget (`estimateChunkTokens`).
- The four-step order: dedupe → relevance-select under budget → **re-sort into document order** → format. Presenting retrieved fragments in reading order rather than relevance order is a small, real, cheap insight.
- Word×1.33 as a deliberately conservative tokenizer-free estimate, with the reasoning written down.
- `BudgetResult` returning `excludedCount` and `budgetExhausted` — the assembler tells you what it dropped. An agent needs exactly this to say "I only looked at part of your corpus."
- Round-robin fair-share across sources (`distributeChunksAcrossSources`) is genuinely useful _as a diversity floor layered on top of relevance ranking_ — it prevents one large document from monopolizing the budget. It is only pathological as a _substitute_ for ranking.

Dies: the FTS5-first/BM25-2.0-threshold routing. It was never validated end-to-end, one half was measured at zero precision on the query type that matters, and the other half was never provisioned.

**The trap, stated plainly:** if you read ADR-009 and `prompt-builder.ts` and conclude "DraftCrane solved retrieval," you will inherit a design that was never wired and a production path with no ranking at all. Take the budget arithmetic and the assembly order. Solve retrieval yourself.

---

## 5. Prompt design (ADR-007, ADR-010) and anti-fabrication rules

**(a) Problem.** `ADR-010:9`: the Research Board "Ask" tab needs the LLM to "return structured JSON containing verbatim snippets from the author's source materials." The LLM's job is deliberately narrow: "extract relevant passages from provided chunks, preserve source attribution, and return valid JSON."

Architectural choice worth noting first (`ADR-010:21`):

> The backend calls the LLM **non-streaming** with JSON mode, parses the complete response, then streams individual result events to the client via SSE. This is more reliable than streaming JSON token-by-token.

Rejected alternative, with reasoning (`ADR-010:350-352`): incremental JSON parsing "is fragile — partial JSON is hard to parse, and a malformed token mid-stream corrupts everything. The non-streaming approach adds 1-3 seconds to time-to-first-result but guarantees correct parsing."

**(b) Decision.** `ADR-010:39`: "**Use GPT-4o with Strategy B (`response_format: { type: "json_object" }`) as the primary model for Research Board queries.**"

### The full production system prompt

Verbatim from `ADR-010:102-150`, and byte-for-byte identical in shipped code at `workers/dc-api/src/services/research-query.ts:92-138` and `workers/dc-api/src/services/prompt-builder.ts:69-115` (the only difference being that research-query.ts interpolates `${MAX_SNIPPETS}`):

```
You are a research extraction assistant for a nonfiction book writing tool. Your job is to find and extract relevant passages from the author's source materials that answer their research query.

## Your Task

Given a user's research query and a set of source material chunks, you must:

1. Identify which chunks contain information relevant to the query
2. Extract verbatim passages from relevant chunks — NEVER paraphrase or reword
3. Attribute each extracted passage to its source with the exact sourceId and sourceTitle from the chunk metadata
4. Synthesize a brief summary across all extracted passages

## Extraction Rules

- VERBATIM ONLY: Every snippet's `content` field must contain text that appears EXACTLY in the source chunk. Do not rephrase, summarize, or combine text from different chunks into a single snippet.
- One snippet per relevant passage: If a chunk contains multiple relevant passages, extract each as a separate snippet.
- Source attribution must match metadata: The `sourceId` and `sourceTitle` in each snippet must exactly match the values from the source chunk header.
- sourceLocation: Use the heading/section information from the chunk header (e.g., "Chapter 3 > Methodology"). If the chunk header shows "Section N of M", use that.
- relevance: One sentence explaining why this specific passage answers the query.
- summary: 2-4 sentences synthesizing the key findings across all extracted snippets.
- Maximum snippets: Extract at most 8 snippets. Prioritize the most relevant and information-dense passages.

## No Results

If NONE of the provided source chunks contain information relevant to the query:
- Set `noResults` to `true`
- Return an empty `snippets` array
- Set `summary` to a brief explanation that the source materials do not contain relevant information

## Response Format

Respond with a JSON object matching this schema:

{
  "snippets": [
    {
      "content": "Exact verbatim text from the source chunk",
      "sourceId": "source-id-from-metadata",
      "sourceTitle": "Source Title from Metadata",
      "sourceLocation": "Heading Chain from chunk header",
      "relevance": "Why this passage answers the query"
    }
  ],
  "summary": "Brief synthesis across all snippets",
  "noResults": false
}

Respond ONLY with valid JSON. No markdown fences, no explanation, no preamble.
```

User message template (`ADR-010:154-170`), implemented at `research-query.ts:143-159`:

```
## Research Query

{query}

## Source Materials

The following are chunks from the author's source materials. Extract verbatim passages that answer the research query above.

[Source: "{sourceTitle}" (id: {sourceId}), Section: "{headingChain}"]
{chunkText}

---

[Source: "{sourceTitle}" (id: {sourceId}), Section: "{headingChain}"]
{chunkText}
```

API params (`ADR-010:174-184`): `model: "gpt-4o"`, `max_tokens: 4096`, `response_format: {type:"json_object"}`. Shipped code additionally sets `temperature: 0` (`research-query.ts:354`) — not in the ADR.

### The snippet schema

`ADR-010:75-93`:

```ts
interface ResearchQueryResult {
  snippets: Array<{
    /** Verbatim text extracted from source chunk — must be a contiguous substring */
    content: string
    /** Source material ID (from chunk metadata) */
    sourceId: string
    /** Human-readable source name */
    sourceTitle: string
    /** Section/heading location in source */
    sourceLocation: string
    /** Relevance: why this snippet answers the query */
    relevance: string
  }>
  /** Brief synthesis (2-4 sentences) across all snippets */
  summary: string
  /** True if no relevant information found in sources */
  noResults: boolean
}
```

ADR-007's competing schema (`ADR-007:359-373`) is richer — it adds `verbatim: boolean`, `chunkRef: string`, `confidence: 'high'|'medium'|'low'`, `queryUnderstood: boolean`, `noResultsReason: string|null`. **None of those shipped.** The self-reported `verbatim` flag and the `confidence` enum are the interesting losses; the ADR-010 schema has no field for the model to express uncertainty.

### Anti-fabrication rules — the complete enumeration

Five layers, of which four shipped:

1. **Prompt-level, stated three times with escalating emphasis.** "Extract verbatim passages from relevant chunks — NEVER paraphrase or reword" (task step 2); "VERBATIM ONLY: [...] must contain text that appears EXACTLY in the source chunk" (extraction rules); "Do not rephrase, summarize, or combine text from different chunks into a single snippet." The redundancy is deliberate.
2. **Attribution must be copied, not generated.** `sourceId`/`sourceTitle` "must exactly match the values from the source chunk header." The model is never asked to _know_ a source, only to _copy_ an identifier that was placed in its context.
3. **An explicit no-results branch with a dedicated boolean.** `noResults: true` + empty array + an explanatory summary. This is the anti-fabrication mechanism that matters most: the model is given a first-class, structurally-rewarded way to say "not in here." Measured at **100% negative-query handling** across every model and strategy tested (`ADR-010:194`).
4. **Backend post-validation as a safety net** (`ADR-010:299-306`) — for each returned snippet, find its source chunk and assert `sourceChunk.text.includes(snippet.content)`; log a warning on failure. `ADR-010:336` specifies the normalization: "whitespace collapse + lowercasing. [...] Minor whitespace differences between chunk text and model output should not count as paraphrasing."
   **This shipped only as a `console.warn` in the ADR's example code, and I found no substring check in the production path at all.** `research-query.ts` parses via `parseSnippetResponse()` and returns; `snippet-parser.ts` validates _types and presence_, never _containment_. The one concrete anti-fabrication check they designed is not running.
5. **Defensive parsing.** `snippet-parser.ts` strips markdown fences, tolerates `snake_case` variants, accepts a bare unwrapped snippet object, caps at `MAX_SNIPPETS = 8` and `MAX_CONTENT_LENGTH = 10_000`, and returns a discriminated `{ok:true,data} | {ok:false,error,partial}` so a partial result can still be surfaced. `parseResearchResponse()` in `prompt-builder.ts:294-319` is a second, simpler implementation of the same thing — duplicated logic.

### The measured findings worth carrying

- **Strict JSON schema mode made extraction quality WORSE.** `ADR-010:57`: "Strict JSON schema (C) paradoxically reduced extraction quality. In the multi-5 failure, the model cherry-picked non-contiguous sentences rather than extracting contiguous passages. The schema constraint appears to encourage shorter, more 'precise' outputs that break the verbatim guarantee." Elaborated at lines 216-220: "The model prioritizes fitting the schema over preserving the extraction rules." Verbatim extraction: 100% under `json_object`, **94% under strict `json_schema`**.
- **The specific failure mode has a name.** `ADR-010:224-226`, "Non-contiguous extraction": "each sentence was individually present in the source but the concatenated block was not a contiguous substring. Dense, repetitive paragraph structures triggered this — the model assembled 'greatest hits' from multiple locations within a chunk." This is a fabrication that passes every naive check — every word is real, the sequence is invented.
- **The small model omitted a boolean it judged semantically unnecessary.** GPT-4o Mini dropped `noResults` when results were present, cascading to 0% on all metrics for those queries (`ADR-010:63`). "This is a common pattern in smaller models: they optimize for 'useful' output rather than strict compliance."
- **Model spread, `ADR-010:188-200`:** GPT-4o + json_object hit 100% on JSON parse, schema compliance, verbatim extraction, attribution accuracy, and negative-query handling, at p50 2.9s / p95 6.6s. Mini failed reliability and latency; cost was $63.72/mo vs $3.82/mo at 200 queries/day, and quality won — "quality is not acceptable for a product where users trust the citations."
- **Workers AI and Anthropic were never evaluated.** Both blocked on missing credentials (`ADR-010:330-334`). ADR-010's conclusion is therefore a two-model comparison presented as a model selection.

**(d) Transfer assessment: TRANSFERS — this is the second most valuable asset.**

The extraction contract generalizes far past book research. Any agent asked to answer from customer-supplied material needs exactly this shape: **copy don't compose; attribute from metadata you were handed; have a structured way to say "not here"; validate containment server-side.** Rules 1-4 port verbatim with `snippet` renamed.

Three findings are the kind you only get by running the experiment, and they are worth more than the prompt text:

- Over-constraining output structure can degrade content fidelity. Anyone reaching for strict schema/tool-calling because it feels safer should read `ADR-010:216-220` first.
- Smaller models silently drop fields they judge semantically unnecessary, and a dropped boolean can zero out an entire response.
- Non-contiguous "greatest hits" assembly is the fabrication mode that survives casual inspection.

Dies: the GPT-4o-specific model choice and cost table (stale, and never compared against Claude). Also dies, or at least should not be inherited: the decision to drop `confidence` and `verbatim` from ADR-007's schema. An agent architecture wants the model's own uncertainty signal, and ADR-007 had designed one.

**Carry forward as unfinished work:** the containment check. It was specified (`ADR-010:299-306`) and not built. In an agent architecture where the same extraction runs unattended, that check is not optional.

---

## 6. Multi-tier model routing (ADR-006)

**(a) Problem.** `ADR-006:9-11`: rewrite latency too high — GPT-4o at 2-5s to first token, made worse by a client that accumulated all tokens before rendering. Workers AI offers same-network inference.

**(b) Decision.** Two tiers: **edge** = `@cf/mistralai/mistral-small-3.1-24b-instruct` via the Workers AI binding, default for initial rewrites; **frontier** = GPT-4o, reached by an explicit user action labelled "Go Deeper." Line 20: "This is a fresh rewrite, not a refinement of the edge result." Controlled by `AI_DEFAULT_TIER`; `tier` column added to `ai_interactions`; both tiers share one 10 req/min limit.

Rationale (lines 26-32): latency, zero marginal cost (Workers AI included in plan), progressive disclosure, no new API key, 128K context, ~217 medium rewrites/day within the free 10K neurons.

**(c) The gate, and the verdict.** ADR-006 gated the flip behind B0 (lines 42-51): 10 scenarios × 5 instruction types × 2 genres, both tiers on identical inputs using **production prompts imported from `ai-rewrite.ts`**, written out as **blind A/B pairs with random label assignment**, human-judged, then a reveal key. Pass criteria: "Edge output is acceptable for all 5 instruction types [...] failures to follow instructions or **hallucination are not**."

`docs/adr/ADR-006-quality-gate-results.md` — edge did not pass. The three conclusions:

> **Case 7 is a real problem.** The model invented grief, a backstory about fleeing the past, and assumed a cat's gender. For a writing tool, hallucinating content into someone's memoir is a trust-breaking failure. Users need to know the tool won't put words in their mouth.

> Edge mean 2,626ms vs Frontier mean 2,077ms. **Frontier is actually faster, which eliminates the usual latency argument for the edge model.** Edge P95 (4,691ms) is notably worse than Frontier P95 (2,883ms).

> **Action:** Keep `AI_DEFAULT_TIER=frontier`. Do not flip to edge until conditions above are met.

Three named conditions for a future PASS: a hallucination guardrail detecting semantic content not present in the original; **route by task type** (edge viable for simplify/concision/clarity; tone-shift and expand on creative content must go frontier); and latency parity, since "Cost savings need to justify the quality risk on their own since there is no speed advantage."

Where edge actually won (documented, not dismissed): simplification tasks — "natural, faithful, doesn't editorialize"; conversational tone shift — "the keys analogy in Case 8 is genuinely good writing"; and a technical expansion where edge produced a concrete example against frontier's "generic restatement."

Confirmed live: `workers/dc-api/wrangler.toml:47` → `AI_DEFAULT_TIER = "frontier"`.

Elsewhere in the codebase the routing is effectively hard-coded rather than tiered: research queries always call GPT-4o directly by `fetch` (`research-query.ts:345-361`), bypassing `AIProvider` entirely; deep analysis reads `AI_DEFAULT_TIER` and picks a provider once per job (`deep-analysis.ts:204-209`).

**(d) Transfer assessment: THE DECISION DIES. THE METHOD AND THE VERDICT TRANSFER — as a warning.**

The tier taxonomy is obsolete (specific 2026-02 Workers AI models, GPT-4o pricing). But three things carry, and they are worth more than the decision would have been:

1. **The gate design is a reusable artifact.** Blind A/B with randomized labels, a sealed reveal key, both arms run on _production_ prompts imported from the shipped module, and explicit pass criteria written _before_ the run. That is a template — and the outcome proves it works, because it caught a failure the authoring ADR did not anticipate.
2. **The cheap tier was slower, not faster.** The entire premise was latency and the measurement inverted it. Any "cheap model for the easy cases" plan should be required to _measure_ the latency claim before the architecture depends on it.
3. **Route by task type, not by a global default.** This is the surviving design idea (`quality-gate-results`, Conditions for PASS #2): the small model was fine at mechanical transformation and dangerous at creative/emotional transformation. That maps directly onto an agent architecture where some acts are mechanical and some are voiced.

And the failure mode is precisely the one ss-console already treats as P0: a model inventing plausible content in a user-facing artifact. DraftCrane found it in a 10-case sample. This is corroborating evidence for keeping high-fabrication-risk output classes pinned to the strongest model.

---

## 7. Editor choice (ADR-001)

**(a) Problem.** `ADR-001:10`: PRD Risk 3, High Likelihood / Critical Impact — "Editor fails on iPad Safari. Rich text editing in mobile Safari is fragile." Constraints: iPad Safari primary, <100ms input latency, virtual keyboard consuming 40-50% of screen, Google Docs paste must preserve formatting, ~200KB lazy-loaded bundle acceptable.

**(b) Decision.** Line 28: "**Use Tiptap (ProseMirror-based).**"

**Alternatives and the deciding criteria.** Three candidates (lines 22-24): Tiptap (~150KB, best iPad Safari track record), Lexical (Meta, ~30KB, less iPad battle-tested), Plate (Slate-based, known iOS issues).

The deciding criterion was **a single named, still-open upstream bug per alternative** — not a feature matrix:

- Lexical: GitHub #5683, input latency on Safari persisting after standard fixes; plus zoom-level rendering bugs; iOS native version "pre-release with no guarantee of support" (lines 34-37).
- Slate/Plate: GitHub #5711 — "holding backspace on iOS Safari breaks editor entirely"; FAQ states iOS is "not regularly tested" (lines 39-42).
- Bundle size was explicitly subordinated: "Lexical saves ~30-50KB gzipped, but reliability on the primary platform outweighs bundle savings" (line 43).

**(c) What the spike learned.** ADR-001 is unusual: it contains both an **8-point iPad Safari test protocol** (lines 127-140) and, a year later, a **2026 landscape re-review** (lines 142-184).

The protocol, run on a physical iPad Air 5th gen+ / iPadOS 17+ before shipping, scored 1-5 with an explicit bar — "no item below 3, average >= 4":

1. Type 500 words without cursor jumping
2. Apply/remove all formatting
3. Undo/redo 10+ operations
4. Paste from Google Docs, verify formatting preserved
5. Virtual keyboard: cursor stays visible when typing at bottom
6. Portrait → landscape → portrait: no content loss
7. Background tab for 30s, return: no state corruption
8. Input latency feels instant (<100ms)

Two concrete mitigations came out of it (lines 63-66): virtual-keyboard toolbar positioning solved with the `visualViewport` API plus `interactive-widget=resizes-content` in the viewport meta (working code at lines 98-110); and Google Docs paste, which "wraps content in `<b id="docs-internal-guid-...">` with inline styles," requiring a custom handler that transforms to semantic marks.

The 2026 re-review is the more valuable half. Re-checked one year on: **"Safari issue #5683: STILL OPEN."** and **"iOS backspace bug #5711: STILL OPEN."** — "The original disqualifying issues in both alternatives remain unfixed a year later." It also notes the ecosystem consolidating — BlockNote and Novel are both built _on_ Tiptap — and flags a platform-level confound: "iPadOS 26 Safari has reported platform-level bugs [...] These affect all editors equally and are not a reason to switch."

**(d) Transfer assessment: THE DECISION MOSTLY DIES. THE METHOD TRANSFERS.**

If the new architecture composes UI from authored view classes and the user works primarily in natural language, a 150KB rich-text editing kernel may not be in the build at all — and if it is, it is one view class among several, not the product. ADR-001's Principle 1 counterpart in the charter ("Writing Comes First. The editor is the product," `charter.md:11`) is exactly the premise an agent-composed architecture abandons.

What transfers:

- **Decide on a named open upstream bug, not a feature comparison.** "GitHub #5711, still open 15 months later" is a falsifiable, re-checkable criterion. Feature tables are not.
- **The re-review as a practice.** An ADR that gets revisited and either reaffirmed or reversed, with the evidence re-checked, is the thing most ADRs never do. This one names the date and the version numbers.
- **A numbered device test protocol with a scoring bar.** Portable to any "does this actually work on the surface the customer uses" question.

Residually useful if any rich-text surface survives: the `visualViewport` keyboard pattern and the `docs-internal-guid` paste-normalization problem are real and will recur.

---

## 8. Export (ADR-004): deterministic PDF and EPUB

**(a) Problem.** `ADR-004:9-31`. Phase 0 needs full-book and single-chapter PDF + EPUB. The competitive frame is named: "Atticus and Vellum produce professional book files. DraftCrane does not need to match their template variety, but the output must cross the 'this is a real book' threshold." Workers constraints: no filesystem, no headless browser natively, 128 MB, 30s CPU. Budgets: PDF (10 chapters) < 30s, EPUB < 10s.

**(b) Decision.** Line 106: "**Option A: Cloudflare Browser Rendering (REST API) for PDF + custom in-Worker EPUB generation using JSZip.**"

Four options were costed (lines 36-102). Client-side was disqualified on quality — jsPDF hits "HTML5 canvas max height limit causes blank PDFs for long content" and `window.print()` output on iPad "is not configurable." A dedicated microservice was rejected as "Overengineered for current scale (5-10 test users)." DocRaptor/Prince is better rendering but 320× the per-document cost — and is kept as the **named fallback**, made cheap by an interface seam: "the `ExportService` calls a `PdfGenerator` interface, not Cloudflare APIs directly" (line 120).

Priority question resolved (lines 135-149): "**PDF is the priority. Both ship, but if one must be deferred, defer EPUB.**" The reasoning is a user-behaviour argument, not a technical one — "Nobody sends an EPUB to a colleague" — and it explicitly overrules the PM's earlier fallback: "The PM's original fallback ('EPUB-only if PDF fails') misidentifies the user need. A user who exports EPUB-only will not share it with their editor."

**(c) How determinism is actually achieved.** This is the part that transfers, and it is simpler than the ADR's length suggests.

**One HTML+CSS template drives both formats** (`ADR-004:188-196`). Chapter HTML comes out of Tiptap already clean; the template adds title page, ToC, chapter H1s, and page breaks. Shipped at `workers/dc-api/src/services/book-template.ts`: `PRINT_CSS` (lines 29-179), `assembleBookHtml()` (line 196), `assembleChapterHtml()` (line 250). All interpolated text passes through `escapeHtml()` (line 184).

Determinism comes from pushing every layout decision into declarative CSS rather than imperative layout code — `book-template.ts:30-33` and `108-126`:

```css
@page {
  size: 5.5in 8.5in;
  margin: 0.875in 0.75in 1in 0.75in;
}
@page :first {
  margin-top: 2.5in;
}
h1.chapter-title {
  page-break-before: always;
  page-break-after: avoid;
}
h1.chapter-title:first-of-type {
  page-break-before: avoid;
}
.chapter-content p {
  text-indent: 0.25in;
  margin: 0;
  orphans: 3;
  widows: 3;
}
```

PDF rendering is one stateless POST — `workers/dc-api/src/services/pdf-generator.ts:35-88` — with `preferCSSPageSize: true` (so the `@page` rule governs, not the API's page size), explicit margins, `printBackground: false`, `gotoOptions: {waitUntil:'load'}`, and page numbers injected via `footerTemplate` with `<span class="pageNumber">`. The ADR explains why the footer template rather than CSS margin boxes (line 54): Chromium has "No CSS `page-margin-box` support for running headers/chapter titles per page."

**EPUB is fully deterministic** because no rendering engine is involved — it is data assembly. `workers/dc-api/src/services/epub-generator.ts:249-292` writes, in fixed order: `mimetype` (**uncompressed, `compression: 'STORE'`, first entry — an EPUB spec requirement**, line 261), `META-INF/container.xml`, `OEBPS/content.opf`, `OEBPS/toc.xhtml`, `OEBPS/title.xhtml`, `OEBPS/chapter-{N}.xhtml`, `OEBPS/style.css`. Chapters are sorted by `sortOrder` before anything is written (line 253). Every metadata string passes `escapeXml()` (line 116). Fixed DEFLATE level 6.

One genuine non-determinism in EPUB: `const bookId = urn:draftcrane:${Date.now()}` (line 256) plus a `dcterms:modified` timestamp (line 186) — the same manuscript produces a byte-different EPUB on each run. Fine for the product, disqualifying if you ever want content-hash-based caching of export artifacts.

Orchestration (`workers/dc-api/src/services/export-job.ts`): create `export_jobs` row as `processing` → fetch chapter content from R2 **sequentially** (memory safety, `ADR-004:249-253`) → assemble → branch by format → store to R2 at `exports/{job_id}.{format}` → mark completed with `r2_key`, or failed with `error_message` → return a signed R2 URL with 1-hour expiry.

Acceptance criteria for PDF quality are enumerated and checkable (`ADR-004:284-292`), and the not-doing list is explicit (lines 298-305): no custom templates, no cover images, no running chapter-title headers ("Phase 3, requires Prince/DocRaptor"), no images, no offline export.

**(d) Transfer assessment: SURVIVES WITH MODIFICATION — and the seam is the asset.**

The Browser Rendering dependency is Cloudflare-specific and was still "Proposed" when it shipped, on a product ADR-004 itself flags as unproven at scale (line 269). But four things transfer cleanly:

1. **One authored template, two renderers.** A single HTML+CSS artifact is the source of truth; PDF and EPUB are both projections of it. For an architecture where UI is composed from authored view classes, this is the same idea applied to output artifacts — author once, project into surfaces.
2. **The `PdfGenerator` interface seam with a pre-named fallback.** The expensive-but-better vendor was identified, priced, and left behind a one-implementation swap. That is how you take a bet on an immature platform without betting the pipeline.
3. **Determinism by declarative layout.** Every pagination decision lives in `@page` / `page-break-*` / `orphans` / `widows` rules, not in code. The renderer is stateless and takes the whole document in one call.
4. **EPUB-by-assembly beats EPUB-by-library.** ~200-300 lines of JSZip, "fully under our control, zero dependency risk," instead of pulling in `epub-gen-memory` with `htmlparser2` and image-download logic they did not need (`ADR-004:128-133`). Correct call for a spec-defined container format.

Also worth carrying: the priority argument itself. PDF over EPUB was decided by asking what the user would _do with the file_, and that overrode both the engineering-difficulty ordering and the PM's stated fallback.

---

## 9. AI instructions (per-project style) — and an important correction to the question

The task asked for "the data model for per-project authoring instructions, and how it reaches a prompt." **They are not per-project.** They are **per-user**, and they never reach a server-side prompt as instructions — they are a saved-prompt library whose text the client pastes into the ordinary instruction field.

**Data model.** `workers/dc-api/migrations/0020_create_ai_instructions.sql`:

```sql
CREATE TABLE ai_instructions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  instruction_text TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('analysis', 'rewrite')),
  created_at TEXT NOT NULL DEFAULT (...),
  updated_at TEXT NOT NULL DEFAULT (...),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_instructions_user_id_type ON ai_instructions(user_id, type);
```

0020 also **seeds four defaults for every existing user** via `INSERT ... SELECT ... FROM users` — two `rewrite`, two `analysis`.

`migrations/0027_standardize_instruction_types.sql` rewrites the taxonomy from _what the AI does_ to _where the user is standing_: `analysis → desk`, `rewrite → chapter`, and adds a third value `book` with no migration source (new surface). It also adds `last_used_at` and an index `(user_id, last_used_at DESC)` for a recents list. Because SQLite cannot alter a CHECK constraint, it uses the create-new / copy / drop / rename / recreate-indexes dance.

There is **no `project_id` column** in either migration.

**Service.** `workers/dc-api/src/services/ai-instructions.ts`. Plain CRUD, all queries scoped `WHERE user_id = ?`. Limits: label ≤ 100 chars, instruction ≤ 2000 chars (lines 63-65). `touchLastUsed()` (line 309) records usage. `seedDefaultInstructions()` (line 328) is idempotent — "skips if user already has any instructions" — and seeds **13** defaults batched in one `db.batch()`: 5 chapter, 4 desk, 4 book (lines 71-157).

The seeded set is worth reading as authored content — these are the product's opinion about what an editor does, spelled out at prompt-length rather than as chip labels. Example, `ai-instructions.ts:78-81`:

> **Simpler language** — "Rewrite using simpler, more accessible vocabulary. Prefer common words over jargon. Aim for an 8th-grade reading level while preserving the core meaning and technical accuracy."

Note the type-scoped verbs: `chapter` instructions transform prose; `desk` instructions analyze source documents ("Summarize," "Find key points," "Extract quotes," "Suggest connections"); `book` instructions operate across chapters ("Find redundancies," "Find contradictions," "Find recurring topics," "Suggest connections"). **The same surface metaphor, three scopes.**

**How it reaches a prompt.** Client-side string substitution, nothing more. Verified by grep across `web/src`:

- `web/src/components/editor/chapter-editor-panel.tsx:188` — `onSelect={(inst) => handleChipSelect(inst.instructionText)}`
- `web/src/components/sources/desk-tab.tsx:247` — `setInstruction(inst.instructionText)`
- `web/src/components/editor/book-editor-panel.tsx:76-78` — sets instruction then calls `onAnalyze(instructionText)`

The selected row's `instruction_text` is dropped into the same freeform instruction field the user could have typed by hand, and travels as `RewriteInput.instruction`. Server-side, `buildSystemPrompt()` (`ai-rewrite.ts:49-72`) never reads the instructions table. It composes a fixed system prompt plus, at most, `projectDescription` and `chapterTitle`.

**So what _is_ the per-project style context?** It is essentially nothing, and this was a known, deliberate gap. `prd.md:124`: "Phase 0 AI has no knowledge of the author's voice beyond selected text plus 500 characters of surrounding context, chapter title, and project description." The intended answer — the **Book Blueprint**, "a structured document defining the author's voice rules, terminology, key claims, and target reader. Used by AI to maintain consistency" (`prd.md:886`) — is Phase 1 and was never built. `prd.md:860` calls it the point "where differentiation truly begins."

The nearest thing that shipped is `buildSystemPrompt`'s anti-drift rules (`ai-rewrite.ts:49-61`):

```
You are a professional writing assistant helping an author rewrite selected text from their book.
Rewrite ONLY the selected text according to the author's instruction.
Maintain the original meaning and tone unless the instruction specifically asks to change it.
Return ONLY the rewritten text with no preamble, explanation, or quotes.
Match the original formatting style (paragraphs, line breaks).

STRICT RULES:
- Do NOT add new sentences, ideas, or content beyond what is in the selected text.
- Surrounding context is for reference ONLY. NEVER include it in your response.
- NEVER include labels, tags, or prompt formatting in your response.
```

Paired with an XML-delimited user message (`ai-rewrite.ts:78-101`) that fences `<context-before>` / `<selected-text>` / `<context-after>` / `<instruction>` and closes with "Rewrite ONLY the text inside `<selected-text>`."

**(d) Transfer assessment: PARTIALLY TRANSFERS — and the gap is the more useful finding.**

Transfers: (1) **A user-owned library of named, editable instructions, typed by the surface they apply to.** Users get vocabulary they did not have to invent, can edit any of it, and the `last_used_at` recents index makes the list self-organizing. For an agent-composed UI this is directly the "authored, reusable acts" primitive. (2) **Seeding defaults idempotently on first use** so the surface is never empty. (3) **The three-scope pattern** (chapter / desk / book = unit / sources / whole) — a clean generalization of "the same act at different altitudes."

Does not transfer as-is: user-scoping. In a per-customer agent architecture the natural scope is the engagement, and the CHECK-constraint migration in 0027 shows how expensive it is to change a taxonomy later in SQLite.

**The gap is the lesson.** DraftCrane shipped instruction _selection_ and never shipped instruction _context_. The result — noted in the PRD's own risk register as Risk 6, "AI quality poor without Book Blueprint [...] No voice context. Output feels generic" (`prd.md:745`) — is that the AI could be told _what to do_ but never _whose voice to do it in_. The design brief's target user names the consequence in the language of the metaphor: an Editor with no memory of the book "would feel dramatically more like a collaborator" if it had even "a small awareness" of the rest of the manuscript (`brief.md:109`). That is a direct argument for putting authored voice/context configuration in the substrate from day one rather than treating it as a later phase — which is what ss-console already does with output classes.

Also worth carrying: `ai-rewrite.ts`'s XML fencing plus "surrounding context is for reference ONLY, NEVER include it" is a compact, working solution to the general problem of **giving a model context it must read but must not emit.**

---

## 10. Other hard-won answers worth keeping

**A. Deep Analysis: map-reduce over a corpus that exceeds context, as a first-class async job.**
`docs/design/library-desk-spec.md:82-112` designs it, `workers/dc-api/src/services/deep-analysis.ts` ships it. Route by an _estimate_ computed from D1 `word_count` metadata with **no R2 reads** (`deep-analysis.ts:76-108`) — cheap enough to run on every request; over `DEEP_ANALYSIS_TOKEN_THRESHOLD` (default 40K) it creates a job and returns a `jobId`, processing via `waitUntil()`. Greedy bin-packing into ~80K-token batches (line 319), max 3 concurrent (line 26), 3 retries per batch with linear backoff (line 363), progress written to D1 after each group so the client can poll `completed_batches / total_batches`, then a reduce pass at `maxTokens: 8192`. Expired jobs are lazily deleted on read (lines 280, 300).

Two details worth stealing: **`hasUnknown` forces the async path** — a source with `word_count = 0` means "we cannot estimate," and the system treats unknown as large rather than small (`deep-analysis.ts:118`). That is fail-safe routing. And the design doc frames the whole thing as an imitation of human method (`library-desk-spec.md:100-101`): "This mirrors how humans actually do research synthesis — read a stack, take notes, read another stack, take notes, then synthesize notes into structure." It also calls it "a natural premium feature. It does real work over real time, and the perceived value is clear."

**B. Provenance survives the death of its source.**
`design-spec.md:1193-1199` and migration 0016. `research_clips.source_id` is `ON DELETE SET NULL`, and `source_title` is stored **redundantly on the clip** so a saved passage still displays its origin after the source is removed. Principle 4 (`design-spec.md:73-77`): "Every clip permanently records its source document title and location. [...] Even if the source is later removed from the project, the clip retains its text and source title." Same treatment for `chapter_id`. A dedup unique index on `(project_id, source_id, content)` makes double-saving a no-op returning 200 rather than an error.
This is the correct shape for any agent artifact that cites something: **denormalize the provenance onto the artifact, because the referent will outlive its link.**

**C. AI responses are ephemeral by design.**
`design-spec.md:1220`: "AI responses are NOT stored. They are ephemeral/streamed. Users save what they want as clips." Only query text and metadata land in `research_queries` (`research-query.ts:306-312`, updated with `source_count`, `result_count`, `input_tokens`, `output_tokens`, `latency_ms`, `error_message`). The durable artifact is the one the human chose to keep. This pairs exactly with the metadata-only `ai_interactions` posture in §2 — **across two independent features they made the same call: persist the human's decision, not the model's output.**

**D. Trust messaging placed at the moment of anxiety, always-on.**
Decision 5 (`design-spec.md:1678-1684`). "DraftCrane reads your files to help you search and reference them. Your originals are never changed." — shown in the Source Add Flow **every time, not only on first use**, because "the trust barrier is at the connection point." Costed as "zero-cost to implement with outsized trust impact." The removal dialog carries the same idea: "The original file in Google Drive is not affected. Related clips will keep their text but lose the source link" (`design-spec.md:525`) — the dialog states what survives, not just what is destroyed.

**E. A UX simplification that is really an architecture simplification.**
Decision 2 (`design-spec.md:1654-1660`) removed chapter-source linking entirely: "the action had invisible outcomes, the term 'link' was overloaded and confusing, and neither persona used the feature as intended. Diane would 'tap it, see nothing changed, tap again to unlink, give up.'" The replacement (Decision 3) puts the association on the _artifact the user actually cares about_ — an optional `chapter_id` on the clip — rather than on an abstract relation. **The invisible-outcome test is the reusable diagnostic: if performing an action produces no observable change, users cannot learn it, and it should not exist.**

**F. Sheet stacking → inline view replacement, with a props-count ship criterion.**
`design-spec.md:40` replaced a 4-layer sheet stack with inline replacement in one panel, max depth 2. Principle 1: "No surface ever stacks on top of another." The measurable win: a 133-line props interface and ~50 source-related props collapsed into one context provider, with **"EditorDialogsProps reduced to <= 5 research-related props"** as a literal ship criterion (`design-spec.md:1554`). Turning an architectural smell into a checkable number is the transferable move.

**G. Vocabulary as a settled, enforced contract.**
`brief.md:42-55` fixes eight terms (Source, Folder, Document, Library, Desk, Editor, Chapter, Book) and closes the topic: "These terms are embedded in the product architecture, the Design Charter's spatial model, and the codebase. They are not up for revision." `library-desk-spec.md:126` adds a negative list: "Never say 'research', 'reference materials', 'files', or 'items' as synonyms for documents." `charter.md:319-325` maps use/don't-use pairs. `voice-tone-help.md` adds length ceilings per surface (tooltip ≤ 15 words, toast 3-6 words, error = 1 sentence + 1 action), bans em dashes, bans "I" ("DraftCrane is not a person"), and bans "Oops!"/"Uh oh!" as "infantilizing for the target audience."
For an architecture where an agent generates UI text at request time, **a settled lexicon plus a banned-word list plus per-surface length ceilings is the enforceable half of a style guide** — it is checkable by a linter, which is exactly how ss-console enforces `forbidden-strings.test.ts`.

**H. A spatial contract that survives view changes.**
`charter.md:17` Principle 4: "The spatial model is fixed: Editor (left), Writing (center), Library (right). [...] This spatial contract must never break, regardless of view mode." Backed by a two-accent color system where **blue = the Author's domain and violet = the Editor's domain** (`brief.md:126-139`), applied consistently to panels, chips, streaming output, and the accept button. And a hard floor: the center writing area never compresses below 400px — if two panels would breach it, the second renders as an overlay instead (`charter.md:289`).
This is the most directly relevant design idea for request-time UI composition: **fix the spatial and chromatic meaning, let the content vary.** Composition needs invariants or it becomes disorienting; DraftCrane names three (position, color, minimum center) and one is a hard numeric constraint a layout engine can enforce.

**I. Backup/restore as a portability guarantee, with decompression guards.**
`workers/dc-api/src/services/backup.ts`. A ZIP containing `manifest.json` (version 1, project metadata, chapter list) plus `chapters/NN-slug.html`. Import "Always creates a new project — never overwrites existing work" (line 158). Zip-bomb guards are explicit and named (`IMPORT_LIMITS`, lines 20-27): 200 MB total uncompressed, 50 MB per entry, 500 entries max — and crucially every entry is **decompressed and size-checked before any of it is used** (lines 174-193). A versioned manifest is rejected outright if `version !== 1`.

**J. Kill criteria written as falsifiable thresholds, before building.**
`dc-project-instructions.md:46-52`: "No user completes a full chapter in their first session" / "Fewer than 3 of 10 beta users return for a second session" / "After 90 days: No signal of willingness to pay" — followed by "These are real. No heroics, no 'one more feature.'" The PRD attaches a measurement source to each (`prd.md:695-699`), and — the honest part — Unresolved Issue #6 (`prd.md:942-946`) argues the quantitative threshold alone is not enough: "a user who writes 400 words and says 'this is great, I just ran out of time' is a different signal than one who says 'this is frustrating, I went back to Google Docs.'"

**K. The PRD names its own product's weakness in the executive summary.**
`prd.md:17`: "Phase 0 is not a differentiated product. It is a validation vehicle. [...] Phase 0 does not win on features. It wins on learning." And `prd.md:100`: "DraftCrane's primary competitor is not a product. It is the user's existing Google Drive folder full of scattered documents." Risk 1 is that the product feels like "Google Docs + ChatGPT" (`prd.md:735`). Risk 2 is sharper — that the prototype tests the wrong hypothesis entirely, because both personas' actual problem is organizing 200 pages of existing material and Phase 0 hands them a blank chapter (`prd.md:736`, elaborated `prd.md:40-48`). The mitigation is a rule for interpreting results, not a feature: "If fresh-start users succeed but existing-content users fail, treat as a **product gap signal, not a kill signal**."
This is the shelving explained in advance, in the PRD, by the authors.

---

## 11. Consolidated transfer table

| #   | Asset                                                                                 | Verdict                                                    | Primary citation                                                 |
| --- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Canonical/cache/metadata tier split + "Drive wins" invariant                          | Transfers (invariant verbatim)                             | `ADR-005:32,80-89`                                               |
| 2   | Optimistic `version` → 409, no merge                                                  | Survives with modification — insufficient for multi-writer | `content.ts:77-84`; `prd.md:774`                                 |
| 3   | Offline                                                                               | N/A — never supported, deliberately                        | `prd.md:168,440,845`                                             |
| 4   | Author/Editor metaphor as architecture; never a chatbot, never a character            | **Transfers**                                              | `brief.md:27-40`                                                 |
| 5   | Propose → accept/reject/retry loop with pre-created durable row                       | **Transfers**                                              | `ai-rewrite.ts:161-198`; `ai-interaction.ts:53-105`              |
| 6   | `ai_interactions` metadata-only schema, tri-state `accepted`, `parent_interaction_id` | **Transfers**                                              | `prd.md:486`; migrations 0005/0007/0008                          |
| 7   | `unpdf` / `mammoth.js` selection                                                      | Survives with modification — re-verify                     | `ADR-008:34`                                                     |
| 8   | Threshold-first evaluation tables + census-derived sanitizer allowlist                | **Transfers (method)**                                     | `ADR-008-spike-results.md:144-219`                               |
| 9   | 300/400/50-word chunks, 2-sentence overlap, never split mid-sentence                  | Transfers (retune for tokenizer)                           | `ADR-009:51-60`; `chunking.ts:55-60`                             |
| 10  | Structured vs flat chunking modes; `headingChain` provenance in-chunk                 | **Transfers**                                              | `ADR-009:62-89`; `chunking.ts:27-46`                             |
| 11  | `content_hash` + `indexed_at` chunk invalidation                                      | Transfers                                                  | `ADR-009:216-248`                                                |
| 12  | FTS5-first / Vectorize-fallback hybrid retrieval                                      | **DIES — never built, never validated**                    | `ADR-009:25`; no `source_chunks` migration; no Vectorize binding |
| 13  | Token budget: 1.33 words→tokens, 8192 budget, 8 chunks, header counted                | **Transfers**                                              | `context-window.ts:29-72`                                        |
| 14  | dedupe → relevance-select → re-sort to document order → format                        | **Transfers**                                              | `prompt-builder.ts:178-205`                                      |
| 15  | `prompt-builder.ts` / `context-window.ts` as a working system                         | **DEAD CODE — test-only importers**                        | grep: only `test/prompt-builder.test.ts`                         |
| 16  | Production retrieval = round-robin first-N-chunks, zero ranking                       | **TRAP — do not inherit**                                  | `research-query.ts:169-202, 337`                                 |
| 17  | Research system prompt + verbatim/attribution/no-results rules                        | **Transfers**                                              | `ADR-010:102-150` = `research-query.ts:92-138`                   |
| 18  | Strict json_schema degrades extraction fidelity                                       | **Transfers (finding)**                                    | `ADR-010:57,216-220`                                             |
| 19  | Non-contiguous "greatest hits" fabrication mode                                       | **Transfers (finding)**                                    | `ADR-010:224-226`                                                |
| 20  | Small models silently drop fields they deem unnecessary                               | Transfers (finding)                                        | `ADR-010:63,230-232`                                             |
| 21  | Backend substring containment check on snippets                                       | **Specified, NOT shipped — build it**                      | `ADR-010:299-306`; absent from `research-query.ts`               |
| 22  | Non-streaming JSON + server-side SSE re-emission                                      | Transfers                                                  | `ADR-010:21,350-352`; `research-query.ts:450-483`                |
| 23  | Edge/frontier tier split                                                              | **DIES** — gate failed, edge slower                        | `ADR-006-quality-gate-results.md`; `wrangler.toml:47`            |
| 24  | Blind A/B gate with reveal key on production prompts                                  | **Transfers (method)**                                     | `ADR-006:42-51`                                                  |
| 25  | Route by task type, not global default                                                | Transfers (design idea)                                    | `ADR-006-quality-gate-results.md`, Conditions #2                 |
| 26  | Tiptap                                                                                | Mostly dies — premise abandoned                            | `ADR-001:28`                                                     |
| 27  | Decide on named open upstream bugs; re-review a year later                            | **Transfers (method)**                                     | `ADR-001:34-42,142-184`                                          |
| 28  | 8-point device test protocol with scoring bar                                         | Transfers (method)                                         | `ADR-001:127-140`                                                |
| 29  | One HTML+CSS template → PDF and EPUB                                                  | **Transfers**                                              | `ADR-004:188-196`; `book-template.ts`                            |
| 30  | `PdfGenerator` interface seam + named DocRaptor fallback                              | **Transfers**                                              | `ADR-004:120`; `pdf-generator.ts`                                |
| 31  | Determinism via declarative `@page`/`page-break`/`orphans`/`widows`                   | Transfers                                                  | `book-template.ts:30-126`                                        |
| 32  | EPUB by JSZip assembly, not by library                                                | Transfers                                                  | `ADR-004:128-133`; `epub-generator.ts`                           |
| 33  | EPUB `Date.now()` book id → non-reproducible bytes                                    | Caution                                                    | `epub-generator.ts:256,186`                                      |
| 34  | User-scoped named instruction library, typed by surface, seeded, recents-indexed      | Transfers (rescope to engagement)                          | migrations 0020/0027; `ai-instructions.ts`                       |
| 35  | Per-project voice/style context (Book Blueprint)                                      | **NEVER BUILT** — the acknowledged gap                     | `prd.md:124,860,886`; Risk 6 at `prd.md:745`                     |
| 36  | XML-fenced context the model must read but not emit                                   | Transfers                                                  | `ai-rewrite.ts:49-101`                                           |
| 37  | Map-reduce deep analysis; estimate from metadata; unknown ⇒ async                     | **Transfers**                                              | `deep-analysis.ts:76-120,319-347`                                |
| 38  | Denormalized provenance surviving source deletion                                     | **Transfers**                                              | `design-spec.md:1193-1199`                                       |
| 39  | AI output ephemeral; only the human-kept artifact persists                            | **Transfers**                                              | `design-spec.md:1220`                                            |
| 40  | Always-on trust messaging at the anxiety moment                                       | Transfers                                                  | `design-spec.md:1678-1684`                                       |
| 41  | Invisible-outcome test; put association on the artifact                               | **Transfers (diagnostic)**                                 | `design-spec.md:1654-1666`                                       |
| 42  | No stacking; props-count as a ship criterion                                          | Transfers                                                  | `design-spec.md:1554`                                            |
| 43  | Settled lexicon + banned words + per-surface length ceilings                          | **Transfers**                                              | `brief.md:42-55`; `voice-tone-help.md`                           |
| 44  | Fixed spatial + chromatic contract; 400px center floor                                | **Transfers**                                              | `charter.md:17,289`; `brief.md:126-139`                          |
| 45  | Versioned backup manifest + decompression guards                                      | Transfers                                                  | `backup.ts:20-27,158`                                            |
| 46  | Falsifiable kill criteria + qualitative caveat                                        | Transfers (method)                                         | `dc-project-instructions.md:46-52`; `prd.md:942-946`             |

---

## 12. Undocumented / unknown

Stated so nothing here is mistaken for a finding:

- **ADR-002 does not exist.** Referenced only as a planned title in `prd.md:770`.
- **ADR-004 and ADR-007 were never moved past "Proposed."** ADR-004 shipped anyway; ADR-007 was overtaken by ADR-010 without either file recording the relationship.
- **No ADR records the decision to ship round-robin chunk selection instead of ADR-009's hybrid retrieval.** There is no document explaining why the accepted design was not built.
- **`prompt-builder.ts` / `context-window.ts` are undated as to intent.** Whether they are pre-work for a never-landed integration or abandoned after the fact is not recorded anywhere I found.
- **Claude and Workers AI were never evaluated for the snippet-extraction task.** `ADR-010:330-334`, both blocked on missing credentials. ADR-010's model recommendation therefore rests on a GPT-4o vs GPT-4o-Mini comparison only.
- **No ADR or doc records why the project was shelved.** Last substantive commits are CI/security/docs housekeeping (`0cef7f7`, `d7a0200`, `f470370`). No post-mortem, no handoff in `docs/handoffs/`. Kill criteria were written (`prd.md:695-699`) but no evaluation against them is recorded.
- **Whether the 8-point iPad protocol was ever executed is not recorded.** ADR-001 specifies it and the 2026 re-review says "No regressions reported," but no scored results document exists in the repo.
- **`docs/design/source-review/design-spec.md` still self-describes as "Authoritative"** while its tab names were superseded five days later by `library-desk-spec.md:137`. Which document governs is not stated.
