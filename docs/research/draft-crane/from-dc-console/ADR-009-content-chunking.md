# ADR-009: Content Chunking Strategy and Context Window Management

## Status

**Accepted** — 2026-02-20

## Context

DraftCrane's AI rewrite currently sends zero source context to the LLM. The prompt contains only: selected text + 500 chars surrounding context + chapter title + project description. Source materials are fully implemented (D1 metadata, R2 HTML storage, chapter-source linking) but never injected into AI prompts.

The Phase 2 "Research Board" feature requires: AI searches sources, returns relevant passages with citations, user collects snippets, drags into editor with auto-footnotes. Before that can be built, we need to determine how to chunk large documents and retrieve the right chunks at query time.

### Constraints

- Both GPT-4o and Mistral Small 3.1 have 128K context windows
- Workers AI embedding model `bge-small-en-v1.5`: 384 dims, 512 max input tokens, BERT WordPiece tokenizer
- Source content is sanitized HTML stored in R2 (`sources/{id}/content.html`)
- PDF sources produce **flat HTML** (all `<p>` tags, no headings) — see ADR-008
- DOCX/MD sources produce **structured HTML** (headings, lists, tables)
- Workers AI binding already configured (`[ai]` in wrangler.toml)
- Cloudflare Vectorize available but not yet provisioned

## Decision

**Adopt Strategy C: Hybrid (FTS5-first + semantic fallback).** Use D1 FTS5 for keyword queries and Cloudflare Vectorize for paraphrase/conceptual queries. Route by BM25 score threshold.

### Why Not FTS5 Alone (Strategy A)

FTS5 keyword precision@3 measured at 44% overall, with **0% precision on paraphrase queries**. The Research Board use case is primarily paraphrase-oriented ("what does my research say about resilience?" rather than "find the exact phrase 'emotional intelligence'"). FTS5 alone cannot serve the product.

FTS5 strengths: excellent latency (74ms p50), zero additional infrastructure, 100% negative query rejection.

### Why Not Vectorize Alone (Strategy B)

Semantic search requires embedding generation on every source upload (2.6s for 60 chunks) and Vectorize infrastructure. For simple keyword lookups that FTS5 handles in 75ms, adding an embedding round-trip is unnecessary overhead.

Additionally, the API token scope issue discovered during the spike means Vectorize provisioning requires explicit setup. FTS5 provides a zero-configuration fallback.

### Why Hybrid (Strategy C)

The routing logic is simple: run FTS5 first. If FTS5 returns zero results or all BM25 scores are below threshold, fall back to Vectorize. Based on spike analysis, 50-67% of queries would route to Vectorize, with the remainder served by FTS5 alone.

This gives the best of both worlds:

- Keyword queries: FTS5 at 75ms
- Paraphrase queries: Vectorize at ~200ms (embed) + ~100ms (search)
- Negative queries: FTS5 rejects at 75ms (no Vectorize cost)

## Chunking Parameters

Based on spike Phase 1 evaluation (885 chunks, 132/132 checks pass):

| Parameter         | Value       | Rationale                                          |
| ----------------- | ----------- | -------------------------------------------------- |
| Target words      | 300         | Conservative for bge-small-en-v1.5 512-token limit |
| Max words         | 400         | Hard cap — zero chunks exceeded this in evaluation |
| Min words         | 50          | Avoids tiny fragments, merges into previous chunk  |
| Overlap           | 2 sentences | ~50 words continuity between adjacent chunks       |
| Sentence boundary | Always      | 100% compliance across all fixture types           |

### Two Chunking Modes

**Mode 1: Structured HTML** (DOCX/MD sources — has `<h1>`-`<h6>`, `<p>`, `<li>`, `<table>`):

- Parse at element boundaries
- Split within long paragraphs at sentence boundaries
- Each chunk carries parent heading hierarchy (e.g., `["Chapter 3", "Methodology"]`)

**Mode 2: Flat HTML** (PDF sources — all `<p>` tags):

- Heuristic heading detection: ALL CAPS lines under 10 words, short lines without terminal periods followed by longer content
- Falls back to positional context: `Section N of M`
- Same sentence-boundary splitting within paragraphs

### Chunk Output Format

```typescript
interface Chunk {
  id: string // sourceId:chunkIndex
  sourceId: string
  sourceTitle: string
  headingChain: string[] // ["Chapter 3", "Methodology"] or ["Section 2 of 8"]
  text: string // Plain text (HTML stripped)
  html: string // HTML fragment
  wordCount: number
  startOffset: number // Character offset in original
  endOffset: number
}
```

