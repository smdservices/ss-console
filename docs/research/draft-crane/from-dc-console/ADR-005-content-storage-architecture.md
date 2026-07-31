# ADR-005: Content Storage Architecture

## Status

**Accepted** — 2026-02-16

## Context

DraftCrane stores chapter content across multiple tiers. The core product promise is "Your book. Your files. Your cloud." — the user's Google Drive is the canonical home for their manuscript. DraftCrane must never become the content owner.

The system has four storage tiers available:

1. **IndexedDB** — browser-local, instant, single-device
2. **Cloudflare R2** (`dc-exports`) — object storage, fast, DraftCrane-controlled
3. **Google Drive** — user's account, canonical, requires OAuth connection
4. **Cloudflare D1** (`dc-main`) — relational metadata (projects, chapters, timestamps)

**Key constraints:**

- Non-technical users who don't understand cloud storage mechanics
- iPad Safari is the primary platform (IndexedDB can be evicted by iOS)
- Users may not connect Google Drive immediately (or at all during trial)
- Content loss is the worst possible failure mode
- "Your files are sacred" (Project Instructions, Principle 3)

**The question this ADR answers:** When a user saves chapter content, where does it go? And what happens when Google Drive is not yet connected?

This resolves [Issue #39](https://github.com/venturecrane/dc-console/issues/39) (Unresolved Issue #1 from the PRD).

## Decision

**Google Drive is the canonical store. R2 is a write-through cache. D1 stores metadata only. IndexedDB provides instant local saves.**

### Save Flow

```
User types in editor
       │
       ▼
  IndexedDB          ← Instant (every keystroke, debounced ~300ms)
       │
       ▼ (2s debounce)
  API call
       │
       ├──► R2 cache write         ← Fast, always happens
       │
       ├──► Drive write            ← Canonical, when connected
       │    (async, non-blocking)
       │
       └──► D1 metadata update     ← updated_at, word_count, version
```

### When Google Drive IS Connected

Every save writes to both R2 (fast cache for app reads) and Google Drive (canonical). The app reads from R2 for performance. Drive is the write-through destination that the user owns.

### When Google Drive Is NOT Connected

R2 holds content temporarily. A persistent, non-dismissible banner in the editor tells the user: "Your work is saved, but not to your Google Drive. Connect Drive to keep your book safe."

When the user later connects Drive:

1. All R2-held content migrates to Drive
2. R2 retains copies as cache (not deleted)
3. Banner disappears

### Read Path

```
App needs chapter content
       │
       ▼
  R2 cache           ← Primary read source (fast)
       │
       ├── Hit: return content
       │
       └── Miss: fetch from Drive, populate R2 cache, return
```

### Invariant

**If R2 and Drive disagree, Drive wins.** R2 can be wiped and rebuilt from Drive at any time. R2 is disposable; Drive is not.

### What D1 Stores (Metadata Only)

- `chapters.title`, `chapters.sort_order`, `chapters.created_at`, `chapters.updated_at`
- `chapters.word_count`, `chapters.drive_file_id`
- Project and chapter relationships
- **Never:** chapter body content, manuscript text, user prose

## Rationale

1. **Option A (IndexedDB only when disconnected)** was rejected. iOS aggressively evicts IndexedDB under storage pressure. A non-technical user losing their manuscript because they closed Safari is unacceptable. Server-side buffering is the responsible choice.

2. **Option B (R2 as primary store)** was rejected. Making R2 the content home contradicts the product promise. If DraftCrane shuts down, the user's book should still exist in their Drive. R2 is infrastructure we control; Drive is the user's territory.

3. **The chosen approach (R2 as write-through cache)** gives us the safety of server-side storage, the performance of edge-cached reads, and the trust of user-owned canonical storage. The user's content is always in a place they control (Drive) while the app stays fast (R2).

## Consequences

### Positive

- Content survives browser eviction, device loss, and app shutdown
- App reads are fast (R2 is edge-cached, no Drive API latency)
- Users own their data — if DraftCrane disappears, their book is in Drive
- Graceful degradation: works without Drive (with clear messaging)

### Negative

- Dual-write adds complexity to the save path
- Drive API rate limits and latency require async/non-blocking writes
- Conflict resolution needed if R2 and Drive diverge (Drive wins)
- R2 storage cost for content that also lives in Drive (acceptable at scale)

### Implementation Notes

- Drive write failures should be retried with exponential backoff, not surfaced as save failures to the user (R2 already has the content)
- The "Connect Drive" banner must be non-dismissible — it's a safety warning, not a promotion
- R2 content keys: `chapters/{chapter_id}/content` (simple, no user-id prefix needed since chapter IDs are globally unique UUIDs)
- Version tracking via `X-Chapter-Version` header prevents stale writes

## References

- [Issue #39](https://github.com/venturecrane/dc-console/issues/39) — Decision: Content storage when Drive is not connected
- Project Instructions, Principle 3: "The user's files are sacred"
- PRD Section 8: Three-Tier Auto-Save Architecture
- PRD Appendix: Unresolved Issue #1
