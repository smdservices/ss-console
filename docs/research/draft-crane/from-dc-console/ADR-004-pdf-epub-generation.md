# ADR-004: PDF and EPUB Generation Strategy

## Status

**Proposed** - 2026-02-16

## Context

DraftCrane's Phase 0 requires full-book and single-chapter export to PDF and EPUB (US-019 through US-022). The PRD's Principle 5 says "Publishing Is a Button, Not a Project" -- one click, sensible defaults, output that looks like a real book. The competitive frame is explicit: Atticus and Vellum produce professional book files. DraftCrane does not need to match their template variety, but the output must cross the "this is a real book" threshold.

**What we are generating:**

- **PDF:** Title page, table of contents, chapter headings, page numbers. US Trade page size (5.5" x 8.5"), serif font, 11pt, 1.5 line height, proper margins. Full-book or single-chapter.
- **EPUB:** Valid EPUB 3.0. Same content structure as PDF. Single default stylesheet.
- **Source format:** Tiptap (ProseMirror) HTML, stored in Google Drive as `.html` files per chapter.
- **Book-length target:** 50,000+ words across 10-20 chapters.

**Cloudflare Workers constraints:**

- No local filesystem (no Node `fs`)
- No headless browser natively (Puppeteer/Playwright require Browser Rendering binding)
- 128 MB memory limit
- 30-second CPU time (Unbound plan) per request
- `nodejs_compat` flag enabled (current `wrangler.toml`)

**PRD performance budgets:**

- PDF export (10 chapters): < 30 seconds
- EPUB export (10 chapters): < 10 seconds
- Export rate limit: 5 req/min/user