## Retrieval Architecture

### D1 Schema Changes

```sql
-- FTS5 virtual table for keyword search
CREATE VIRTUAL TABLE source_chunks_fts USING fts5(
  chunk_id,
  source_id,
  source_title,
  heading_chain,
  content,
  tokenize='porter unicode61'
);

-- Chunk metadata table
CREATE TABLE source_chunks (
  chunk_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  heading_chain TEXT NOT NULL,  -- JSON array
  text_content TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  content_hash TEXT NOT NULL,   -- SHA-256 of source content at indexing time
  indexed_at TEXT NOT NULL,     -- ISO timestamp
  FOREIGN KEY (source_id) REFERENCES source_materials(id)
);

CREATE INDEX idx_chunks_source ON source_chunks(source_id);
```

### Vectorize Index

- **Name:** `dc-source-chunks`
- **Dimensions:** 384
- **Metric:** cosine
- **Metadata fields:** `sourceId`, `sourceTitle`, `headingChain`, `text`

### Embedding Generation

Model: `@cf/baai/bge-small-en-v1.5` via Workers AI binding

| Metric           | Value          |
| ---------------- | -------------- |
| Dimensions       | 384            |
| Optimal batch    | 25 texts/call  |
| Per-text latency | 8ms (batch-25) |
| 5K word source   | ~200ms         |
| 50K word corpus  | ~1.2s          |

Heading chain is prepended to text before embedding for better semantic context:

```
"Chapter 3 > Methodology: The grounded theory approach..."
```

### Query Flow

```
User query
    │
    ├──→ FTS5 MATCH query (D1)
    │         │
    │         ├── Results with BM25 > threshold → Return FTS5 results
    │         │
    │         └── No results or low scores → Fall through
    │
    └──→ Embed query (Workers AI)
              │
              └──→ Vectorize cosine search → Return semantic results
```

BM25 threshold: determined by the absolute BM25 score. If the best-matching chunk scores below 2.0, the match is weak and Vectorize should be consulted. This threshold should be tuned with production data.

### Context Assembly

Given top-K chunks from either strategy:

1. **Deduplicate** overlapping chunks (overlap window produces near-duplicates)
2. **Sort** by source, then by original document order
3. **Format** with source attribution:

   ```
   [Source: "Research Methods Handbook", Section: "Grounded Theory"]
   <chunk text>

   ---

   [Source: "Leadership Fundamentals", Section: "Emotional Intelligence"]
   <chunk text>
   ```

4. **Enforce token budget** — 8K tokens (~6K words) for source context within prompt

### Integration into AI Rewrite

In `ai-rewrite.ts`, the `buildSystemPrompt()` function gains a source context section:

```typescript
export function buildSystemPrompt(input: RewriteInput, sourceContext?: string): string {
  const parts = [
    // ... existing prompt ...
  ]

  if (sourceContext?.trim()) {
    parts.push(
      '',
      'RELEVANT SOURCE MATERIAL (for reference only — do not copy verbatim):',
      sourceContext
    )
  }

  return parts.join('\n')
}
```

The route handler in `ai.ts` retrieves source context before calling `streamRewrite()`:

1. Get chapter's linked source IDs
2. Run hybrid query with the user's instruction as the search query
3. Assemble context from top-K chunks
4. Pass assembled context to `buildSystemPrompt()`

## Chunk Invalidation Strategy

When source content changes (re-upload, Drive sync refresh), stale chunks must be detected and re-indexed.

### Detection

Each chunk row stores:

- `content_hash` — SHA-256 of the source's HTML content at indexing time
- `indexed_at` — timestamp of last indexing

On source content update (`addLocalSource()`, `fetchAndCache()` in Drive sync):

1. Compute new content hash
2. Compare with stored `content_hash` on existing chunks
3. If different: delete old chunks from D1 + FTS5 + Vectorize, re-chunk, re-index

### Trigger Points

- **Local upload:** `SourceLocalService.addLocalSource()` — index immediately after R2 write
- **Drive sync:** `SourceDriveService.fetchAndCache()` — index after content cache refresh
- **Manual re-index:** Admin endpoint for bulk re-indexing (future)

### Stale Chunk Query

```sql
SELECT source_id, content_hash, indexed_at
FROM source_chunks
WHERE source_id = ?
GROUP BY source_id
```

Compare `content_hash` against current source content hash in R2. If mismatched, re-index.

## Cost Analysis

