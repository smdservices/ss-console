# Preserved sources from `dc-console`

Copied verbatim on **2026-07-31** from `venturecrane/dc-console` at commit `0cef7f7`.

Draft Crane moved from the `dc` venture into `ss` under [ADR 0084](../../../adr/0084-agent-native-applications-surfaces-on-a-shared-seat.md). `dc-console` will be archived and is not written to again. These are the primary sources the Draft Crane design work depends on, kept here so they survive that transition and stay readable next to the work that cites them.

`dc-console` is a public repository, so archiving makes it read-only rather than unavailable. These copies are for convenience and durability, not rescue.

| File                                      | What it is                                 | Why it was kept                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prd.md`                                  | The DraftCrane PRD, v2.0, dated 2026-02-06 | The personas (Diane Mercer, Marcus Chen) and the problem statement — "I have 200 pages of raw material and zero finished chapters." The most load-bearing source in the set. |
| `design-brief.md`                         | Author/Editor design brief, 2026-02-24     | The trust model: the assistant proposes, the author disposes. Also the settled vocabulary.                                                                                   |
| `ADR-001-editor-library.md`               | Editor choice                              | Tiptap, ProseMirror-based. The author writes in our app.                                                                                                                     |
| `ADR-004-pdf-epub-generation.md`          | Export                                     | Cloudflare Browser Rendering for PDF, in-Worker JSZip for EPUB.                                                                                                              |
| `ADR-005-content-storage-architecture.md` | Storage and consistency                    | Drive canonical, R2 write-through cache, D1 metadata, instant local saves. Answers "who owns the content."                                                                   |
| `ADR-009-content-chunking.md`             | Chunking                                   | Parameters with measured justification, and the two-mode structured/flat split. **Its retrieval design was never wired** — see the harvest for what actually runs.           |
| `ADR-010-snippet-prompt-engineering.md`   | Prompt design                              | Verbatim extraction with mandatory source attribution.                                                                                                                       |

**One warning, repeated here because it is easy to miss.** ADR-009 specifies a hybrid retrieval design that was never built. `prompt-builder.ts` and `context-window.ts` in `dc-console` are dead code imported only by their own tests; the path that actually ran took the first few chunks of each document in document order with no ranking. Read `../dc-solved-problem-harvest.md` §4 before treating anything in ADR-009's retrieval section as a working answer.
