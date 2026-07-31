# ADR-010: LLM Prompt Engineering for Structured Snippet Output

## Status

**Accepted** — 2026-02-19

## Context

DraftCrane's Research Board "Ask" tab (`POST /projects/:projectId/research/query`) requires the LLM to return structured JSON containing verbatim snippets from the author's source materials. The system architecture (ADR-009) provides pre-retrieved, pre-attributed chunks via hybrid search (FTS5 + Vectorize). The LLM's job is constrained: extract relevant passages from provided chunks, preserve source attribution, and return valid JSON.

```
User query
    │
    ├──→ Hybrid retrieval (ADR-009) → top-K chunks with metadata
    │
    └──→ LLM (this ADR) → structured JSON snippets
              │
              └──→ Backend parses JSON → emits SSE events to client
```

The backend calls the LLM **non-streaming** with JSON mode, parses the complete response, then streams individual result events to the client via SSE. This is more reliable than streaming JSON token-by-token.

### What Was Tested

This spike empirically evaluated prompt templates and JSON enforcement strategies across multiple models. We ran 24 ground-truth queries (6 keyword, 6 paraphrase, 6 multi-source, 6 negative) from the chunking spike (#136) against:

**Models:** GPT-4o, GPT-4o Mini, Mistral Small 3.1 24B (Workers AI)

**Prompt Strategies:**

- **Strategy A** — Schema-in-system-prompt only (no API-level JSON enforcement)
- **Strategy B** — Same prompt + `response_format: { type: "json_object" }` (valid JSON guaranteed, schema via prompt)
- **Strategy C** — Same prompt + `response_format: { type: "json_schema" }` (valid JSON + schema guaranteed)

**Note:** Claude Sonnet 4.5 was not tested (no API key provisioned). Mistral Small 3.1 returned 401 auth errors (Cloudflare API token lacks Workers AI REST scope; see Known Limitations).

## Decision

**Use GPT-4o with Strategy B (`response_format: { type: "json_object" }`) as the primary model for Research Board queries.**

### Why GPT-4o + Strategy B

GPT-4o with Strategy B was the only combination that passed ALL quality thresholds:

| Metric              | Threshold | GPT-4o B | GPT-4o A | GPT-4o C | Mini C |
| ------------------- | --------- | -------- | -------- | -------- | ------ |
| JSON parse          | 100%      | **100%** | 100%     | 100%     | 100%   |
| Schema compliance   | >95%      | **100%** | 100%     | 100%     | 100%   |
| Verbatim extraction | >80%      | **100%** | 100%     | 94%      | 95%    |
| Source attribution  | >95%      | **100%** | 100%     | 94%      | 95%    |
| Negative queries    | >90%      | **100%** | 100%     | 100%     | 100%   |
| Latency p50         | <5s       | **2.9s** | 3.2s     | 3.3s     | 6.3s   |
| Latency p95         | <10s      | **6.6s** | 9.1s     | 5.8s     | 10.8s  |

Strategy B over Strategy A: Both score 100% on quality, but B guarantees valid JSON at the API level — a structural safety net against edge cases not covered by 24 test queries. The 200ms latency improvement is a bonus (the API can skip output validation when format is pre-constrained).

Strategy B over Strategy C: Strict JSON schema (C) paradoxically reduced extraction quality. In the multi-5 failure, the model cherry-picked non-contiguous sentences rather than extracting contiguous passages. The schema constraint appears to encourage shorter, more "precise" outputs that break the verbatim guarantee. Strategy B's lighter touch (valid JSON only, schema via prompt) gives the model more formatting flexibility while still preventing malformed output.

### Why Not GPT-4o Mini

GPT-4o Mini failed on reliability and latency:

- **JSON/Schema failures (Strategies A/B):** The smaller model omits the `noResults` boolean field when returning positive results, treating it as "semantically unnecessary." This cascades to 0% on all metrics for affected queries (92% and 88% JSON parse rates).
- **Strategy C fixes schema compliance** but at the cost of higher latency (p50=6.3s, p95=10.8s) — both exceed thresholds.
- **Cost savings are real** ($4/mo vs $64/mo at scale) but quality is not acceptable for a product where users trust the citations.

### Why Not Workers AI (Mistral Small 3.1)

The Cloudflare API token lacks Workers AI REST API scope, so all 48 Mistral runs returned 401 auth errors. This is the same token scope issue discovered in spike #136 (Vectorize). Workers AI remains the "edge tier" for AI rewrite (ADR-006) via the `env.AI` binding, but REST API access for evaluation scripts requires a token update.

**Architectural note:** Workers AI evaluation should be done as part of the Research Board implementation (Phase 3 of ADR-009), when the code runs inside the Worker with `env.AI` binding access. REST API evaluation is not necessary for production path.

## Response Schema

```typescript
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

The schema maps directly to the design spec's SSE event format (`docs/design/source-review/design-spec.md:1162-1211`). Each snippet becomes one `event: result` SSE event; `summary` goes in the `event: done` payload.

## Production Prompt Template

### System Prompt

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

### User Message Template

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

### API Parameters

```typescript
{
  model: "gpt-4o",
  max_tokens: 4096,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ],
}
```

## Model Comparison Table

| Metric                  | GPT-4o A | GPT-4o B  | GPT-4o C | Mini A | Mini B | Mini C |
| ----------------------- | -------- | --------- | -------- | ------ | ------ | ------ |
| JSON parse rate         | 100%     | **100%**  | 100%     | 92%    | 88%    | 100%   |
| Schema compliance       | 100%     | **100%**  | 100%     | 92%    | 88%    | 100%   |
| Verbatim extraction     | 100%     | **100%**  | 94%      | 89%    | 83%    | 95%    |
| Attribution accuracy    | 100%     | **100%**  | 94%      | 89%    | 83%    | 95%    |
| Negative query handling | 100%     | **100%**  | 100%     | 100%   | 100%   | 100%   |
| Latency p50             | 3.2s     | **2.9s**  | 3.3s     | 4.8s   | 5.7s   | 6.3s   |
| Latency p95             | 9.1s     | **6.6s**  | 5.8s     | 12.0s  | 11.0s  | 10.8s  |
| Avg snippets            | 3.0      | **3.1**   | 2.7      | 2.8    | 2.7    | 3.7    |
| Avg input tokens        | 3,020    | **3,020** | 3,253    | 3,020  | 3,020  | 3,253  |
| Avg output tokens       | 303      | **307**   | 256      | 306    | 332    | 336    |
| Pass/Fail               | 7/7      | **7/7**   | 6/7      | 3/7    | 2/7    | 5/7    |

## JSON Reliability Analysis

### Strategy A (prompt-only): Reliable for GPT-4o, unreliable for Mini

GPT-4o produced valid, schema-compliant JSON for all 24 queries with no enforcement. This is remarkable instruction-following but not guaranteed — a single edge case in production could break the pipeline. Strategy A is acceptable as a fallback but should not be the primary approach.

GPT-4o Mini omitted the `noResults` field on 2/24 queries, treating it as semantically unnecessary when results were present. This is a common pattern in smaller models: they optimize for "useful" output rather than strict compliance.

### Strategy B (json_object mode): Recommended

API-level guarantee of valid JSON syntax. Schema compliance driven by the prompt. GPT-4o achieves 100% schema compliance via prompt alone; the json_object mode prevents the rare edge case where the model wraps JSON in markdown fences or adds commentary.

GPT-4o Mini still omitted `noResults` — json_object mode guarantees syntax, not schema. 3/24 queries failed (12.5%).

### Strategy C (strict json_schema): Paradoxical quality reduction

With full schema enforcement, both models produce 100% schema-compliant JSON. However, GPT-4o's extraction quality dropped: the strict schema encouraged the model to produce shorter, more "precise" snippets by cherry-picking non-contiguous sentences from chunks. The model extracted individual relevant sentences and assembled them, breaking the verbatim contiguity guarantee.

This suggests that strict schema enforcement constrains the model's output formatting in ways that interfere with the extraction task. The model prioritizes fitting the schema over preserving the extraction rules.

## Failure Pattern Analysis

### GPT-4o Strategy C, multi-5: Non-contiguous extraction

The model extracted 3 snippets where each sentence was individually present in the source but the concatenated block was not a contiguous substring. Dense, repetitive paragraph structures triggered this — the model assembled "greatest hits" from multiple locations within a chunk.

**Mitigation:** The system prompt emphasizes "verbatim" and "EXACTLY in the source chunk." For additional protection, the backend can post-validate that each `snippet.content` appears as a substring in the source chunk text, and flag or filter non-verbatim extractions.

### GPT-4o Mini: Missing noResults field

The smaller model treated `noResults: false` as implicit/unnecessary when returning positive results. Strategy C's schema enforcement fixes this mechanically, but at the cost of latency and extraction quality.

**Mitigation:** If Mini is ever used for cost optimization, enforce Strategy C and accept the latency trade-off.

## Cost Analysis

### Per-query cost (based on evaluation averages)

| Model       | Avg Input Tokens | Avg Output Tokens | Cost/Query | Monthly (200 queries/day) |
| ----------- | ---------------- | ----------------- | ---------- | ------------------------- |
| GPT-4o      | 3,020            | 307               | $0.0106    | $63.72                    |
| GPT-4o Mini | 3,020            | 306               | $0.0006    | $3.82                     |
| Workers AI  | ~3,000           | ~300              | $0.00      | $0.00 (included)          |

### Cost at scale projections

| Scenario                   | GPT-4o     | GPT-4o Mini | Workers AI |
| -------------------------- | ---------- | ----------- | ---------- |
| 10 users × 5 queries/day   | $15.90/mo  | $0.96/mo    | $0/mo      |
| 10 users × 20 queries/day  | $63.72/mo  | $3.82/mo    | $0/mo      |
| 50 users × 20 queries/day  | $318.60/mo | $19.10/mo   | $0/mo      |
| 100 users × 20 queries/day | $637.20/mo | $38.20/mo   | $0/mo      |

### Cost mitigation strategies

1. **Chunk budget management:** Limit top-K to 5-8 chunks (~3K input tokens). More chunks = higher cost but diminishing quality returns.
2. **Cache frequent queries:** KV-based response cache with 15-minute TTL for identical query + source combinations.
3. **Tiered routing:** Simple keyword queries (FTS5 high-confidence results) could use Workers AI or Mini; complex paraphrase queries use GPT-4o. Route by hybrid search confidence.
4. **Phase 0 scale:** At 10 users × 20 queries/day, GPT-4o costs $64/mo — well within Phase 0 budget. Re-evaluate at 50+ users.

## Integration Guidance

### Research Board Query Flow

```typescript
// POST /projects/:projectId/research/query handler

