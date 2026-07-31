# Draft Crane — Product Shape

_Design document, 2026-07-31. Consolidates a design conversation between the Captain and Claude.
Not a plan and not a build: it records what the product is, so the shape does not have to be
re-derived. Sources cited throughout._

**Status.** Draft Crane is an SMD Services product under
[ADR 0084](../../adr/0084-agent-native-applications-surfaces-on-a-shared-seat.md) — the first
**surface** on the shared per-customer seat, under the Hosted Agent posture. It keeps its name.
It was previously a `dc` venture product; `dc-console` is not written to again and its primary
sources are preserved at `docs/research/draft-crane/from-dc-console/`.

---

## The idea

Build Draft Crane as an application whose engine is a hosted agent rather than a conventional
web backend.

The author writes in a real editor, in our app. Everything she would otherwise have to go
find, compare, count, or check — across her own research and her own manuscript — she asks
for in plain language, and the answer appears beside her work.

The difference from a conventional app is not that it has a chat box. It is that the app does
not have to anticipate her questions in order to answer them. A conventional app can only
answer what someone designed a screen for. This one answers what she asks.

---

## How she uses it

**Getting started.** She points it at her Google Drive folders. It reads everything — the
workshop decks, the client debriefs, the frameworks, all 200 pages — and comes back with what
it found: the themes that recur, the arguments she makes more than once, the stories she has
told three times.

She does not start at a blank page. She starts at a map of what she already has. This is the
thing her current workflow cannot give her, and it is the reason to build.

She says roughly what the chapters are. It builds the outline and attaches the relevant source
material to each chapter.

**Day to day.** She opens a chapter and writes. The editor is fast and local. Typing never
waits on anything.

When she wants something, she asks for it:

- _"What did I say about delegation in my workshop notes?"_ — the passages, word for word,
  each showing which document it came from.
- Highlights a phrase. _"Have I used this already?"_ — every place it appears, with links.
- _"Draft an opening from these notes."_ — a draft appears beside her text, never inside it.
  She takes it, edits it, or throws it away.
- _"Does this chapter sound like chapter one?"_ — an answer, pointing at the specific places
  it drifts.
- _"Do I have anything in the Drive that touches on succession planning?"_ — she can ask about
  anything, not just what is on screen.

**Over time.** Things she asks for repeatedly become buttons. The app asks first — _"you have
wanted this four times, want it as a button?"_ — and if she says yes it appears in the sidebar
and stays exactly where it was put. After a month her sidebar holds the handful of things she
actually does. Nobody designed that sidebar, and it is different for every author.

---

## The pieces

1. **The library.** Her source material, read and indexed so it can be searched by meaning,
   not just by keyword. Originals stay in her Drive.
2. **The manuscript.** The chapters, in the editor, in our app.
3. **The assistant.** The hosted agent. Has read the library and the manuscript. Remembers her
   preferences, her terminology, and the corrections she has made.
4. **The workbench.** One page in the portal: outline on the left, editor in the middle,
   answers on the right.
5. **The answer panel.** Answers come back in one of a set of consistent layouts — a passage
   list with sources, a comparison, a count, a draft awaiting her approval, a plain document.
   The app holds a vocabulary of ways to display an answer; the assistant picks the fitting
   one and fills it in, and never invents a new look. This is what keeps the workbench looking
   the same every day even though the questions never repeat.

   The vocabulary is expected to grow and change. Layouts can be added, removed, and evolved
   as we learn what she actually asks for. What stays fixed is that the assistant chooses from
   the set rather than inventing outside it.

6. **Saved questions.** A question she asks repeatedly, given a name, that runs instantly.
7. **Her style guide.** What she has told it about her voice and her terms, plus every
   correction she has made. It accumulates. It is hers.

---

## What is already settled

Everything in this section has a source. None of it needs re-deciding.

| Decision                        | What it is                                                                                                                                                                                                                                                                                                                                                                                                                          | Source                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **The editor**                  | Tiptap, ProseMirror-based. A standard web editor, already built. She works in our app.                                                                                                                                                                                                                                                                                                                                              | dc `ADR-001-editor-library.md`                                                 |
| **Content ownership**           | Google Drive is canonical. R2 is a write-through cache for speed. D1 holds metadata. Local storage gives instant saves. If DraftCrane vanished tomorrow she still has her book.                                                                                                                                                                                                                                                     | dc `ADR-005-content-storage-architecture.md`; Project Instructions Principle 3 |
| **The trust model**             | The assistant proposes, she disposes. It never changes her text without approval. Original and proposal shown together; accept, retry, or discard; acceptance is undoable.                                                                                                                                                                                                                                                          | dc `docs/design/brief.md`; PRD §"AI rewrite"                                   |
| **Anti-fabrication**            | Extracted passages are verbatim, never paraphrased, and every one carries its source ID and title. This is enforced in the prompt.                                                                                                                                                                                                                                                                                                  | dc `workers/dc-api/src/services/prompt-builder.ts`; `ADR-010`                  |
| **Who it is for**               | Diane Mercer (leadership consultant, 52, iPad-first) and Marcus Chen (executive coach, 44, 100+ Drive documents, blocked on organization not content). Non-technical. Live in Google Workspace.                                                                                                                                                                                                                                     | dc `docs/pm/prd.md` §3                                                         |
| **The real problem**            | "I have 200 pages of raw material and zero finished chapters." The competitor is her own Drive folder, not another product.                                                                                                                                                                                                                                                                                                         | dc `docs/pm/prd.md` §4                                                         |
| **Export**                      | Cloudflare Browser Rendering for PDF, in-Worker JSZip for EPUB.                                                                                                                                                                                                                                                                                                                                                                     | dc `ADR-004-pdf-epub-generation.md`                                            |
| **Chunking**                    | 300-word target, 400 hard cap, 50 minimum, 2-sentence overlap, always on sentence boundaries. Two modes: structured documents parse at element boundaries and carry their heading chain; flat documents (PDF) use heuristic heading detection. Provenance travels inside the chunk so a citation is reconstructible from the chunk alone. Measured: 885 chunks, none undersized, none oversized, 100% sentence-boundary compliance. | dc `ADR-009-content-chunking.md`; `chunking.ts`                                |
| **The flexible-interface part** | Does not need inventing. Google's A2UI (Dec 2025) and MCP Apps (Jan 2026, an official MCP extension, live in Claude) both standardize the same thing: the agent picks from a catalog the app controls and never emits markup. Adopt one.                                                                                                                                                                                            | `scratchpad/prior-art-generative-ui.md` §1                                     |
| **Sidebar behavior**            | Suggested, never imposed — the app proposes and she confirms. New items append in stable positions and never reorder. Both rules come from replicated results (Findlater & McGrenere CHI 2004; Findlater et al. CHI 2009). It also will not bootstrap itself; it has to be seeded by example.                                                                                                                                       | `scratchpad/prior-art-generative-ui.md` §3                                     |

