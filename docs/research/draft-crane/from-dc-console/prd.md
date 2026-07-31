# Product Requirements Document (PRD)

**Product Name:** DraftCrane
**Tagline:** Your book. Your files. Your cloud. With an AI writing partner.
**Version:** 2.0 (Synthesized from 3-round team review)
**Date:** February 6, 2026
**Status:** Phase 0 -- Design to Prototype

---

## 1. Executive Summary

DraftCrane is a browser-based writing environment that helps non-technical professionals turn their scattered expertise into a publishable nonfiction book. It connects to the author's own Google Drive, provides a chapter-based editor with AI writing assistance, and exports directly to PDF and EPUB -- with all manuscript files stored in the author's own cloud account.

Phase 0 delivers the minimum tool needed to test one hypothesis: **will a non-technical professional use a chapter-based browser editor with integrated AI to write and export at least one complete chapter?** The five Phase 0 features are: sign in, connect Google Drive, write in a structured editor, get AI help rewriting passages, and export a book file.

Phase 0 is not a differentiated product. It is a validation vehicle. What we ship in Phase 0 is a chapter editor with basic AI rewrite and export. Competitors like Atticus already offer browser-based, chapter-organized writing with professional export for a one-time $148 fee. Google Docs plus ChatGPT is free and already the workflow our target users employ. Google Docs has also integrated Gemini AI for inline rewriting, narrowing what was once a clear advantage. Phase 0 does not win on features. It wins on learning. The strategic bet is that Phase 0 validates whether the foundation is sound enough to build Phase 1, which is where the real differentiation lives: the Book Blueprint (AI that knows the author's voice and terminology), contextual writing guidance, and structured assistance. No competitor offers that. But it does not exist yet. Phase 0's job is to prove the foundation deserves it.

DraftCrane is a Business Validation Machine portfolio product. It may not survive Phase 0. The kill criteria are real. If the prototype does not produce chapter completions, user returns, or willingness-to-pay signals at the thresholds defined in Section 15, the product is killed or pivoted.

---

## 2. Product Vision & Identity

### What DraftCrane Is

DraftCrane is a guided writing environment for nonfiction authors who have expertise but not a manuscript. It is a source-to-manuscript pipeline that works with the author's existing cloud storage. It is an AI writing partner that respects the author's voice, sources, and ownership.

The core problem: writing a professional nonfiction book today requires stitching together word processors, note apps, research folders, AI chat tools, and formatting software. Diane Mercer illustrates this: a 47-page Google Doc titled "Book Draft v3 - REAL ONE," three Safari tabs open for source material and ChatGPT, and 45 minutes of work that produces 200 net-new words. Marcus Chen shows the organizational version: 12 subfolders with 3-15 documents each, four partial drafts of Chapter 3, and no canonical version. The target customer summarizes it: "I have 200 pages of raw material and zero finished chapters." DraftCrane replaces that patchwork with a single guided environment.

Every feature in DraftCrane must pass one test: **does this reduce the author's cognitive overhead, or move the manuscript closer to publishable?** If it does neither, it gets cut.

### What DraftCrane Is Not

- **Not a general-purpose word processor.** Google Docs already exists. DraftCrane is purpose-built for book-length nonfiction.
- **Not a fiction or creative writing tool.** Scrivener and tools like Sudowrite, Novelcrafter, and Dabble serve a different audience with different needs.
- **Not an AI ghostwriter.** The author writes. The AI assists. Every AI-generated change requires the author's explicit approval before it is applied. No silent rewrites. No content presented as the author's work without their review.
- **Not a publishing house.** DraftCrane produces export-ready files (PDF, EPUB). It does not print, distribute, or sell books.

### What DraftCrane Is Not Solving in Phase 0

Phase 0 does not help users organize their existing content. Phase 0 gives authors a new project with an empty first chapter. Source Intelligence (importing and organizing existing materials) is Phase 2. The Book Blueprint (teaching the AI about the author's voice and terminology) is Phase 1.

The `drive.file` OAuth scope used in Phase 0 limits DraftCrane's access to files it creates or the user explicitly opens with DraftCrane. The user's existing Google Docs are invisible to DraftCrane. DraftCrane auto-creates a new Book Folder rather than browsing existing folders, meaning the user's existing material is not visible within DraftCrane.

This means Phase 0's first experience is starting a new project from a blank chapter. The design mitigates this by: (1) keeping project setup fast (two fields, one button), (2) prompting Drive connection immediately to signal DraftCrane cares about the user's existing world, and (3) encouraging paste of existing content ("Start writing, or paste your existing notes here...").

**Risk acknowledgment:** If every test user's reaction to Phase 0 is "but what about my existing notes?", that is a signal that Phase 0 cannot validate anything useful because it is testing the wrong starting point. See Risk 2 in Section 16.

---

## 3. Target Users & Personas

### Primary User

Non-technical professionals (consultants, coaches, academics, founders, executives, subject-matter experts) who want to write a nonfiction book but feel overwhelmed by tools and process. Both personas work on iPad as their primary device, are comfortable with Google Docs but not with technical software, have existing notes and materials in Google Drive, and value ownership of their intellectual property.

The usability bar: a management consultant should be able to figure out any screen in 10 seconds without instructions.

### Persona 1: Diane Mercer -- Leadership Consultant

**Age:** 52 | **Location:** Austin, TX | **Device:** iPad Pro 12.9" (primary), MacBook Air (occasional)

Diane has run a leadership consulting practice for 14 years. She works with mid-level managers at Fortune 500 companies. She has a deep body of knowledge that exists as scattered Google Docs: workshop decks, client debrief notes, frameworks she has refined over years. Her clients constantly tell her, "You should write a book." She has tried three times.

**Technical comfort:** Lives in Google Workspace. Tried Notion once, abandoned it in 20 minutes. Does not know what Markdown is. Uses her iPad for 80% of work, including writing, because she travels frequently and prefers working from hotel lobbies and airport lounges with a Smart Keyboard Folio.

**Current writing workflow:** Opens a Google Doc titled "Book Draft v3 - REAL ONE" on her iPad. Scrolls past 47 pages of mixed content. Opens a second Safari tab to find a source doc. Opens a third tab for ChatGPT. Copy-pastes between all three. After 45 minutes, she has approximately 200 words of net-new content. She closes everything and answers client emails instead.

**What is broken:** No structure. Source material scattered across dozens of Google Docs. AI requires constant context-switching. AI output "reads like a textbook written by a committee." No sense of progress. iPad makes multi-tab workflows painful. No export path.

**Fears about DraftCrane:** Losing her work. AI replacing her voice. Another tool that disappears. Setup without progress ("If it shows me a blank project with an empty outline, I feel deflated").

**Needs from Phase 0:** A single place to write that is not a sprawling Google Doc. Chapter-based structure. AI assistance without leaving her writing surface. Google Drive connection. One-click export. Visible word count.

### Persona 2: Marcus Chen -- Executive Coach

**Age:** 44 | **Location:** Chicago, IL | **Device:** iPad Air (primary), company-issued laptop (rare)

Marcus left a VP role at a logistics company two years ago to start an executive coaching practice. His niche is operational leadership. He has strong content already: a Google Drive folder with over 100 documents. His book idea is clear. He is not blocked on what to say. He is blocked on how to organize it.

**Technical comfort:** Slightly more technical than Diane. Has used Trello, Asana. Chose an iPad specifically because it forces simplicity. Uses Google Docs, Google Sheets, Apple Notes. Has a Smart Keyboard and uses it consistently. Frequently works in portrait mode when reading, landscape when writing.

**Current writing workflow:** Has a Google Drive folder "Book Project" with 12 subfolders, one per tentative chapter. Each has 3-15 documents. Opens the Chapter 3 subfolder, reads three different docs, then opens a new blank Google Doc and starts drafting from scratch. Uses ChatGPT for tone adjustment. At the end of a session, he has a new Google Doc in his Chapter 3 folder -- now four partial drafts and no canonical version.

**What is broken:** Too many documents, no single canonical manuscript. Versioning is chaos. Tone inconsistency across 100+ source documents. No export workflow. Organizational overhead so high he procrastinates by doing more "research."

**Needs from Phase 0:** Chapter-based structure with one canonical document per chapter. Google Drive connection. Freeform AI instructions for tone. Trustworthy auto-save. Chapter reordering. PDF export. Word counts. Good paste handling for manual content migration.

---

## 4. Core Problem

Writing a professional nonfiction book today requires stitching together word processors, note apps, research folders, AI chat tools, and formatting software. This fragmented workflow creates cognitive overload, lost materials, structural confusion, and technical barriers to publishing.

The target customer describes the reality: "I have been 'writing a book' for three years. I have 200 pages of raw material that could probably produce a strong 250-page book. I have zero finished chapters." Her typical session: opens Google Docs, scrolls through her "Book Project" folder looking for whatever she worked on last, opens three different documents before finding the right one, copies a paragraph to ChatGPT for improvement, gets output that "reads like a management consulting textbook written by a committee," and after 45 minutes has maybe 200 new words.

The deeper problem is not the copy-pasting. The deeper problem is that she has 200 pages of raw material and no tool has ever helped her turn that mess into a structured manuscript. Every tool that gives her another blank page makes the feeling worse. Every tool that helps her see actual progress against an actual goal is worth more than its price tag.

DraftCrane's primary competitor is not a product. It is the user's existing Google Drive folder full of scattered documents. The competitive question is: "Can DraftCrane help me make sense of what I already have, or is it just another blank page?"

---

## 5. Product Principles

Each principle is a decision-making rule. When we face a tradeoff, these resolve it.

### Principle 1: Browser-First, iPad-Native

DraftCrane works in Safari, Chrome, or any modern browser. No desktop app. No Electron. Safari on iPad is the primary test target. If it works there, it works everywhere.

**In practice:** Every UI element must be tested on iPad Safari (iPadOS 17+). Touch targets of 44x44pt minimum per Apple HIG. The editor library (ADR-001) must be validated on a physical iPad. The virtual keyboard consumes 40-50% of the screen in portrait; the editor must keep the cursor visible using the `visualViewport` API. Use `100dvh`, not `100vh`. Split View must not break the app. Input latency under 100ms.

### Principle 2: No Lock-In -- The User's Files Are Sacred

All manuscript content lives in the author's Google Drive. DraftCrane indexes and caches, but the user's Drive is the canonical store. If DraftCrane disappears tomorrow, the author still has their book in standard HTML files in their own cloud account.

**In practice:** Chapter body content lives in Google Drive as HTML files. D1 stores only metadata. The three-tier save architecture enforces this: IndexedDB (every keystroke) -> Google Drive (2-second debounce) -> D1 (metadata only). OAuth tokens stored server-side only. `drive.file` scope limits access to DraftCrane-created files. File ownership is visible -- "View in Drive" links, recognizable file names (`Introduction.html`, `The Problem.html`).

### Principle 3: AI as Partner, Not Replacement

The author writes. The AI assists. Every AI-generated change requires explicit approval before it is applied. No silent rewrites.

**In practice:** AI rewrite uses a bottom sheet with "Use This" / "Try Again" / "Discard." User always sees original and rewrite simultaneously. Acceptance is undoable via Cmd+Z. Phase 0 offers three modes (rewrite, expand, simplify) with suggestion chips plus a freeform instruction field. Phase 0 AI has no knowledge of the author's voice beyond selected text plus 500 characters of surrounding context, chapter title, and project description. The Book Blueprint (Phase 1) is what makes the AI meaningfully context-aware.

### Principle 4: Structure Reduces Overwhelm

A blank page is the enemy. DraftCrane gives authors a chapter-based structure that breaks the overwhelming task of "write a book" into manageable pieces.

**In practice:** The editor is chapter-based from day one. Opening DraftCrane takes the user directly to their last-edited chapter. The sidebar shows chapters with word counts. Chapter reordering via long-press-and-drag is included. Onboarding is three tooltips maximum.

### Principle 5: Publishing Is a Button, Not a Project

Generating a professional book file should take one click.

**In practice:** PDF and EPUB export with sensible defaults and a single default template. US Trade page size (5.5" x 8.5"), readable serif font, proper margins, chapter title pages, page numbers, a title page. Both full-book and single-chapter export. Export file naming with date stamps to prevent overwrites. If no PDF approach meets the quality bar, ship EPUB-only rather than an ugly PDF.

---

## 6. Competitive Positioning

### Landscape Summary

DraftCrane operates in a space with 17 relevant competitors across six categories:

| Category                  | Key Players                                       | Threat Level                                        |
| ------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| General writing tools     | Google Docs + Gemini, Word + Copilot, Notion + AI | VERY HIGH (Docs), LOW (others)                      |
| Book writing tools        | Scrivener, Atticus, Vellum, Reedsy                | MEDIUM-HIGH (Atticus), HIGH credibility (Scrivener) |
| AI writing assistants     | ChatGPT, Claude, Sudowrite, Novelcrafter          | HIGH (ChatGPT)                                      |
| Self-publishing platforms | KDP, Draft2Digital                                | Not competitors (distribution)                      |
| Adjacent tools            | Grammarly, Otter.ai                               | Incumbent spend ($32/mo combined)                   |
| The real competitor       | User's existing Google Drive folder chaos         | HIGHEST                                             |

### Feature Comparison (Phase 0 vs. Top 5 Competitors)

| Feature              | DraftCrane P0 | Docs+Gemini+Grammarly | Atticus   | Scrivener | Reedsy  |
| -------------------- | ------------- | --------------------- | --------- | --------- | ------- |
| Browser-based        | Yes           | Yes (3 tools)         | Yes       | No        | Yes     |
| iPad-optimized       | Yes (primary) | Partial               | Yes       | Partial   | Partial |
| Chapter structure    | Yes           | No                    | Yes       | Yes       | Yes     |
| Integrated AI        | Yes           | Partial (Gemini)      | No        | No        | No      |
| Book-quality PDF     | Basic         | No                    | Yes       | Yes       | Yes     |
| EPUB export          | Yes           | No                    | Yes       | Yes       | Yes     |
| Cloud file ownership | Yes (Drive)   | Yes (Drive)           | No        | Partial   | No      |
| Source integration   | No (Phase 2)  | No                    | No        | Yes       | No      |
| Collaboration        | No            | Excellent             | No        | No        | No      |
| Offline              | No            | Partial               | Yes (PWA) | Yes       | No      |
| Version history      | Undo only     | Excellent             | No        | Yes       | No      |
| Cost                 | Free (beta)   | ~$32/mo combined      | $148 once | $49 once  | Free    |

### Where Phase 0 Wins

- **Integrated AI in a book-aware editor.** The only tool combining chapter-based writing with in-editor AI via suggestion chips and streaming.
- **Cloud file ownership.** Chapters live as HTML files in the user's own Google Drive. Unique positioning.
- **iPad Safari as primary target.** Not an afterthought.
- **Cost consolidation.** Replaces a fragmented $32/month workflow with a single tool.
- **Accept/reject preview for AI.** Better interaction than copy-pasting to ChatGPT.

### Where Phase 0 Loses

- **Export quality** vs. Atticus and Vellum (Workers constraints limit PDF).
- **Existing content organization** -- all personas have extensive materials; Phase 0 cannot help.
- **Version history** vs. Google Docs.
- **AI depth** without the Book Blueprint.
- **Google Docs + Gemini** narrows the "integrated AI" advantage.
- **Offline** vs. Atticus, Scrivener.

### Phase 0 Competitive Strategy

1. Win on organization and structure (chapter sidebar with word counts, project container, visible progress).
2. Win on trust (auto-save indicator, Google Drive file ownership, "View in Drive" link, undo for AI changes).
3. Be adequate on AI (at least as good as copy-pasting to ChatGPT, and more convenient).
4. Be adequate on export (looks like a book, not a web page).
5. Do not try to compete on features DraftCrane does not have yet.

### Positioning Statement

**For non-technical professionals who have deep expertise scattered across dozens of documents and have been meaning to write a book for years**, DraftCrane is a **browser-based book-writing environment** that **organizes your manuscript into chapters, puts an AI writing partner inside your editor, and keeps all files in your own Google Drive**. Unlike **Google Docs + ChatGPT**, which forces a fragmented multi-tab workflow with no book structure, DraftCrane **makes your book feel like a real, organized project from day one**.

---

## 7. Phase 0 User Journey

### Step 1: Landing Page

A simple page with the DraftCrane tagline, a 2-3 sentence description, and a "Get Started" button. No feature matrix, no pricing table. Language must feel written for authors, not technologists. Avoid: "platform," "integrate," "workflow," "pipeline," "orchestration." Use: "write," "organize," "export," "your book," "your files."

### Step 2: Sign In

Clean Clerk-hosted authentication. "Continue with Google" is primary and prominent. Email/password is secondary. Redirect-based OAuth only (Safari popup blocker mitigation). Request only auth scopes here -- not Drive scopes.

_References: US-001, US-002, US-004_

### Step 3: Book Setup (First Run)

Two fields: book title (required) and optional description (1-2 sentences). Helper text: "This is a working title. You can change it anytime." A "Create Book" button. No audience field, tone picker, or length target (those are Phase 1 Book Blueprint).

_References: US-009_

### Step 4: Connect Google Drive (Contextual, Not Blocking)

After project creation, a gentle banner: "Connect your Google Drive to keep your book safe." Button: "Connect Google Drive." Link: "Maybe later."

On connect: redirect-based Google OAuth for `drive.file` scope. After consent, DraftCrane auto-creates a Book Folder named after the project title. Confirmation shows folder name, green checkmark, and "View in Google Drive" link.

On "Maybe later": content saves to IndexedDB locally. Persistent indicator: "Not connected to Google Drive. Your work is saved on this device only." When Drive is eventually connected, existing content migrates.

_References: US-005, US-006_

### Step 5: Writing Environment -- Orientation

Three zones: (1) Sidebar with chapter list, word counts, "+" button, total word count. (2) Editor with clean writing area, editable chapter title, placeholder: "Start writing, or paste your existing notes here..." (3) Toolbar with minimal formatting (Bold, Italic, H2/H3, Lists, Block quote), save status, Export, Settings.

First-time tooltip (3 steps max): "This is your chapter," "Use the sidebar for chapters," "Select text for AI."

_References: US-011, US-012, US-024_

### Step 6: Writing -- Core Loop

User writes and edits. Auto-save triggers after 2 seconds of inactivity. Save indicator: "Saving..." / "Saved" / "Unable to save." IndexedDB captures every keystroke as crash protection. Chapter navigation via sidebar with scroll position restoration. Chapter reordering via long-press drag. Word counts update in real-time.

Paste handling is critical: content from Google Docs preserves supported formatting (bold, italic, headings, lists, block quotes) and silently strips unsupported formatting.

_References: US-011, US-012, US-012A, US-013, US-015, US-024_

### Step 7: AI Rewrite

Select text -> floating action bar appears with "AI Rewrite" -> bottom sheet slides up with original text, instruction field, suggestion chips ("Simpler language" | "More concise" | "More conversational" | "Stronger" | "Expand") -> user taps chip or types freeform instruction -> streaming result via SSE (first token < 2 seconds) -> "Use This" / "Try Again" / "Discard." Acceptance undoable via Cmd+Z.

_References: US-016, US-017, US-018_

### Step 8: Chapter Management

Create chapter via "+" button. Rename via double-tap (inline editing). Reorder via long-press drag. Delete with confirmation (Drive file moved to trash, 30-day Google retention). A project must always have at least one chapter.

_References: US-010, US-012A, US-013, US-014_

### Step 9: Export

"Export" button in toolbar reveals: "Export Book as PDF," "Export Book as EPUB," "Export This Chapter as PDF." Progress indicator during generation. Result offers "Save to Google Drive" and/or "Download." Files saved to `_exports/` subfolder with date-stamped names.

_References: US-019, US-020, US-021, US-022_

---

## 8. Phase 0 Feature Specifications

### Auth

**US-001: Sign Up** -- New user creates an account via "Continue with Google" (primary) or email/password (secondary). Clerk handles auth. Google OAuth at sign-up requests authentication scopes only, not Drive scopes. Redirects to Book Setup screen.

**US-002: Sign In** -- Returning user signs in and is taken directly to the Writing Environment with last-edited chapter loaded. Session via Clerk JWT (httpOnly, Secure, SameSite=Lax cookie).

**US-003: Sign Out** -- Session terminated server-side. Auto-save completes before termination. Cached data cleared from browser including IndexedDB.

**US-004: Session Persistence** -- 30-day session lifetime. Returning users go directly to Writing Environment without re-authentication.

### Google Drive Integration

**US-005: Connect Google Drive** -- OAuth with `drive.file` scope. Redirect-based flow only. Tokens stored server-side, encrypted (AES-256-GCM). "Maybe later" option available. When Drive is not connected, persistent indicator shows degraded state.

**US-006: Create Book Folder** -- DraftCrane auto-creates a folder named after the project title. Per-project folders. "View in Google Drive" link for verification. Folder name not auto-renamed on project title change.

**US-007: View Files in Book Folder** -- Read-only listing of DraftCrane-created files (chapters, exports). Under `drive.file` scope, only DraftCrane-created files are visible.

**US-008: Disconnect Google Drive** -- Revokes OAuth token, deletes from D1. Drive files remain untouched. User can reconnect anytime.

### Basic Editor

**US-009: Create a Project** -- Title (required, max 500 chars) and description (optional, max 1,000 chars). Creates default "Chapter 1." Multiple projects per user supported.

**US-010: Create a Chapter** -- "+" button creates chapter at end of list with editable title ("Untitled Chapter"). No chapter count limit. Creates corresponding HTML file in Drive if connected.

**US-011: Edit Chapter Content** -- Rich text editor with formatting: Bold, Italic, H2, H3, Bulleted list, Numbered list, Block quote. 18px base font. Max content width ~680-720pt. Keyboard shortcuts supported. Paste from Google Docs preserves supported formatting, silently strips unsupported.

**US-012: Chapter Navigation** -- Sidebar shows chapters with titles, word counts, active highlight. Chapter load under 2 seconds (< 10K words). Auto-save before navigation. Scroll position restoration. Sidebar responsive: persistent in landscape (240-280pt), hidden in portrait with "Ch X" pill indicator.

**US-012A: Reorder Chapters** -- Long-press-and-drag in sidebar. Batch update of `sort_order`. Drive file names not renamed on reorder. Keyboard: Ctrl+Up/Ctrl+Down.

**US-013: Rename a Chapter** -- Inline editing via double-tap. Max 200 characters. Empty reverts to "Untitled Chapter." Drive file renamed to match.

**US-014: Delete a Chapter** -- Confirmation required. Hard delete in D1. Drive file moved to trash (30-day retention). Minimum one chapter per project.

**US-015: Auto-Save** -- 2-second debounce after last keystroke. Three-tier: IndexedDB (every keystroke) -> Drive (debounce) -> D1 (metadata). Save indicator: "Saving..." / "Saved [timestamp]" / "Save failed." `visibilitychange` triggers immediate save. Cmd+S supported. Crash recovery via IndexedDB comparison on editor mount. Version conflict detection (409 response).

**US-024: Word Count Display** -- Per-chapter in sidebar (muted text). Total at bottom of sidebar. Real-time update in editor. Selection word count when text is selected.

### AI Rewrite

**US-016: Select Text for AI Rewrite** -- Floating action bar near selection with "AI Rewrite" button. Separate from native iPadOS text menu. Min touch target 48x48pt. Max selection 2,000 words.

**US-017: Request AI Rewrite** -- Bottom sheet with original text, instruction field, suggestion chips ("Simpler language," "More concise," "More conversational," "Stronger," "Expand"), freeform text input. SSE streaming response (first token < 2 seconds). Sends: selected text + instruction + 500 chars surrounding context + chapter title + project description. Rate limit: 10 req/min/user.

**US-018: Accept, Reject, or Try Again** -- "Use This" replaces text with highlight flash (respects `prefers-reduced-motion`), undoable via Cmd+Z. "Try Again" preserves original, instruction field editable. "Discard" or tap outside closes with no change. Unlimited iterations. AI interactions logged as metadata only.

### Export

**US-019: Generate PDF** -- Full-book or single-chapter. Title page, table of contents, chapter headings, page numbers. US Trade page size (5.5" x 8.5"), serif font, 11pt, 1.5 line height, proper margins. File naming: `{Book Title} - YYYY-MM-DD.pdf`. Single-chapter includes title page (book + chapter title) but no ToC.

**US-020: Generate EPUB** -- Valid EPUB 3.0. Same content structure as PDF. Single default stylesheet.

**US-021: Save Export to Drive** -- Auto-upload to `_exports/` subfolder. Shows file name, "View in Drive" link, and "Download" button.

**US-022: Download Export Locally** -- Always available via signed R2 URL (1-hour expiry). On iPad, file goes to Files app.

### Project Management

**US-023: Delete a Project** -- Confirmation dialog. Soft delete (status='archived' in D1). Drive files preserved. If only project, redirects to Book Setup.

---

## 9. Information Architecture

### Primary Screens (Phase 0)

1. **Landing Page** -- Pre-auth. Product explanation. "Get Started."
2. **Auth Screen** -- Sign in / sign up via Clerk.
3. **Book Setup Screen** -- First-run and new-project creation only.
4. **Writing Environment** -- The main screen. 95% of user time.

There is no dashboard. Opening DraftCrane takes the user directly to the Writing Environment with the last-edited chapter loaded.

### Writing Environment Layout

```
+---------------------------------------------------+
|  [Toolbar]                                         |
|  [Book Title v] | B I H2 H3 Ul Ol Bq | Saved | Export | Settings |
+--------+------------------------------------------+
|        |                                           |
| Side-  |  Editor                                   |
| bar    |                                           |
|        |  [Chapter Title - editable]               |
| Ch 1   |                                           |
|  342w  |  Body text area...                        |
| Ch 2   |                                           |
|  1,207w|                                           |
| Ch 3 * |                         142 / 3,400 words |
|  0w    |                                           |
| [+]    |                                           |
|        |                                           |
| Total: |                                           |
| 1,549w |                                           |
+--------+------------------------------------------+
```

### Navigation Model

- **Primary:** Sidebar chapter list.
- **Secondary:** Toolbar (Export, Settings). Settings contains Drive management, Account, Sign Out.
- **Multi-project:** Simple dropdown in toolbar/sidebar header for book switching. No separate dashboard.

### Sidebar Responsive Behavior

- **iPad Landscape (1024pt+):** Persistent, 240-280pt wide, collapsible via toggle.
- **iPad Portrait (768pt):** Hidden by default. Persistent "Ch X" pill at left edge. Tap/swipe to reveal as overlay.
- **Desktop (1200pt+):** Persistent.

---

## 10. Architecture & Technical Design

### System Boundaries

```
+-----------------------------------------------------------------+
|                    USER'S IPAD / BROWSER                         |
|                                                                   |
|  Next.js App (SSR + Client)                                      |
|  +------------+  +------------+  +--------------------------+    |
|  | Auth (Clerk |  | Chapter    |  | Export UI                |    |
|  | Components) |  | Editor     |  | (trigger + download)     |    |
|  +------+------+  +------+-----+  +----------+--------------+    |
|         |                |                    |                    |
|  +------+----------------+--------------------+--+                |
|  |           IndexedDB Local Buffer              |                |
|  |   (keystroke-level write-ahead log)           |                |
|  +------+----------------+--------------------+--+                |
+---------+----------------+--------------------+--------------------+
          |                |                    |
+-----------------------------------------------------------------+
|                CLOUDFLARE EDGE (dc-api Worker)                   |
|                                                                   |
|  Hono Router                                                      |
|  +------------+  +------------+  +------------+                  |
|  | /auth/*    |  | /projects/*|  | /ai/*      |                  |
|  | /drive/*   |  | /chapters/*|  | /export/*  |                  |
|  +------+-----+  +------+-----+  +------+-----+                  |
|         |                |               |                        |
|  +------+----------------+---------------+-----+                  |
|  |              Services Layer                  |                  |
|  |  DriveService | ProjectService | AIService   |                  |
|  +------+--------------+----------------+------+                  |
|         |               |                |                        |
|  +------+---+  +--------+--+  +----------+--+                    |
|  | D1       |  | R2        |  | KV           |                    |
|  | (meta)   |  | (artifacts)|  | (cache)     |                    |
|  +----------+  +-----------+  +--------------+                    |
+-----------------------------------------------------------------+
          |                |                    |
+-----------------------------------------------------------------+
|                     EXTERNAL SERVICES                            |
|  +------------+  +------------+  +------------+                  |
|  | Clerk      |  | Google Drive|  | Anthropic  |                  |
|  | (auth)     |  | API (files) |  | Claude API |                  |
|  +------------+  +------------+  +------------+                  |
+-----------------------------------------------------------------+
```

### Layer Responsibilities

| Layer        | Technology             | Responsibility                                                                   | Does NOT Do                                                             |
| ------------ | ---------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Frontend     | Next.js + Tailwind     | Rendering, editor state, IndexedDB write-ahead log, debounced save orchestration | Store canonical content, call external APIs directly, hold OAuth tokens |
| Backend      | Hono on CF Workers     | API gateway, business logic, Drive/AI orchestration, token management            | Render UI, hold long-lived state, run >30s operations                   |
| D1           | Cloudflare D1 (SQLite) | User metadata, project structure, chapter ordering, AI logs, export tracking     | Store manuscript content                                                |
| R2           | Cloudflare R2          | Export artifacts (PDF/EPUB), temporary content buffer for pre-Drive users        | Long-term content storage                                               |
| KV           | Cloudflare KV          | Session data, Drive API response caching, rate limit counters                    | Relational queries, large objects                                       |
| IndexedDB    | Browser-native         | Keystroke-level content buffer, crash recovery                                   | Long-term storage, cross-device sync                                    |
| Clerk        | External SaaS          | Authentication, session management, JWT issuance                                 | Authorization logic                                                     |
| Google Drive | External API           | Canonical manuscript storage, user file ownership                                | Indexing, search, metadata queries                                      |
| Claude API   | External API           | Text rewriting, expansion, simplification                                        | Autonomous content generation                                           |

### Three-Tier Save Architecture

```
Tier 1: IndexedDB (instant, every keystroke)
  - Latency: <1ms. Data loss window: zero within browser lifetime.
  - Does NOT survive: iOS killing Safari under memory pressure, browser cache clear.

Tier 2: Google Drive (debounced, every 2s of inactivity)
  - Latency: 200-1500ms. Data loss window: up to 2s if Drive save fails AND IndexedDB is lost.
  - Triggered by: debounce timer, visibilitychange, Cmd+S, chapter switch.

Tier 3: D1 Metadata (on every successful Drive save)
  - Latency: <50ms. Stores: updated_at, word_count, version. Never stores content.
```

### Core Request Flows

**Flow A: Sign In and Connect Drive** -- Clerk auth -> JWT cookie -> Writing Environment (first-run: Book Setup) -> "Connect Google Drive" -> redirect-based Google OAuth (`drive.file` scope) -> token exchange and encrypted storage -> folder auto-creation -> confirmation with "View in Drive" link.

**Flow B: Write and Auto-Save** -- Load chapter metadata from D1 -> fetch content from Drive (or R2 if pre-Drive) -> render in editor -> every keystroke writes to IndexedDB -> 2s debounce triggers `PUT /chapters/:id/content` -> write to Drive (or R2) -> update D1 metadata -> return save confirmation. Edge cases: Drive API failure (retry with backoff), version conflict (409 prompt), tab background (`visibilitychange` save), crash recovery (IndexedDB comparison on mount).

**Flow C: AI Rewrite** -- Select text -> tap "AI Rewrite" -> bottom sheet -> user provides instruction -> `POST /ai/rewrite` with selected text + instruction + 500 chars context + chapter title + project description -> Claude API with SSE streaming -> display token by token -> "Use This" (replace + log accept) / "Try Again" (new request) / "Discard" (log reject). Content length limits: max 2,000 words selected.

---

## 11. Proposed Data Model

### Guiding Principle

D1 stores metadata. Google Drive stores content (canonical). IndexedDB provides local crash protection. R2 provides temporary server-side buffer for pre-Drive users.

### D1 Schema

**users** -- `id` (Clerk user ID), `email`, `display_name`, `created_at`, `updated_at`

**drive_connections** -- `id` (ULID), `user_id`, `access_token` (AES-256-GCM encrypted), `refresh_token` (encrypted), `token_expires_at`, `drive_email`, timestamps

**projects** -- `id` (ULID), `user_id`, `title`, `description`, `drive_folder_id`, `status` ('active'/'archived'), timestamps

**chapters** -- `id` (ULID), `project_id`, `title`, `sort_order`, `drive_file_id`, `r2_key` (for pre-Drive buffer), `word_count`, `version` (optimistic concurrency), `status` ('draft'/'review'/'final'), timestamps. Unique index on `(project_id, sort_order)`.

**ai_interactions** -- `id` (ULID), `user_id`, `chapter_id`, `action` ('rewrite'/'expand'/'simplify'), `instruction`, `input_chars`, `output_chars`, `model`, `latency_ms`, `accepted`, `attempt_number`, `created_at`. No user content stored.

**export_jobs** -- `id` (ULID), `project_id`, `user_id`, `chapter_id` (nullable for full-book), `format` ('pdf'/'epub'), `status` ('pending'/'processing'/'completed'/'failed'), `r2_key`, `drive_file_id`, `error_message`, `chapter_count`, `total_word_count`, `created_at`, `completed_at`

### Google Drive File Structure

```
Book Folder (auto-created)/
+-- Introduction.html           -- One HTML file per chapter
+-- The Problem.html            -- Named by chapter title, no number prefix
+-- The Solution.html
+-- _exports/
    +-- The Operational Leader - 2026-02-06.pdf
    +-- The Operational Leader - 2026-02-06.epub
```

File naming uses chapter title only (`{Chapter Title}.html`) to avoid rename churn on reorder. Export naming: `{Book Title} - YYYY-MM-DD.{format}`.

### Schema Design Notes

- **ULID** for all entity IDs (sortable by creation time).
- **TEXT for dates** (ISO 8601, sorts correctly in SQLite).
- **No cascading deletes** -- explicit service-level cleanup.
- **No content in D1** -- chapters table has no `body` column.

---

## 12. API Surface

All routes served by the `dc-api` Worker (Hono). All routes except `/auth/webhook` require a valid Clerk session JWT.

### Auth & User

| Method | Path            | Description                                                           |
| ------ | --------------- | --------------------------------------------------------------------- |
| POST   | `/auth/webhook` | Clerk webhook: user created/updated/deleted                           |
| GET    | `/users/me`     | Current user profile, Drive status, active projects, total word count |

### Google Drive

| Method | Path                                | Description                                   |
| ------ | ----------------------------------- | --------------------------------------------- |
| GET    | `/drive/authorize`                  | Returns Google OAuth authorization URL        |
| GET    | `/drive/callback`                   | OAuth callback, exchanges code for tokens     |
| POST   | `/drive/folders`                    | Creates Book Folder in Drive                  |
| GET    | `/drive/folders/:folderId/children` | Lists DraftCrane-created files in Book Folder |
| DELETE | `/drive/connection`                 | Disconnects Drive, revokes token              |

### Projects

| Method | Path                   | Description                            |
| ------ | ---------------------- | -------------------------------------- |
| POST   | `/projects`            | Creates project with default chapter   |
| GET    | `/projects`            | Lists active projects with word counts |
| GET    | `/projects/:projectId` | Project details with chapter list      |
| PATCH  | `/projects/:projectId` | Updates title, description, settings   |
| DELETE | `/projects/:projectId` | Soft-delete (status='archived')        |

### Chapters

| Method | Path                                    | Description                                                                             |
| ------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| POST   | `/projects/:projectId/chapters`         | Creates chapter, creates Drive/R2 file                                                  |
| GET    | `/projects/:projectId/chapters`         | Lists chapters (metadata only)                                                          |
| PATCH  | `/chapters/:chapterId`                  | Updates title, status                                                                   |
| GET    | `/chapters/:chapterId/content`          | Fetches body from Drive or R2                                                           |
| PUT    | `/chapters/:chapterId/content`          | Writes body to Drive or R2, updates D1 metadata. Version header for conflict detection. |
| DELETE | `/chapters/:chapterId`                  | Deletes from D1, trashes Drive file. Rejects if last chapter.                           |
| PATCH  | `/projects/:projectId/chapters/reorder` | Batch sort_order update                                                                 |

### AI

| Method | Path                          | Description                                   |
| ------ | ----------------------------- | --------------------------------------------- |
| POST   | `/ai/rewrite`                 | SSE stream. Max 2,000 words. 10 req/min/user. |
| POST   | `/ai/interactions/:id/accept` | Logs acceptance                               |
| POST   | `/ai/interactions/:id/reject` | Logs rejection                                |

### Export

| Method | Path                                              | Description                           |
| ------ | ------------------------------------------------- | ------------------------------------- |
| POST   | `/projects/:projectId/export`                     | Full-book export job. 5 req/min/user. |
| POST   | `/projects/:projectId/chapters/:chapterId/export` | Single-chapter export                 |
| GET    | `/export/:jobId`                                  | Job status + signed R2 download URL   |
| POST   | `/export/:jobId/to-drive`                         | Upload artifact to Drive `_exports/`  |

### Conventions

- **IDs:** ULIDs as path parameters.
- **Pagination:** `?limit=N&cursor=ULID`. Default limit: 50.
- **Errors:** `{ error: string, code: string }`. Codes: `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `DRIVE_ERROR` (502), `DRIVE_NOT_CONNECTED` (422), `VALIDATION_ERROR` (400), `LAST_CHAPTER` (400).
- **Rate limiting:** Standard: 60 req/min/user. AI: 10 req/min/user. Export: 5 req/min/user.

---

## 13. Non-Functional Requirements

### Platform Compatibility

| Requirement              | Target                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| iPad Safari              | iPadOS 17.0+ (Safari 17+). Manual testing on iPad Air 5th gen+.           |
| Desktop browsers         | Chrome 120+, Firefox 120+, Safari 17+                                     |
| Minimum viewport         | 768px (iPad portrait)                                                     |
| Touch interaction        | All actions completable via touch only. No hover-dependent functionality. |
| Virtual keyboard         | Cursor always visible above keyboard. `visualViewport` API.               |
| Viewport units           | `100dvh`, never raw `100vh`                                               |
| Split View               | Must not break. Not optimized.                                            |
| Orientation change       | Fluid layout response, no content jumps or lost scroll.                   |
| `prefers-reduced-motion` | All animations disabled when enabled.                                     |
| Zoom                     | Functional at 200%. No `user-scalable=no`.                                |

### Performance Budgets

| Metric                         | Target                |
| ------------------------------ | --------------------- |
| LCP                            | < 2.5 seconds on WiFi |
| TTI                            | < 3.5 seconds on WiFi |
| Chapter load (< 10K words)     | < 2 seconds           |
| Chapter load (up to 50K words) | < 5 seconds           |
| Auto-save round trip           | < 3 seconds           |
| IndexedDB write                | < 5ms per keystroke   |
| AI first token                 | < 2 seconds (SSE)     |
| AI complete (500 words)        | < 15 seconds          |
| JS bundle (initial)            | < 300 KB gzipped      |
| Editor JS (lazy)               | < 200 KB gzipped      |
| PDF export (10 chapters)       | < 30 seconds          |
| EPUB export (10 chapters)      | < 10 seconds          |

### Security Model

| Requirement       | Specification                                                   |
| ----------------- | --------------------------------------------------------------- |
| Authentication    | Clerk; httpOnly, Secure, SameSite=Lax cookies                   |
| Authorization     | All D1 queries include `WHERE user_id = ?`. No cross-user data. |
| OAuth tokens      | AES-256-GCM encrypted in D1. Never sent to frontend.            |
| OAuth scope       | `drive.file` only                                               |
| OAuth flow        | Redirect-based only. No popups.                                 |
| Token refresh     | Automatic, 5 min before expiry. Rotation on refresh.            |
| Content isolation | User A never sees User B's data. Integration tests verify.      |
| Rate limiting     | Per-user via KV counters                                        |
| Input validation  | All input validated/sanitized at API boundary. HTML allowlist.  |
| CORS              | Production frontend origin only. No wildcards.                  |

### Cloudflare Platform Constraints

| Constraint       | Limit                         | Implication                                                             |
| ---------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Worker CPU time  | 30ms (bundled), 30s (unbound) | Unbound for AI and export routes                                        |
| Worker memory    | 128 MB                        | Process chapters sequentially during export                             |
| D1 database size | 2 GB (free), 10 GB (paid)     | AI logs largest table; 90-day TTL cleanup                               |
| D1 writes        | 100K/day (free)               | **Phase 0 requires D1 paid tier** at 2s debounce ($0.75/million writes) |
| R2 object size   | 5 GB max                      | Sufficient for all artifacts                                            |
| KV value size    | 25 MB max                     | Sufficient for cached responses                                         |

### Accessibility (WCAG 2.1 Level AA)

- Screen reader: `role="textbox"` with `aria-multiline="true"` for editor. Chapter list as ordered list with position announcements. `aria-live="polite"` for save status. Focus trap on AI bottom sheet.
- Keyboard: All functionality reachable via external keyboard. Logical tab order. Ctrl+Up/Down for chapter reorder.
- Color contrast: 4.5:1 normal text, 3:1 large text. No color-only indicators.
- Font: Minimum 16px in editor. Relative units (`rem`).
- Reduced motion: All animations non-essential and disabled when preference set.
- Zoom: Functional at 200%.

---

## 14. iPad-First Design Constraints

### Touch Targets

- Minimum: 44x44pt (Apple HIG). Chapter list items: full-width, min 48pt tall.
- Toolbar buttons: 44x44pt, 8pt spacing.
- AI floating button: 48x48pt.
- "Use This" / "Discard" in AI bottom sheet: 48pt tall, 16pt gap.
- Suggestion chips: 36pt tall, 8pt spacing.

### Keyboard Handling

**Virtual keyboard:** Consumes 40-50% screen in portrait. Editor resizes to keep cursor visible (`visualViewport` API). Toolbar pinned at top. AI bottom sheet dismisses keyboard first.

**External keyboard:** Full screen available. Shortcuts: Cmd+B, Cmd+I, Cmd+Z, Cmd+Shift+Z, Cmd+S.

### Text Selection (Critical for AI Rewrite)

DraftCrane must not interfere with native iPadOS long-press-to-select and drag-handle patterns. The AI floating toolbar appears ~200ms after native menu, positioned on opposite side of selection. Tracks selection bounds on adjustment.

### Orientation

- **Landscape:** Primary writing mode. ~1024x768pt usable. Sidebar persistent.
- **Portrait:** Secondary reading mode. Single column, sidebar hidden with "Ch X" pill.
- Orientation change is a CSS/layout event, not a navigation event.

### Safari Specifics

- Toolbar: account for `env(safe-area-inset-top)`.
- Bottom elements: account for `env(safe-area-inset-bottom)`.
- Downloads go to Files app; prefer Drive save with direct link.
- `position: fixed` quirks with virtual keyboard -- test exhaustively.
- Include basic web manifest for "Add to Home Screen."

---

## 15. Success Metrics & Kill Criteria

### Kill Criteria

Non-negotiable. If hit, stop building and assess pivot or shutdown.

| Trigger               | Kill Criterion                                 | Measurement                                                                                                           |
| --------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| After prototype       | No user completes a chapter in first session   | 5-10 moderated test sessions. D1 `chapters.word_count` >= 500. Recruit users who can write from knowledge.            |
| After beta (Phase 1)  | < 3 of 10 beta users return for second session | D1 login data. "Return" = login on different calendar day.                                                            |
| After 90 days of beta | No willingness-to-pay signal                   | User interviews: explicit "yes" with a price, or complaint about losing access. Target: $19-29/month is "no-brainer." |

### Phase 0 Metrics

| Metric                      | Target                                             | Data Source                               |
| --------------------------- | -------------------------------------------------- | ----------------------------------------- |
| Core flow completion        | 80%+ of test users complete sign-in through export | Moderated sessions                        |
| Time to first chapter draft | Under 2 hours                                      | Session observation + D1 chapter metadata |
| Export success rate         | 100%                                               | D1 export_jobs + user confirmation        |
| AI rewrite usage/acceptance | 50%+ try AI; 40%+ acceptance rate                  | D1 ai_interactions                        |
| iPad Safari usability       | No critical blockers                               | Manual QA on physical iPad                |
| Confusion points            | < 3 per test session                               | Session notes                             |
| Unprompted feature requests | At least 1 user articulates Phase 1-2 wish         | Session observation                       |

### Post-Validation Metrics (Phase 1+)

| Metric                   | Target                       | Earliest Phase        |
| ------------------------ | ---------------------------- | --------------------- |
| Monthly active retention | 60%+ month-over-month        | Phase 1               |
| Users who export         | 40%+                         | Phase 1               |
| Average chapters/user    | 6+                           | Phase 1               |
| NPS                      | 40+                          | Phase 1               |
| Willingness to pay       | 3+ of 10 express willingness | Phase 2 (90-day mark) |

### Not Measured in Phase 0

Revenue, conversion, organic growth, long-term retention. Phase 0 is free. Being honest about measurement boundaries prevents decisions based on data we do not have.

---

## 16. Risks & Mitigations

### High Priority

| #   | Risk                                                                                                                                | Likelihood | Impact   | Mitigation                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Phase 0 feels like "Google Docs + ChatGPT."** Phase 0 is a basic chapter editor with basic AI.                                    | High       | Critical | Three counters: (a) chapter structure must feel meaningfully better than a long Google Doc, (b) AI rewrite with suggestion chips and streaming must be faster than tab-switching, (c) PDF export must create a "this is a real book" moment. |
| 2   | **Prototype tests the wrong hypothesis.** Test users need to organize existing content (Phase 2), not write from scratch (Phase 0). | High       | Critical | Recruit users who can write from knowledge. Design test tasks around "bring a topic and start a chapter." If fresh-start users succeed but existing-content users fail, treat as product gap signal, not kill signal.                        |
| 3   | **Editor fails on iPad Safari.** Rich text editing in mobile Safari is fragile. Cursor bugs, selection jumping, toolbar focus loss. | High       | Critical | 2-day prototype spike with Tiptap and Lexical on physical iPad. 8-point test protocol. Score 1-5. Decision from real-device testing only.                                                                                                    |
| 4   | **Drive sync causes data loss.** Network dropout, Drive API errors, browser crash, iPadOS background tab suspension.                | Medium     | Critical | Three-tier save. `visibilitychange` event. Crash recovery prompt. Accept 2-second max data loss window for hard OS kills.                                                                                                                    |
| 5   | **Scope creep.** Target customer wants progress tracking, offline mode, voice sample, collaboration.                                | High       | High     | Project instructions list explicit exclusions. US-001 through US-024 define the boundary. Any addition must answer: "Does this prevent learning what we need to learn?"                                                                      |

### Medium Priority

| #   | Risk                                                                                                     | Likelihood | Impact | Mitigation                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | **AI quality poor without Book Blueprint.** No voice context. Output feels generic.                      | High       | High   | Send surrounding context (500 chars each side) + chapter title + project description. Offer specific modes with chips. If users report unhelpful AI, that is Phase 1 prioritization data, not a kill signal.                 |
| 7   | **PDF/EPUB export looks unprofessional.** Workers have no filesystem, no headless browser.               | Medium     | High   | Design HTML+CSS book template first. Prototype Browser Rendering. Fallback: EPUB-only. A bad PDF is worse than no PDF.                                                                                                       |
| 8   | **"Why not Atticus?"** Browser-based, chapter-organized, professional export, $148 one-time.             | Medium     | High   | Atticus's core user has a finished manuscript needing formatting. DraftCrane's user has scattered expertise needing to write. Overlap is narrower than it appears. Phase 0 advantages: AI, Drive ownership, Phase 1 roadmap. |
| 9   | **Users fear lock-in.** "If I cancel, I have a bunch of Google Docs with no structure."                  | Medium     | Medium | Visible file ownership: Book Folder path, "View in Drive" links, recognizable file names.                                                                                                                                    |
| 10  | **`drive.file` scope limits value for users with existing content.** Cannot browse existing Drive files. | Medium     | Medium | Accepted limitation. Auto-create folder is simpler. Google Picker API as fast-follow if demand emerges.                                                                                                                      |

### Lower Priority

| #   | Risk                                                  | Likelihood | Impact   | Mitigation                                                                                                         |
| --- | ----------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| 11  | **Market too small or too competitive.**              | Medium     | Critical | BVM methodology designed to answer this. Kill criteria will tell us.                                               |
| 12  | **Google Docs + Gemini narrows the competitive gap.** | Medium     | High     | Lead positioning with chapter organization and book-format export (where Docs has no answer), not "integrated AI." |

---

## 17. Open Decisions (ADRs)

### ADR-001: Editor Library

**Status:** Pending. Highest priority. Blocks all editor development.

**Options:** Tiptap (ProseMirror-based, best iPad Safari track record, ~150 KB), Lexical (Meta, ~30 KB, less iPad battle-tested), Plate (Slate-based, known iOS issues).

**Recommendation:** Tiptap. 2-day prototype spike on physical iPad. 8-point test protocol. Decision from real-device testing only.

### ADR-002: Google Drive Sync Strategy

**Status:** Pending.

**Options:** On-save debounced 2s (simple, IndexedDB + R2 safety nets), periodic background sync (complex), real-time OT (overkill for Phase 0).

**Recommendation:** On-save debounced 2s. Phase 0 is single-user.

### ADR-003: AI Provider Integration

**Status:** Pending.

**Options:** Direct Anthropic API (simplest, best SSE control), Cloudflare AI Gateway (adds latency), Workers AI (lower quality).

**Recommendation:** Direct Anthropic API. Thin `AIService` wrapper for future re-pointing.

### ADR-004: PDF/EPUB Generation

**Status:** Pending. Second-highest priority.

**Options:** Cloudflare Browser Rendering + Worker EPUB (best PDF quality, beta), client-side (variable quality on iPad), external service (DocRaptor/Prince, per-document pricing).

**Recommendation:** EPUB in Worker (tractable). PDF: prototype Browser Rendering with a well-designed HTML+CSS template. If quality acceptable, use it. If not, external service. If neither, EPUB-only.

**3-day spike:** (1) Design HTML+CSS book template, build EPUB generator. (2) Test Browser Rendering for PDF quality/latency. (3) Fallback: test DocRaptor.

### ADR-005: Data Model Split

**Status:** Pending.

**Recommendation:** Metadata-only in D1 + R2 buffer for pre-Drive users + IndexedDB for local crash protection. Content flows: Editor -> IndexedDB -> Drive (or R2) -> D1 metadata.

### ADR-006: AI Agent Architecture

**Status:** Not needed for Phase 0. Phase 0 uses direct Claude API calls. Evaluate agents (Claude Code SDK) for Phase 1 Book Blueprint and Craft Buttons.

### Additional Decisions

| Question                 | Decision                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Session lifetime         | 30 days                                                                                                      |
| Book Folder scope        | Per-project                                                                                                  |
| Multiple projects        | Yes, supported                                                                                               |
| Max chapters/project     | No artificial limit (test at 50+)                                                                            |
| Max chapter title length | 200 characters                                                                                               |
| Chapter deletion         | Hard delete in D1. Drive file to trash (30-day retention).                                                   |
| Pre-Drive content        | IndexedDB-only. Prominent banner. (See Unresolved Issues for R2 alternative.)                                |
| Export file naming       | `{Book Title} - YYYY-MM-DD.{format}`                                                                         |
| PDF page size            | US Trade (5.5" x 8.5")                                                                                       |
| Paste formatting         | Silent strip of unsupported. Supported (bold, italic, headings, lists, block quote) preserved.               |
| iPhone support           | Not in Phase 0. Min viewport 768px.                                                                          |
| Account deletion         | Define before beta launch. Delete D1, revoke tokens, leave Drive files.                                      |
| Dual OAuth               | Clerk handles auth Google OAuth; DraftCrane handles Drive OAuth separately. Separate client IDs recommended. |
| Single-chapter export    | Includes title page (book + chapter title), no ToC.                                                          |
| AI streaming             | Required (SSE). First token < 2s.                                                                            |
| Freeform AI instruction  | In Phase 0 scope. Single-line field + suggestion chips.                                                      |
| Chapter reorder          | In Phase 0 scope. Long-press drag.                                                                           |
| Word count               | In Phase 0 scope. Per-chapter + total.                                                                       |
| Google sign-in           | In Phase 0 (via Clerk). Primary method.                                                                      |
| AI rate limit            | 10 req/min/user. No per-user usage caps during Phase 0. Track cost.                                          |

---

## 18. Phased Development Plan

### Phase 0 -- Foundations (Current)

| Feature                  | Delivers                                                                          |
| ------------------------ | --------------------------------------------------------------------------------- |
| Auth system              | Sign in (Google or email via Clerk), 30-day session                               |
| Google Drive integration | OAuth (`drive.file`), auto-create Book Folder, read/write chapters                |
| Basic editor             | Chapter-based writing, auto-save (2s debounce), chapter reorder, word count       |
| Simple AI rewrite        | Select text, instruction (chips or freeform), streaming suggestion, accept/reject |
| PDF/EPUB export          | Full-book or single-chapter, saved to Drive and/or downloaded                     |

**Explicitly NOT in Phase 0:** Book Blueprint, outline generation, Craft Buttons (beyond basic modes), Idea Inbox, Source Intelligence, collaboration, cover toolkit, structural guidance, consistency engine, voice dictation, progress dashboard, voice sample, offline mode, version history beyond undo, importing existing Drive docs.

#### Gate Criteria: Phase 0 to Phase 1

1. All five features deployed and functional.
2. At least one test user completes a chapter (500+ words) in first session. **(Kill criterion)**
3. At least one user exports and confirms usable output.
4. No critical usability blockers on iPad Safari.
5. At least one user articulates unprompted wish for Phase 1-2 feature.
6. Explicit go/no-go decision by product owner.

**Test user recruitment:** Mix of users with existing material and fresh starts. If existing-content users fail because Phase 0 cannot help with organization while fresh-start users succeed, that is a product gap signal, not a kill signal.

### Phase 1 -- Guided Writing (Post-Validation)

Book Blueprint (voice rules, terminology, key claims), outline generation, Craft Buttons, Idea Inbox. The Book Blueprint is where differentiation truly begins -- no competitor offers AI that understands book-level context.

**Gate:** 3+ of 10 beta users return for second session. **(Kill criterion)**

### Phase 2 -- Source Intelligence

Import and index source materials from Drive, searchable source panel, AI-suggested sources, insert with attribution.

**Gate:** Willingness-to-pay signal from active users. **(Kill criterion -- 90-day mark)**

### Phase 3 -- Publishing Polish

Professional templates, layout tuning, cover toolkit, distribution checklists.

### Phase 4 -- Advanced AI & Ecosystem

Consistency engine, developmental editing, multi-book memory, audiobook prep.

_Phases 3 and 4 are directional. Their scope will be reshaped by what we learn._

---

## 19. Glossary

| Term                              | Definition                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Book Blueprint                    | Phase 1 feature: a structured document defining the author's voice rules, terminology, key claims, and target reader. Used by AI to maintain consistency. |
| Book Folder                       | The Google Drive folder created by DraftCrane to store a project's chapter files and exports. One per project.                                            |
| Bottom sheet                      | A UI panel that slides up from the bottom of the screen, used for the AI rewrite interaction.                                                             |
| Business Validation Machine (BVM) | The venture methodology DraftCrane follows. Products must pass kill criteria to continue.                                                                 |
| Craft Buttons                     | Phase 1 feature: one-tap AI transformations (expand, shorten, simplify, improve flow, add example, etc.).                                                 |
| D1                                | Cloudflare's SQLite-based database service. Stores metadata only.                                                                                         |
| `drive.file` scope                | Google OAuth scope that limits access to files created by or explicitly opened with DraftCrane.                                                           |
| Idea Inbox                        | Phase 1 feature: quick capture for text and voice notes with AI-suggested placement.                                                                      |
| IndexedDB                         | Browser-local storage used as a keystroke-level write-ahead log for crash protection.                                                                     |
| KV                                | Cloudflare's key-value store. Used for caching and rate limit counters.                                                                                   |
| R2                                | Cloudflare's object storage. Used for export artifacts and temporary content buffer.                                                                      |
| Source Intelligence               | Phase 2 feature: importing, indexing, and surfacing the author's existing materials during writing.                                                       |
| Suggestion chips                  | Tappable labels in the AI bottom sheet ("Simpler language," "More concise," etc.) that provide vocabulary for AI instructions.                            |
| Three-tier save                   | The auto-save architecture: IndexedDB (every keystroke) -> Google Drive (2s debounce) -> D1 (metadata).                                                   |
| ULID                              | Universally Unique Lexicographically Sortable Identifier. Used for all entity IDs.                                                                        |
| US Trade                          | Page trim size 5.5" x 8.5" (139.7mm x 215.9mm). Standard self-publishing nonfiction format.                                                               |
| Writing Environment               | The main screen where users spend 95% of their time. Contains sidebar, editor, and toolbar.                                                               |

---

## Appendix: Unresolved Issues

The following are genuine disagreements or open questions that surfaced during the three-round team review. They require human decision-making before development begins.

### 1. Content storage when Drive is not connected

**The disagreement:** The PM says IndexedDB-only with a persistent banner. The Technical Lead says R2 as a temporary server-side buffer. IndexedDB-only means content exists only on one device's browser. R2 provides server-side persistence without putting content in D1, but creates content on DraftCrane's servers (contradicts the "your files, your cloud" promise).

**Decision needed:** Is IndexedDB-only acceptable? Or should R2 serve as a temporary safety net, with content migrated to Drive on connection and deleted after?

### 2. Voice sample field during project setup

**The request:** The target customer's strongest Phase 0 micro-feature request across all three rounds. A single optional text area during setup: "Paste a page of your best writing so the AI can match your style." Used as a prompt prefix for all rewrites. Minimal engineering cost, significant AI quality improvement.

**The PM's position:** Excluded from Phase 0 because it moves AI from stateless to stateful-per-project, which is functionally a lightweight Book Blueprint. Flag as strong Phase 1 candidate.

**Decision needed:** Is a voice sample field a reasonable Phase 0 addition that improves validation quality? Or does it violate the "build Phase 0, validate, then decide" principle?

### 3. PDF vs. EPUB priority if only one can be excellent

**The tension:** The PM's fallback is EPUB-only if PDF quality fails. The target customer prefers PDF ("I will share a PDF with my colleague; I will not load an EPUB into Apple Books in Phase 0"). The Technical Lead confirms EPUB is tractable in Workers while PDF requires Browser Rendering (beta) or external service.

**Decision needed:** If ADR-004 spike shows no acceptable PDF approach, do we ship EPUB-only? Or allocate additional effort for an external PDF service?

### 4. Google Drive folder approach

**Recommendation (aligned across UX Lead, Competitor Analyst, PM):** Auto-create folder (Option A) for Phase 0. Google Picker API (Option B) as fast-follow only if user testing reveals demand. Auto-create is honest about what DraftCrane can access under `drive.file` scope.

**Decision needed:** Final confirmation.

### 5. Account deletion process

**Status:** Must be defined before beta launch. Not blocking for prototype.

**Recommendation:** Delete all D1 data, revoke OAuth tokens, leave Drive files untouched. User-initiated from Settings.

### 6. "Chapter completion" definition for kill criteria

**The PM's definition:** 500+ words that the author considers a recognizable draft. The target customer says a real chapter is 3,000-5,000 words. The BA recommends qualitative context alongside the quantitative threshold: a user who writes 400 words and says "this is great, I just ran out of time" is a different signal than one who says "this is frustrating, I went back to Google Docs."

**Decision needed:** Confirm that kill criterion evaluation includes qualitative assessment, not just a D1 word count query.

### 7. Clerk Google OAuth vs. Drive Google OAuth token conflict

**The issue:** User authenticates with Google via Clerk (auth scopes) and separately authorizes Drive (`drive.file` scope). Potential for double consent prompts, token conflicts, or session confusion if Google accounts differ.

**Recommendation:** Use separate Google OAuth client IDs. Verify in a 0.5-day spike.

### 8. D1 paid tier approval

**The issue:** 2-second debounce at 50 concurrent users generates ~90K D1 metadata writes per hour, exceeding the free tier (100K writes/day) in ~1 hour. Paid tier costs $0.75/million writes (trivial).

**Decision needed:** Approve D1 paid tier for Phase 0.

---

_This PRD was synthesized from three rounds of contributions by six team roles: Product Manager, Technical Lead, Business Analyst, UX Lead, Target Customer (Dr. Sarah Chen persona), and Competitor Analyst. Where roles disagreed, the PM's decisions are authoritative. Genuine unresolved issues are surfaced in the Appendix. The project instructions file (`docs/process/dc-project-instructions.md`) overrides this PRD where they conflict._
