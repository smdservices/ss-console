# ADR-001: Editor Library Selection

## Status

**Accepted** - 2025-02-10
**Reaffirmed** - 2026-02-24

## Context

DraftCrane requires a rich text editor for chapter content editing. The PRD identifies this as Risk 3 (High Likelihood, Critical Impact): "Editor fails on iPad Safari. Rich text editing in mobile Safari is fragile."

**Key constraints:**

- iPad Safari is the primary test target (PRD Principle 1)
- Input latency under 100ms required
- Must work with virtual keyboard (40-50% screen consumption)
- Paste from Google Docs must preserve formatting
- Bundle budget: ~200KB lazy-loaded acceptable

**Options evaluated:**

1. **Tiptap** - ProseMirror-based, ~150KB, best iPad Safari track record
2. **Lexical** - Meta, ~30KB, less iPad battle-tested
3. **Plate** - Slate-based, known iOS issues

## Decision

**Use Tiptap (ProseMirror-based).**

### Rationale

1. **iPad Safari reliability is non-negotiable.** ProseMirror has a decade of mobile Safari battle-testing. Tiptap's changelogs show active iPad/iPadOS detection fixes through 2024-2025.

2. **Lexical has disqualifying Safari issues:**
   - Input latency problems persisting after standard fixes (GitHub #5683)
   - Zoom-level rendering bugs
   - iOS native version is "pre-release with no guarantee of support"

3. **Slate/Plate is eliminated:**
   - September 2024 bug: holding backspace on iOS Safari breaks editor entirely (GitHub #5711)
   - FAQ explicitly states iOS is "not regularly tested"

4. **Bundle size tradeoff is acceptable.** Lexical saves ~30-50KB gzipped, but reliability on the primary platform outweighs bundle savings.

## Consequences

### Positive

- Battle-tested iPad Safari support
- Rich extension ecosystem for future features
- Active maintenance and community
- Excellent TypeScript support
- Built-in collaborative editing primitives (future)

### Negative

- Larger bundle (~150KB vs ~30KB for Lexical)
- ProseMirror learning curve for deep customization
- Must implement custom paste handler for Google Docs

### Known Issues & Mitigations

| Issue                                               | Mitigation                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| Virtual keyboard toolbar positioning (Tiptap #6571) | Use `visualViewport` API + `interactive-widget=resizes-content` viewport meta |
| Google Docs paste uses inline styles                | Custom paste handler transforms to semantic marks                             |

## Implementation Notes

### Package Installation

```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder
```

### Required Extensions

```typescript
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

// StarterKit includes: Bold, Italic, Heading, BulletList, OrderedList, Blockquote, History
```

### Viewport Meta Tag

Add to `app/layout.tsx`:

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, interactive-widget=resizes-content"
/>
```

### Virtual Keyboard Handling

```typescript
useEffect(() => {
  if (typeof window !== 'undefined' && window.visualViewport) {
    const viewport = window.visualViewport
    const handleResize = () => {
      const keyboardHeight = window.innerHeight - viewport.height
      document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`)
    }
    viewport.addEventListener('resize', handleResize)
    return () => viewport.removeEventListener('resize', handleResize)
  }
}, [])
```

### Google Docs Paste Handler

Google Docs wraps content in `<b id="docs-internal-guid-...">` with inline styles. Implement a custom paste handler:

```typescript
const handlePaste = (view: EditorView, event: ClipboardEvent) => {
  const html = event.clipboardData?.getData('text/html')
  if (html?.includes('docs-internal-guid')) {
    // Transform Google Docs HTML to semantic marks
    // See implementation in editor component
  }
  return false // Let Tiptap handle normal paste
}
```

### 8-Point iPad Safari Test Protocol

Before shipping, verify on physical iPad (Air 5th gen+, iPadOS 17+):

1. [ ] Type 500 words without cursor jumping
2. [ ] Apply/remove all formatting (bold, italic, headings, lists, blockquote)
3. [ ] Undo/redo 10+ operations
4. [ ] Paste from Google Docs, verify formatting preserved
5. [ ] Virtual keyboard: cursor stays visible when typing at bottom
6. [ ] Portrait → landscape → portrait: no content loss
7. [ ] Background tab for 30s, return: no state corruption
8. [ ] Input latency feels instant (< 100ms perceived)

Score each 1-5. Minimum passing: no item below 3, average >= 4.

## 2026 Landscape Review

Reviewed 2026-02-24 to determine whether any changes to the ecosystem warrant reconsidering this decision.

### Tiptap (current choice)

- **Version:** v3.19 in our repo, v3.20 latest (released 2026-02-18)
- **Trajectory:** Steady v3.x releases throughout 2025-2026. Also maintaining 2.x LTS (v2.27.2, Jan 2026).
- **Licensing improved:** 10 formerly-paid Pro extensions open-sourced under MIT. Paid tier now only covers cloud services (collaboration, AI, comments). Core remains MIT.
- **Community:** 35K+ GitHub stars, ~2,900 contributors, frequent releases.
- **iPad Safari:** No regressions reported. ProseMirror foundation continues to receive mobile Safari fixes.
- **Integration depth:** 11 files, 26 import references, plus custom footnote extensions (`web/src/extensions/`).

### Lexical

- **Version:** v0.40 (still pre-1.0 after 2+ years)
- **Safari issue #5683: STILL OPEN.** Last activity Oct 2025. Confirmed reproducing in v0.37. Root cause identified as Safari's line-wrapping performance with long lines — not strictly a Lexical bug, but no workaround exists.
- **Verdict:** Still disqualified for an iPad-first product.

### Slate/Plate

- **Version:** Slate v0.123 (Jan 2026)
- **iOS backspace bug #5711: STILL OPEN.** Last activity Nov 2024. Holding backspace on iOS Safari still breaks the editor entirely. Multiple related iOS issues remain.
- **Verdict:** Still disqualified.

### New Entrants

| Library                          | Notes                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| **BlockNote** (v0.47, Feb 2026)  | Block-based editor built _on top of Tiptap/ProseMirror_. Additive, not a replacement. |
| **Novel**                        | Also built on Tiptap + Vercel AI SDK. Same foundation.                                |
| **Quill 2.0** (Apr 2024 rewrite) | Used by Slack/LinkedIn/Figma but not targeting iPad-first use cases.                  |
| **LexKit**                       | Type-safe wrapper around Lexical. Inherits Lexical's Safari issues.                   |

No new library challenges ProseMirror's mobile Safari reliability. The ecosystem is consolidating around ProseMirror — BlockNote and Novel both chose Tiptap as their foundation.

### Platform Note

iPadOS 26 Safari has reported platform-level bugs (page freezes, fixed positioning inconsistencies). These affect all editors equally and are not a reason to switch. Worth monitoring during iPad testing.

### Conclusion

**Decision reaffirmed.** The original disqualifying issues in both alternatives remain unfixed a year later. Tiptap's position has strengthened (better licensing, active development, no regressions). No new contender offers better iPad Safari reliability.

## References

- [Tiptap Documentation](https://tiptap.dev/docs)
- [Tiptap GitHub #6571 - Virtual Keyboard](https://github.com/ueberdosis/tiptap/issues/6571)
- [Lexical GitHub #5683 - Safari Performance](https://github.com/facebook/lexical/issues/5683)
- [Slate GitHub #5711 - iOS Backspace](https://github.com/ianstormtaylor/slate/issues/5711)
- PRD Section 14: iPad-First Design Constraints
- PRD Section 17: Risk 3