### Workers AI Embeddings

- **Free tier:** 10,000 neurons/day (1 neuron ≈ 1 token)
- **Paid:** $0.011 per 1,000 neurons
- Per embedding call (batch-25, ~300 words each): ~7,500 tokens = 7,500 neurons
- Per 5K word source (~7 chunks): ~2,100 neurons
- Per user with 25 sources: ~52,500 neurons = $0.58

### Vectorize

- **Free tier:** 5M stored vector dimensions, 30M queried dimensions/month
- 384 dims × 675 chunks (200K word corpus) = 259,200 stored dimensions (5.2% of free tier)
- 384 dims × 5 results × 100 queries/month = 192,000 queried dimensions (0.6% of free tier)
- **Cost for Phase 0:** Free tier is sufficient

### D1

- FTS5 adds ~2x storage overhead for the virtual table
- For a 200K word corpus: ~675 chunks × ~1KB each = ~675KB data + ~675KB FTS5 index = ~1.3MB
- Well within D1 free tier (5GB)

## Migration Path

### Phase 1: Chunking + FTS5 (No new infrastructure)

1. Add `source_chunks` table and `source_chunks_fts` virtual table (new migration)
2. Move chunking engine from `scripts/chunking-spike.ts` to `workers/dc-api/src/services/chunking.ts`
3. Hook into `addLocalSource()` and `fetchAndCache()` to index on upload/sync
4. Add FTS5 query endpoint (or internal service method)
5. Wire into `buildSystemPrompt()` for source-aware AI rewrite

### Phase 2: Vectorize (New infrastructure)

1. Provision `dc-source-chunks` Vectorize index (requires API token with Vectorize scope)
2. Add `[[vectorize]]` binding to `wrangler.toml`
3. Add embedding generation to chunking pipeline
4. Implement hybrid query routing
5. Update `buildSystemPrompt()` to use hybrid results

### Phase 3: Research Board

1. Research Board query endpoint uses hybrid retrieval
2. Results rendered with source attribution in UI
3. Snippet collection and citation insertion

## Known Limitations

1. **FTS5 MATCH syntax sensitivity.** Queries containing hyphens, apostrophes, or special characters can cause FTS5 MATCH errors. Requires query sanitization (escape or strip special characters before MATCH).

2. **PDF heading detection is heuristic.** The ALL CAPS / short-line heuristics work well on academic papers but may misfire on other PDF formats (e.g., legal documents with ALL CAPS paragraphs). Positional fallback (`Section N of M`) is always available.

3. **No token-level validation.** The 300-word target is a conservative proxy for the 512-token limit. Actual BERT WordPiece tokenization could be validated by sending sample chunks to `bge-small-en-v1.5` — the spike confirmed 384-dim embeddings generated successfully for all 60 test chunks, implying no truncation at 300-word targets.

4. **Vectorize not yet validated end-to-end.** Embeddings generate correctly (384 dims confirmed), but the Vectorize upsert/query flow requires an API token with Vectorize scope. Code is complete and ready for integration testing once the token is updated.

5. **Overlap deduplication in context assembly.** The 2-sentence overlap between adjacent chunks means retrieved chunks from the same section may contain repeated sentences. The context assembler deduplicates by chunk ID but not by content overlap. This is acceptable for prompt context but should be handled in Research Board snippet display.

6. **FTS5 porter stemmer limitations.** The `porter unicode61` tokenizer handles English well but may under-perform on technical jargon, abbreviations, and non-English terms. This is acceptable for DraftCrane's English-only Phase 0 scope.

## References

- [Issue #136](https://github.com/venturecrane/dc-console/issues/136) — Spike: Content Chunking Strategy
- [ADR-009-spike-results.md](ADR-009-spike-results.md) — Raw benchmark data
- [ADR-008: Document Parsing](ADR-008-document-parsing.md) — PDF flat-text limitation
- [ADR-003: AI Provider](ADR-003-ai-provider.md) — Provider-agnostic AI interface
- [ADR-006: Multi-Tier AI](ADR-006-multi-tier-ai.md) — Edge + frontier tier architecture
- `docs/design/source-review/01-research.md` — Research Board design requirements
- [Cloudflare Vectorize docs](https://developers.cloudflare.com/vectorize/)
- [Workers AI Text Embeddings](https://developers.cloudflare.com/workers-ai/models/text-embeddings/)
- [D1 FTS5 support](https://developers.cloudflare.com/d1/build-with-d1/query-json/#full-text-search)