This ADR also resolves [Issue #41](https://github.com/venturecrane/dc-console/issues/41): whether to prioritize PDF or EPUB if only one can be excellent.

### Options Evaluated

#### Option A: Cloudflare Browser Rendering (REST API) for PDF + in-Worker EPUB

Use Cloudflare's Browser Rendering `/pdf` REST API endpoint to render HTML+CSS into PDF. Build EPUB in-Worker using `JSZip` and OPF/XHTML templates.

**PDF via Browser Rendering:**

- The `/pdf` endpoint accepts raw HTML via the `html` parameter (up to 50 MB request body)
- Supports `addStyleTag` for CSS injection, `pdfOptions` for paper size/margins/scale, `headerTemplate`/`footerTemplate` with `<span class="pageNumber">` and `<span class="totalPages">` placeholders
- `preferCSSPageSize` flag respects CSS `@page` rules
- Runs on Chromium -- supports `page-break-before`, `page-break-after`, `page-break-inside`, and CSS `@page` size declarations
- 60-second timeout per request (REST API)
- Workers Paid plan: 10 hours/month free, then $0.09/hour. REST API charges browser hours only, no concurrent-browser surcharge.
- Rate limit: 180 requests/minute on paid plan

**Chromium CSS paged media limitations (well-documented):**

- `@page` margin boxes (`@top-center`, `@bottom-center`) work but have inconsistencies across headless vs headed Chrome
- Resources referenced via `url()` in `@page` rules fail silently in headless mode (must use base64 data URIs)
- No CSS `page-margin-box` support for running headers/chapter titles per page (a feature Prince XML and WeasyPrint support). Workaround: use Puppeteer's `headerTemplate`/`footerTemplate` instead.

**EPUB via in-Worker generation:**

- EPUB is a ZIP file containing XHTML, CSS, and an OPF manifest. No rendering engine needed.
- `JSZip` is proven in Cloudflare Workers (community examples using it with R2)
- Build OPF, NCX (nav), and per-chapter XHTML from the same HTML source
- `epub-gen-memory` is a candidate library (generates EPUB 2/3 from HTML, uses JSZip internally, TypeScript, browser-compatible), but may need vetting for Workers edge cases. A thin custom implementation using JSZip directly is lower-risk.

#### Option B: External PDF service (DocRaptor/Prince XML API) + in-Worker EPUB

Use an external API that runs Prince XML (DocRaptor) or WeasyPrint for PDF generation. Build EPUB in-Worker as in Option A.

**DocRaptor (Prince XML under the hood):**

- Best CSS paged media engine available. Full `@page` margin boxes, running headers, proper widows/orphans, OpenType features.
- No document size limit. Book-length manuscripts handled.
- Pricing: $15/month for 125 documents, $0.12/document overage. Unlimited free watermarked test documents.
- Latency: external HTTP call from Worker to DocRaptor API, plus Prince rendering time. 10-20 seconds for a book is realistic.
- Dependency on external service availability.

#### Option C: Client-side PDF generation (browser `window.print()` or jsPDF)

Generate PDF in the user's browser rather than on the server.

**`window.print()` / Save as PDF:**

- Uses the browser's native print engine. iPad Safari supports "Save as PDF" from the share sheet.
- Print stylesheet approach: inject `@media print` CSS with book layout.
- Quality varies dramatically by browser and OS version. iPad Safari's print output is not configurable (no custom page size, limited CSS paged media support).
- No programmatic control over output. User must navigate print dialogs.
- Cannot produce consistent, professional output across devices.

**jsPDF / html2pdf.js:**

- Canvas-based rendering with severe quality issues for book-length documents.
- HTML5 canvas max height limit causes blank PDFs for long content.
- CSS fidelity problems: ignores external stylesheets, struggles with complex layouts.
- Performance throttling on iPad for large canvas operations.
- Disqualified for book-length content.

#### Option D: Dedicated export microservice (separate Worker or external server)

Run a separate Cloudflare Worker or VPS with WeasyPrint/wkhtmltopdf/Puppeteer for PDF generation.

- WeasyPrint is Python-only. Cannot run in Workers. Would require a VPS or container.
- A separate Worker using Browser Rendering is functionally identical to Option A (same Chromium engine).
- VPS adds operational complexity, cost, and an availability concern for a Phase 0 product.
- Overengineered for current scale (5-10 test users).

## Decision

**Option A: Cloudflare Browser Rendering (REST API) for PDF + custom in-Worker EPUB generation using JSZip.**

### PDF Generation

Use the Browser Rendering `/pdf` REST API endpoint. The Worker assembles a complete HTML document from chapter content (fetched from R2 cache), wraps it in a print-optimized stylesheet, and POSTs to the `/pdf` endpoint. The response is a PDF binary stored in R2.

**Why Browser Rendering over DocRaptor:**

1. **Same platform, no external dependency.** Browser Rendering is a Cloudflare product. It shares the same account, billing, and operational model. No new vendor relationship for Phase 0.

2. **Cost structure is better for our usage pattern.** At $0.09/hour and assuming ~15 seconds per PDF render, each export costs roughly $0.000375. DocRaptor at $0.12/document is 320x more expensive per export. During Phase 0 validation with 5-10 users, the difference is negligible in absolute terms, but the cost trajectory matters.

3. **Chromium's PDF quality is sufficient for Phase 0.** We need: custom page size (5.5" x 8.5"), serif font, chapter page breaks, page numbers, title page, table of contents. Chromium handles all of these. We do not need: running headers with chapter titles per page, widows/orphans control, advanced OpenType features. Those are Phase 3 concerns. The PRD's own competitive positioning says "Be adequate on export (looks like a book, not a web page)." Chromium meets that bar.

4. **DocRaptor is the identified fallback.** If Browser Rendering produces unacceptable output during implementation, DocRaptor is a known good option with Prince XML's superior rendering. The architecture supports swapping the PDF backend by changing a single service implementation (the `ExportService` calls a `PdfGenerator` interface, not Cloudflare APIs directly).

**Why not client-side:** Professional output requires server-side control. iPad Safari's print engine is not configurable. jsPDF fails on book-length documents. The user experience of "tap Export, get a download link" is far superior to "tap Export, navigate print dialog, configure settings, save to Files."

### EPUB Generation

Build EPUB 3.0 files directly in the Worker using JSZip. No external service needed.

**Why custom implementation over epub-gen-memory:**

- `epub-gen-memory` pulls in `htmlparser2` and image download logic we do not need (chapter HTML is already clean Tiptap output, images are not in Phase 0 scope)
- EPUB structure is well-specified and simple: a ZIP containing `mimetype`, `META-INF/container.xml`, `content.opf`, `toc.xhtml`, per-chapter XHTML files, and a CSS stylesheet
- A custom implementation with JSZip is ~200-300 lines of code, fully under our control, zero dependency risk on Workers runtime
- JSZip is confirmed working in Cloudflare Workers (community examples with R2)

### PDF vs EPUB Priority (Resolving Issue #41)

**PDF is the priority. Both ship, but if one must be deferred, defer EPUB.**

Rationale:

1. **The target user's workflow is PDF.** Both personas (Diane and Marcus) share drafts with colleagues, beta readers, and editors. The universal exchange format for "read this chapter and tell me what you think" is PDF. Nobody sends an EPUB to a colleague. EPUB is for final distribution to e-readers and bookstores -- a Phase 3 concern.

2. **The "this is a real book" moment requires PDF.** PRD Risk #1 says the biggest danger is Phase 0 feeling like "Google Docs + ChatGPT." The antidote is the export moment: the user taps Export and receives a formatted document that looks like a book. That document is a PDF. An EPUB opened in Apple Books achieves the same emotional effect, but the friction of finding and opening an EPUB file on an iPad is higher than tapping a PDF link.

3. **EPUB is technically simpler and lower risk.** EPUB generation is pure data assembly (ZIP of XHTML files). It does not depend on an external rendering service. If PDF works, EPUB certainly works. The reverse is not true. Therefore, the implementation risk lives in PDF, and that is where effort should concentrate first.

4. **The PM's original fallback ("EPUB-only if PDF fails") misidentifies the user need.** A user who exports EPUB-only will not share it with their editor. They will open it in Apple Books, think "cool," and then ask "but how do I send this to someone?" The validation signal from export requires a shareable format. PDF is that format.

**Decision: Ship both. Implement PDF first. If Browser Rendering proves inadequate during the implementation spike, escalate to DocRaptor rather than falling back to EPUB-only.**

### Architecture

```
User taps "Export Book as PDF"
       |
       v
  POST /projects/:projectId/export { format: "pdf" }
       |
       v
  ExportService.startExport()
       |
       +---> Create export_jobs row (status: 'processing')
       |
       +---> Fetch all chapter content from R2 (sequential, memory-safe)
       |
       +---> Assemble full HTML document with print stylesheet
       |
       +---> Branch by format:
       |
       +---> PDF: POST to Browser Rendering /pdf REST API
       |          - html: assembled document
       |          - addStyleTag: print CSS
       |          - pdfOptions: { format: custom 5.5x8.5, margins, preferCSSPageSize }
       |          - headerTemplate/footerTemplate: page numbers
       |
       +---> EPUB: Assemble EPUB 3.0 ZIP via JSZip
       |           - mimetype, container.xml, content.opf
       |           - toc.xhtml (navigation)
       |           - Per-chapter XHTML with shared stylesheet
       |
       +---> Store result in R2: exports/{job_id}.{format}
       |
       +---> Update export_jobs (status: 'completed', r2_key)
       |
       +---> Return signed R2 URL (1-hour expiry)
```

### HTML Book Template (Shared)

A single HTML+CSS template drives both PDF and EPUB output. The template produces:

1. **Title page** -- book title, author name (from user profile), generation date
2. **Table of contents** -- chapter titles as links (full-book export only)
3. **Chapter pages** -- chapter title as H1, body content, page break before each chapter
4. **Page numbers** -- via `footerTemplate` (PDF) or reading system (EPUB)

```css
/* Core print stylesheet (PDF) */
@page {
  size: 5.5in 8.5in;
  margin: 0.875in 0.75in 1in 0.75in;
}

@page :first {
  margin-top: 2.5in;
}

body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 11pt;
  line-height: 1.5;
  color: #1a1a1a;
}

h1.chapter-title {
  font-size: 24pt;
  margin-top: 2in;
  margin-bottom: 0.5in;
  page-break-before: always;
  page-break-after: avoid;
}

h1.chapter-title:first-of-type {
  page-break-before: avoid;
}

p {
  text-indent: 0.25in;
  margin: 0;
  orphans: 3;
  widows: 3;
}

p:first-of-type,
h1 + p,
h2 + p,
h3 + p,
blockquote + p {
  text-indent: 0;
}

blockquote {
  margin: 1em 0.5in;
  font-style: italic;
  page-break-inside: avoid;
}
```

### Memory Management for Book-Length Documents

A 50,000-word manuscript is approximately 300-400 KB of HTML. With the print stylesheet and assembled HTML document, the total payload to Browser Rendering is well under 5 MB. The 128 MB Worker memory limit and 50 MB Browser Rendering request limit are not concerns.

Chapters are fetched from R2 sequentially (not all at once) and concatenated into a single HTML string. Peak memory usage is the assembled document plus the PDF/EPUB binary response, estimated at 5-15 MB for a full book.

## Consequences

### Positive

- Both PDF and EPUB ship in Phase 0, covering the two primary export needs
- PDF uses Cloudflare's own infrastructure -- no external vendor dependency
- EPUB is self-contained in the Worker with zero external calls
- Single HTML+CSS template produces consistent output across both formats
- Browser Rendering cost is negligible at Phase 0 scale (~$0.0004 per PDF)
- Architecture supports swapping the PDF backend (DocRaptor, Prince) without changing the rest of the export pipeline
- EPUB generation has no external dependency and no rendering latency

### Negative

- Browser Rendering is a relatively new Cloudflare product (GA with pricing since July 2025). Stability at scale is unproven for our use case.
- Chromium's CSS paged media support has documented quirks (headless vs headed inconsistencies, silent failures for `url()` in `@page` rules)
- No running chapter-title headers in PDF (Chromium limitation). Acceptable for Phase 0; Phase 3 could adopt DocRaptor/Prince for professional templates.
- `orphans`/`widows` CSS properties have inconsistent Chromium support. Text may break awkwardly in rare cases.

### Implementation Plan

**3-day spike (as recommended by PRD ADR-004 section):**

1. **Day 1:** Design and build the HTML+CSS book template. Test it in a local browser's print preview to validate layout before involving Browser Rendering. Build the EPUB assembler with JSZip.

2. **Day 2:** Wire up Browser Rendering REST API integration. Test PDF output quality for: title page, TOC, chapter breaks, page numbers, serif typography, 5.5x8.5 page size. Test with a 10-chapter, 50K-word document for performance and memory.

3. **Day 3:** Wire up the full export flow (`ExportService`, R2 storage, signed URL generation, `export_jobs` tracking). Test EPUB validity with [EPUBCheck](https://www.w3.org/publishing/epubcheck/). If PDF quality is unacceptable, prototype DocRaptor integration as fallback.

**Acceptance criteria for PDF quality:**

- Title page renders with book title and author name
- Table of contents lists all chapters
- Each chapter starts on a new page with the chapter title
- Page numbers appear in footer
- Serif font at readable size on US Trade page dimensions
- No text cutoff, overflow, or blank pages
- 10-chapter book generates in under 30 seconds

**Wrangler configuration change:**

No `browser` binding needed for the REST API approach. The Worker calls the Browser Rendering REST API via `fetch()` to the account-scoped endpoint. This avoids adding a new binding to `wrangler.toml`.

### What We Are NOT Doing

- Custom PDF templates or user-configurable styles (Phase 3)
- Cover page image generation (Phase 3)
- Running chapter-title headers (Phase 3, requires Prince/DocRaptor)
- Image support in exports (no images in Phase 0 editor)
- Offline export capability
- EPUB distribution integration (KDP, Draft2Digital -- Phase 3+)

## References

- [Issue #41](https://github.com/venturecrane/dc-console/issues/41) -- Decision: PDF vs EPUB priority
- PRD Section 8: US-019 (PDF), US-020 (EPUB), US-021 (Save to Drive), US-022 (Download)
- PRD Section 5, Principle 5: "Publishing Is a Button, Not a Project"
- PRD Section 13: Performance budget (PDF < 30s, EPUB < 10s)
- PRD Risk #7: "PDF/EPUB export looks unprofessional"
- [Cloudflare Browser Rendering /pdf endpoint](https://developers.cloudflare.com/browser-rendering/rest-api/pdf-endpoint/)
- [Cloudflare Browser Rendering pricing](https://developers.cloudflare.com/browser-rendering/pricing/)
- [Cloudflare Browser Rendering limits](https://developers.cloudflare.com/browser-rendering/limits/)
- [DocRaptor pricing](https://docraptor.com/) -- identified fallback
- [JSZip with Cloudflare Workers](https://github.com/aabedraba/jszip-workers-r2)
- [EPUB 3.0 specification](https://www.w3.org/TR/epub-33/)
- [Chromium CSS @page limitations](https://andre.arko.net/2025/05/25/chrome-headless-print-to-pdf/)
- [CSS paged media for book layout](https://www.smashingmagazine.com/2015/01/designing-for-print-with-css/)
- ADR-005: Content Storage Architecture (R2 as content cache)