// 1. Retrieve top-K chunks via hybrid search (ADR-009)
const chunks = await hybridSearch(query, projectSourceIds)

// 2. Build prompt from template
const systemPrompt = RESEARCH_SYSTEM_PROMPT
const userMessage = buildUserMessage(query, chunks)

// 3. Call OpenAI non-streaming with json_object mode
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: 'gpt-4o',
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  }),
})

// 4. Parse and validate response
const data = await response.json()
const raw = data.choices[0].message.content
const result: ResearchQueryResult = JSON.parse(raw)

// 5. Post-validate verbatim extraction (optional safety net)
for (const snippet of result.snippets) {
  const sourceChunk = chunks.find((c) => c.sourceId === snippet.sourceId)
  if (sourceChunk && !sourceChunk.text.includes(snippet.content)) {
    // Flag non-verbatim extraction — log but still return to user
    console.warn(`Non-verbatim snippet detected for source ${snippet.sourceId}`)
  }
}

// 6. Stream results to client via SSE
for (const snippet of result.snippets) {
  stream.write(`event: result\ndata: ${JSON.stringify(snippet)}\n\n`)
}
stream.write(
  `event: done\ndata: ${JSON.stringify({
    resultCount: result.snippets.length,
    summary: result.summary,
    processingTimeMs: Date.now() - start,
  })}\n\n`
)
```

### AIProvider Integration

The existing `AIProvider` interface (streaming-only) is not ideal for this use case, which requires non-streaming JSON mode. Options:

1. **Add a `complete()` method to AIProvider** — returns full response instead of stream. Supports `response_format` parameter.
2. **Separate service** — `ResearchQueryService` makes direct API calls without going through AIProvider, similar to how the evaluation script works.

Option 2 is simpler for Phase 0 and avoids changing the established streaming interface. The prompt template and API call pattern are self-contained in the research query handler.

## Known Limitations

1. **Workers AI not evaluated.** REST API auth token scope issue (same as ADR-009). Workers AI Mistral Small 3.1 should be tested via `env.AI` binding during Research Board implementation. If quality is acceptable, it offers a zero-cost option for simpler queries.

2. **Anthropic not evaluated.** No API key provisioned in Infisical. Claude Sonnet 4.5 supports strict JSON via tool_use pattern and may match GPT-4o quality. Should be tested if provider diversification is needed.

3. **Verbatim validation is post-hoc.** The eval checks substring containment after normalization (whitespace collapse + lowercasing). Production should use the same normalization. Minor whitespace differences between chunk text and model output should not count as paraphrasing.

4. **Dense paragraph cherry-picking.** Models may extract non-contiguous sentences from dense paragraphs, especially with strict schema enforcement. The system prompt mitigates this, but backend post-validation provides an additional safety net.

5. **Token count estimates are from evaluation fixtures.** Production queries with more/larger chunks will have higher input token counts. The 4,096 max_tokens output limit is generous; typical responses use 250-340 tokens.

6. **Rate limit on OpenAI Tier 1 accounts.** The evaluation hit 30K TPM limits on GPT-4o. Production usage at scale (100+ users) will need a higher-tier OpenAI account or request queuing.

## Alternatives Considered

### Provider-specific JSON enforcement (Anthropic tool_use)

Anthropic uses a different mechanism for structured output: defining a tool with an input schema and forcing the model to call it. This was implemented in the evaluation harness but not tested. The pattern works well but adds provider-specific branching. If Anthropic is added later, the tool_use pattern is ready in `scripts/snippet-prompt-spike.ts`.

### Streaming JSON parsing

Instead of non-streaming + SSE re-emission, we could stream the JSON token-by-token and incrementally parse. This reduces time-to-first-result but is fragile — partial JSON is hard to parse, and a malformed token mid-stream corrupts everything. The non-streaming approach adds 1-3 seconds to time-to-first-result but guarantees correct parsing.

### Lower max_tokens for cost reduction

Setting max_tokens to 2048 would reduce cost by ~15% (fewer output tokens allocated). However, multi-source queries with 6+ snippets can produce 500+ token responses. The 4096 limit provides headroom without meaningful cost impact (output tokens are billed on actual usage, not allocated maximum).

## References

- [Issue #134](https://github.com/venturecrane/dc-console/issues/134) — Spike: LLM Prompt Engineering
- [Issue #136](https://github.com/venturecrane/dc-console/issues/136) — Spike: Content Chunking Strategy
- [ADR-009: Content Chunking](ADR-009-content-chunking.md) — Hybrid retrieval architecture
- [ADR-003: AI Provider](ADR-003-ai-provider.md) — Provider-agnostic AI interface
- [ADR-006: Multi-Tier AI](ADR-006-multi-tier-ai.md) — Edge + frontier tier architecture
- `docs/design/source-review/design-spec.md:1162-1211` — Research query API contract
- `scripts/snippet-prompt-spike.ts` — Prompt templates and API callers
- `scripts/snippet-eval.ts` — Evaluation runner
- `scripts/fixtures/snippet-spike/eval-results.json` — Raw evaluation data (192 runs)