---

## What would have to be built

**Search over her material.** This is the one real gap, and it is the thing the whole product
rests on. DraftCrane specified it in `ADR-009` and never wired it: `prompt-builder.ts` and
`context-window.ts` are dead code imported only by their own tests, and the path that actually
runs takes the first few chunks of each document in document order with no ranking at all. If
the answer is on page 40 it is never found. Their own spike measured keyword search on
paraphrase queries at zero precision, and the semantic half was blocked on an API token
scope issue. (`scratchpad/harvest-draftcrane.md` §4)

So: nobody has this. It is ordinary design and engineering work, not a research risk, but it
has to be done properly rather than inherited.

**The workbench itself** — the three-panel page in the portal, and the wiring from the browser
to the agent.

**The saved-question mechanism** — a repeated question, named, stored, and re-runnable.

Two useful pieces of DraftCrane's budget arithmetic transfer directly: a chunk is charged for
its own citation header against the token budget, and the assembler reports what it had to
drop, so the assistant can honestly say it only read part of the corpus.

---

## Open work (none of it blocking)

Nothing here prevents the app from being designed or built. Each is scheduled work with a
known method.

1. **Deriving the answer layouts.** The design holds a space for a set of layouts. The set is
   explicitly expected to change — layouts get added, removed, and evolved over the life of
   the product, and the app is built so that is cheap.

   The exercise that populates it, when we get to it: generate the range of questions a
   nonfiction author would actually ask, categorize them, and distill the categories into
   layouts. The outcome informs the design; the absence of it does not block the design.

2. **Anchoring a reference into text that keeps changing.** When an answer says "you used this
   phrase in chapter 3, paragraph 12," and she then rewrites chapter 3, the link must still
   land sensibly. This is a well-known problem with standard solutions. Survey them, pick the
   one that fits, design to it.

3. **Long-running work — a wiring decision, not an unknown.** Short questions return
   synchronously. Long ones ("read everything and propose an outline") become a job that
   reports progress and delivers a result.

   Both halves already exist. DraftCrane built `analysis_jobs`, an async map-reduce pipeline
   carrying `total_batches`/`completed_batches` for progress (dc migration `0025`). The agent
   has a durable job runtime (`job_worker_runtime.py`, `job_worker.py`, `job_segment.py`,
   `job_ledger_client.py`), and `job_status`/`job_cancel` exist in its JSON-RPC engine but are
   not publicly routed — deliberately deferred in ADR 0057.

   On the 55-second figure: it is our own constant, `_MCP_POLL_TIMEOUT_S = 55.0` at overlay
   `webhook_gate.py:604`. Its comment states it was set below typical **MCP client** tool
   timeouts — the Claude custom connector, the only consumer today. A browser is not that
   consumer. And it never truncates work: on expiry the call returns an explicit "still
   working" result while the turn continues on the Machine. It is a polling budget, not a
   ceiling.

   Ordinary latency needs no special handling. People use chat assistants daily and expect a
   pause; a thinking indicator covers it.

---

## Deliberately set aside

- **Pricing.** Premature. There is nothing to sell yet.
- **Anything the app does unprompted.** Scheduled or independent work is available in this
  model and is not currently a feature. If one is proposed, it gets specified then.
- **Whether this generalizes to other applications.** It probably does, and that is a separate
  conversation.

---

## Sources

- [ADR 0084](../../adr/0084-agent-native-applications-surfaces-on-a-shared-seat.md) — the model
  and the decision that Draft Crane is an SS product.
- `docs/research/draft-crane/dc-solved-problem-harvest.md` — what DraftCrane already answered,
  including §4 on the retrieval that was specified and never wired.
- `docs/research/draft-crane/prior-art-generative-ui.md` — A2UI, MCP Apps, and the
  adaptive-interface results that constrain the sidebar behavior.
- `docs/research/draft-crane/hosted-agent-substrate-audit.md` — what a seat can do today, with
  file-level evidence.
- `docs/research/draft-crane/from-dc-console/` — the preserved primary sources.

An adversarial brief and an application-class survey were also produced during this session.
Neither is carried here: the adversary brief was deliberately one-sided and its surviving points
are folded into the decisions above, and the survey drifted off the question.
