# DraftCrane - Design Brief: The Author/Editor Metaphor

> Synthesized from 1-round, 4-role design brief process. Generated 2026-02-24.
> Design Maturity: Tokens defined
> Scope: How DraftCrane establishes the Author/Editor collaboration — from landing page through onboarding, toolbar, Editor panel, and the core rewrite interaction. Includes toolbar touch target and contrast remediation.

## Table of Contents

1. Product Identity
2. Brand Personality & Design Principles
3. Target User Context
4. Visual Language
5. Screen Inventory & Key Screens
6. Interaction Patterns
7. Component System Direction
8. Technical Constraints
9. Inspiration & Anti-Inspiration
10. Design Asks
11. Open Design Decisions

---

## 1. Product Identity

### The Core Relationship

Every nonfiction book that reaches a bookshelf is the product of two people: the **Author**, who has the expertise and writes the manuscript, and the **Editor**, who reviews, refines, shapes, and strengthens that manuscript. The Author writes. The Editor reads what the Author wrote and makes it better. The Author always has the final say.

DraftCrane embodies this relationship:

- **The Author** = the user. Every consultant, coach, and academic who opens DraftCrane to write their book. They own the words, the manuscript, and every decision.
- **The Editor** = DraftCrane's AI capability. It reads what the Author wrote, offers suggestions for how to make it stronger, and waits for the Author to accept or reject every change.

This is not branding on top of technology. This is the actual product architecture. The AI never writes autonomously. The AI never applies changes without approval. The AI reads the Author's text, proposes a rewrite, and the Author decides. That is what editors do.

### What the Editor Is Not

- **Not a chatbot.** No conversation thread, no message history, no "How can I help?" The Author selects text, gives an instruction, receives a rewrite.
- **Not a character.** No name, no persona, no "I" or "we" in the interface. The Editor is the editing function, not an entity. (Exception: the empty-state introduction — see Open Design Decision #1.)
- **Not a feature to be sold.** The toolbar says "Editor," not "AI Editor" or "Smart Rewrite." The Design Charter's Invisible Technology principle applies: the Author sees the action (rewrite, tighten, expand), not the mechanism (AI, model, processing).

### Settled Vocabulary (Non-Negotiable)

| Term         | Meaning                                                   | Usage                         |
| ------------ | --------------------------------------------------------- | ----------------------------- |
| **Source**   | A repository/provider (Google Drive, local storage)       | "Connect a source"            |
| **Folder**   | A directory within a source                               | "Browse folders"              |
| **Document** | A specific file                                           | "Add documents"               |
| **Library**  | The right-panel browsing view for all connected documents | Toolbar label, tab name       |
| **Desk**     | The tab for documents tagged to the current chapter       | Tab name within Library panel |
| **Editor**   | The AI editorial collaborator                             | Toolbar label, panel identity |
| **Chapter**  | A unit of the book                                        | View toggle label             |
| **Book**     | The full manuscript                                       | View toggle label             |

These terms are embedded in the product architecture, the Design Charter's spatial model, and the codebase. They are not up for revision.

---

## 2. Brand Personality & Design Principles

### How the Metaphor Shapes Brand Voice

The five personality traits from the Design Charter apply directly to the Editor's presence:

| Trait             | Applied to the Editor                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calm**          | The Editor does not announce itself. It does not flash or pulse when it has a suggestion. It is available when the Author reaches for it, silent when the Author is writing. An editor who interrupts is a bad editor.            |
| **Knowledgeable** | The Editor speaks in publishing vocabulary. "Rewrite" is what editors do. "Tighten" is what editors do. "Strengthen the opening" is what editors do. "Process your text with an AI model" is what no editor has ever said.        |
| **Honest**        | The Editor does not pretend to be human. It is a capability, not a character. The product never says "your AI editor thinks..." It says "Rewrite" and shows the result.                                                           |
| **Warm**          | Warmth is in the restraint: the Editor waits. It does not nag, track, or score. Its presence is felt through the violet accent color, the spatial position (left panel), and the quality of its suggestions.                      |
| **Focused**       | The Editor does one thing in the current product: rewrite selected text according to the Author's instruction. Scope expands later (Book Editor, style analysis), but each expansion earns its place through the same discipline. |

### Design Principles Applied to the Metaphor

1. **Writing Comes First.** The Author's words are always in the center. The Editor is in a side panel (left). The spatial hierarchy communicates authority: the Author's space is the main stage; the Editor's space is the wing.

2. **Show the Work.** When streaming a rewrite, the Author watches the text appear word by word. No black box. The Author sees exactly what the Editor is proposing before making any decision.

3. **Respect the Surface.** On iPad landscape, the Editor panel slides in as a persistent 320px panel. On portrait, it becomes an overlay. In both cases, the Author can still see their writing.

4. **Spatial Consistency.** Editor on the left. Library on the right. Writing in the center. This maps to the collaboration: the Editor sits beside the Author (left), reference materials on the other side (right), manuscript on the desk between them (center).

5. **Invisible Technology.** "Editor" is a publishing role. "Rewrite" is a publishing action. The Author gives directions using the vocabulary they would use with a human editor at a publishing house.

6. **Progressive Disclosure.** The Editor reveals itself when the Author is ready. The toolbar button is visible from the start, but the Editor panel does not open automatically. Each layer of capability reveals itself through the Author's actions.

7. **Nothing Precious.** The Editor's suggestions are disposable. Tap "Discard" and the suggestion vanishes. No confirmation dialog. Real editors have their suggestions rejected constantly.

---

## 3. Target User Context

> The following is synthesized from the Target User persona (Diane Mercer, 52, leadership consultant, Austin, TX). Her reactions are in first person.

### The Emotional Landscape

**"I know what an editor is. Not a text editor — an editor. A person."** Diane's friend Laura published a book with a real editor at a publishing house. Laura talks about her editor the way some people talk about a great therapist. Diane does not have that. She has a Google Doc and determination. The idea that DraftCrane might give her something even partway there makes her emotional — not because she thinks software can replace a human editor, but because the loneliest part of writing a book is having nobody to show it to who will tell you the truth.

### The Three Layers of Reaction to "Editor"

1. **The word itself.** First encounter with "Editor" in the toolbar triggers confusion. "I am already in the editor. What does an Editor button do?" The word, with no introduction, reads as a software term.

2. **The concept.** When the Author/Editor metaphor is explained, something shifts. "I do not want an 'AI rewriting tool.' I want someone who reads my writing and helps me make it better. The word 'editor' carries weight in the writing world."

3. **The fear.** "If DraftCrane calls the AI my 'Editor' and then the experience feels like autocorrect with better vocabulary, the metaphor will backfire. Hard. Because you have raised my expectations."

### What Makes an Editor Feel Like a Collaborator

- **Remembers context.** "If the Editor could show some awareness of the rest of my book — even a small awareness — it would feel dramatically more like a collaborator."
- **Has an opinion.** "'Here is a rewrite' feels like a tool. 'I tightened the argument and cut the redundant setup' feels like a collaborator."
- **Waits patiently.** "The empty state should feel like a person sitting across the table, not like a search bar waiting for input."
- **Does not perform.** "The worst thing the Editor could do is be enthusiastic. A real editor does not perform enthusiasm. A real editor treats the work with respect."
- **Is consistent.** "If the Editor is warm and contextual one time and robotic the next, the illusion breaks."

### The Bottom Line

**"'Editor' is a better word than 'Rewrite' or 'AI Tool' or anything else I can think of. It is the right aspiration. But it needs to be introduced carefully, and the experience behind the button needs to earn the title."**

**"If 'Editor' is just a label on a rewrite button, please change it to 'Rewrite.' Because borrowing the weight of that word without earning it is worse than never using it at all."**

---

## 4. Visual Language

### Two-Accent Color System: Blue = Author, Violet = Editor

The two-accent color architecture is the visual language of the Author/Editor relationship. It communicates the spatial model, the authority structure, and the collaboration dynamic without a single word.

| Accent      | Hex                   | Token                                                         | Represents          | Spatial Position                                           |
| ----------- | --------------------- | ------------------------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| **Blue**    | `#2563eb`             | `--dc-color-interactive-primary`                              | The Author's domain | Right panel (Library), navigation, user-initiated actions  |
| **Violet**  | `#7c3aed`             | `--dc-color-interactive-escalation`                           | The Editor's domain | Left panel (Editor), rewrite actions, AI-generated content |
| **Neutral** | `#ffffff` / `#f9fafb` | `--dc-color-surface-primary` / `--dc-color-surface-secondary` | The manuscript      | Center writing surface                                     |

**Blue for the Author's domain.** Blue is used for the Author's actions throughout the product: sidebar navigation, chapter selection, Library panel activation, links, focus rings. When the Library button turns blue, the Author sees "my documents are showing."

**Violet for the Editor's domain.** Violet is used exclusively for AI-assisted actions. The Editor panel header, the instruction chips, the streaming response, the "Use This" button. When the Editor button turns violet, the Author sees "my editor is active."

**Neutral for the manuscript.** The writing surface is white. No color intrusion. The manuscript is the sacred space where neither the Author's navigation tools nor the Editor's suggestions have permanent presence.

### Color in the Toolbar

| Button      | Idle State                                     | Active State                                             | Communicates               |
| ----------- | ---------------------------------------------- | -------------------------------------------------------- | -------------------------- |
| **Editor**  | Gray text (`--dc-color-text-muted`, `#6b7280`) | Violet text on violet-subtle bg (`#7c3aed` on `#f5f3ff`) | "My editor is here"        |
| **Library** | Gray text (`--dc-color-text-muted`, `#6b7280`) | Blue text on blue-subtle bg (`#1d4ed8` on `#eff6ff`)     | "My documents are showing" |

### New Token Additions

| Token                                      | Hex       | Role                                                                                                |
| ------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------- |
| `--dc-color-interactive-primary-on-subtle` | `#1d4ed8` | Blue text on blue-subtle backgrounds (5.9:1 on `#eff6ff`). Fixes contrast for Library active state. |
| `--dc-color-text-primary`                  | `#111827` | High-emphasis text (17.4:1 vs white). Headings and prominent labels.                                |
| `--dc-color-surface-tertiary`              | `#f3f4f6` | Toggle track, hover backgrounds. Replaces hardcoded `bg-gray-100`.                                  |
| `--dc-color-surface-primary`               | `#ffffff` | Toggle indicator, panel backgrounds. Explicit token enables dark mode.                              |

All 15 existing `--dc-` color tokens are preserved without modification.

### Typography

| Role               | Font       | Where                                                                             | Communicates        |
| ------------------ | ---------- | --------------------------------------------------------------------------------- | ------------------- |
| **UI Sans**        | Geist Sans | Toolbar, sidebar, panels, all interactive elements                                | Professional tool   |
| **Literary Serif** | Lora       | Book/chapter titles (prominent contexts), logotype, landing page headline, export | This is about books |
| **UI Mono**        | Geist Mono | Word counts, numeric displays                                                     | Tabular data        |

The separation reinforces the metaphor: the manuscript (Lora headings, generous whitespace) is the Author's creative work. The panels and toolbar (Geist Sans, functional spacing) are the workspace where Author and Editor collaborate.

---

## 5. Screen Inventory & Key Screens

### The Author/Editor Metaphor Establishment Journey

The metaphor flows through six layers, from first contact to core interaction:

| Layer | Touchpoint                       | Metaphor Signal                                                                                               | Risk Level                |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1     | **Landing page**                 | First mention of "editor" as a publishing role. "Write your book with an editor who never sleeps."            | Low                       |
| 2     | **Book setup**                   | No metaphor signal. The Editor is not relevant until the Author has something written.                        | None                      |
| 3     | **Onboarding step 4**            | "Your Editor is here." Introduces the Editor as a collaborator, connecting the concept to the toolbar button. | **Medium** — hinge moment |
| 4     | **Editor panel empty state**     | The Editor's introduction. Calm, brief, first-person (if decided — see Open Decision #1).                     | **High** — make-or-break  |
| 5     | **First rewrite result**         | The Editor's work. Streaming text, action buttons. The interaction teaches the collaboration dynamic.         | **Medium**                |
| 6     | **Chapter Editor / Book Editor** | Future differentiation. Same "Editor" button, different scope based on view mode.                             | Low (future)              |

### Landing Page Copy

**Current tagline area:**

```
Write your book.
Keep your files.
Get AI help when you need it.
```

**Recommended:**

```
Write your book.
Keep your files.
Work with an Editor who gets it.
```

**Current description:**

> A quiet place to write and organize your nonfiction book, chapter by chapter. When you are ready, export to PDF or EPUB. Your chapters stay in your Google Drive, always yours.

**Recommended:**

> A quiet place to write your nonfiction book, chapter by chapter. When your prose needs tightening, your Editor is one tap away — select text, ask for a rewrite, and decide what stays. Your chapters live in your Google Drive, always yours.

The word "Editor" appears once, attached to human-like actions (tightening prose, offering rewrites). The user reads "Editor" as a publishing role before they ever see the toolbar button. "Decide what stays" reinforces Author authority.

### Onboarding Tooltip Redesign

| Step | Current                                                                     | Recommended                                                                           | Rationale                                                                                                                                               |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | "This is your chapter. Start writing here, or paste what you already have." | No change.                                                                            | Correct. Establishes Author ownership.                                                                                                                  |
| 2    | "Use the sidebar to switch between chapters or add new ones."               | "Your chapters live here. Switch between them, add new ones, or drag to reorder."     | "Your chapters live here" is spatial ("where") not mechanical ("how"). Surfaces drag-to-reorder.                                                        |
| 3    | "Add documents from Google Drive or your device."                           | "Your documents are here — anything you have added from Google Drive or your device." | Orients instead of instructs. The panel's own empty state handles the call-to-action.                                                                   |
| 4    | "Select any text to get AI suggestions for rewriting."                      | "Your Editor is here. Select any text, then tap Editor for a rewrite."                | The critical revision. "Your Editor" introduces a collaborator, not a feature. Drops "AI" per Invisible Technology. Connects concept to toolbar button. |

Step 4 visual detail: the word "Editor" in the tooltip copy should use the violet accent color (`--dc-color-interactive-escalation`) with `font-medium`, creating a visual link between the tooltip text and the toolbar button it references.

---

## 6. Interaction Patterns

### Flow 1: First Rewrite (Author Meets the Editor)

The most important flow in the product. Establishes the collaboration dynamic.

| Step | Author Action                                          | System Response                                                                                               | Timing            |
| ---- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1    | Selects a paragraph                                    | Native iPadOS selection handles appear                                                                        | Instant           |
| 2    | —                                                      | Floating action bar appears below selection: "Rewrite" button                                                 | 200ms fade-in     |
| 3    | Taps "Rewrite" in floating bar                         | Editor panel slides open from left. Selected text appears. Instruction chips visible. Floating bar dismisses. | 200ms panel slide |
| 4    | Taps "More concise" chip (or types custom instruction) | Chip highlights in violet. Streaming begins. Header shows "Rewriting..." with spinner.                        | First token < 2s  |
| 5    | Reads the streaming response                           | Text streams word by word                                                                                     | 5-15s total       |
| 6    | Streaming completes                                    | Header changes to "Here is a rewrite." Action buttons appear: Discard, Try Again, Use This.                   | Instant           |
| 7a   | Taps "Use This"                                        | Rewritten text replaces selection. Brief violet highlight flash (300ms). Panel resets.                        | 300ms             |
| 7b   | Taps "Try Again"                                       | Instruction field editable. New streaming begins.                                                             | < 2s              |
| 7c   | Taps "Discard"                                         | Panel resets. Original text untouched.                                                                        | Instant           |

**Key detail:** Tapping "Rewrite" in the floating bar opens the Editor panel if it is not already open. The floating bar serves as a contextual entry point that always leads to the Editor panel.

### Editor Panel Empty State

**Current:**

```
[pencil icon]
Select text in your chapter to start rewriting.
```

**Recommended:**

```
[sparkles icon, 24px, violet muted]

Ready when you are.

Select text in your chapter, then choose
an instruction or write your own.
```

"Ready when you are" gives the Editor a voice — calm, not eager. The icon changes from pencil (which signals "edit" — what the writing area already does) to sparkles (which signals "transformation").

See **Open Design Decision #1** for whether the empty state should use first-person voice ("I am your Editor").

### Editor Panel Header

The panel header should read **"Chapter Editor"** — maintaining the distinction between chapter-level and book-level editorial assistance. When Book Editor ships in the future, the header will change based on view mode:

- Chapter view: "Chapter Editor"
- Book view: "Book Editor"

The toolbar button stays "Editor" in both contexts. The panel header specifies which Editor is active.

### Streaming Response Headers

| State                   | Header Text                     | Style                         |
| ----------------------- | ------------------------------- | ----------------------------- |
| Streaming               | "Rewriting..."                  | Violet, with spinner          |
| Complete, first attempt | "Here is a rewrite."            | Violet, no spinner            |
| Complete, retry         | "Here is another take."         | Violet, attempt number        |
| Error                   | "Could not finish the rewrite." | Error color, retry affordance |

### State Matrix

Three independent state dimensions: View mode (Chapter/Book) x Editor panel (Open/Closed) x Library panel (Open/Closed) = 8 valid states. All eight are valid; no combinations prohibited.

### Animation Timing

| Transition                | Duration | Easing      | Spec                                 |
| ------------------------- | -------- | ----------- | ------------------------------------ |
| Toggle indicator slide    | 200ms    | ease-in-out | Charter: symmetric for state changes |
| Toggle label color/weight | 200ms    | ease-in-out |                                      |
| Panel button active/idle  | 150ms    | ease-in-out |                                      |
| Panel slide in (entrance) | 200ms    | ease-out    | Charter: entrances                   |
| Panel slide out (exit)    | 200ms    | ease-in     | Charter: exits                       |
| View crossfade            | 300ms    | ease-in-out | Existing implementation              |
| Rewrite highlight flash   | 300ms    | ease-out    |                                      |

Maximum animation duration: 300ms. All animations respect `prefers-reduced-motion: reduce` — instant state change, no motion.

### Keyboard Shortcuts

| Context          | Key                  | Action                           |
| ---------------- | -------------------- | -------------------------------- |
| Global           | `Cmd+Shift+E`        | Toggle Editor panel              |
| Global           | `Cmd+Shift+L`        | Toggle Library panel             |
| Global           | `Cmd+Shift+B`        | Toggle Chapter/Book view         |
| Workspace toggle | `ArrowLeft` / `Home` | Select Chapter                   |
| Workspace toggle | `ArrowRight` / `End` | Select Book                      |
| Any panel open   | `Escape`             | Close most recently opened panel |

---

## 7. Component System Direction

### PanelToggleButton Extraction

The two panel toggles share identical structure but diverge in color strategy. The Editor toggle uses semantic tokens; the Library toggle uses hardcoded Tailwind utilities. Both should be extracted into a single `PanelToggleButton` component.

```typescript
interface PanelToggleButtonProps {
  label: string
  icon: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  zone: 'editor' | 'library'
  shortcutHint?: string
}
```

Key implementation decisions:

| Decision          | Value                                   | Rationale                                                                                        |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Touch target      | `min-h-[44px]`                          | Apple HIG / WCAG 2.5.8. Uses `min-h` not `h` to avoid constraining content.                      |
| Label visibility  | `hidden lg:inline`                      | Labels hide below 1024px (landscape breakpoint). Icons + color coding differentiate in portrait. |
| Icon size         | `w-5 h-5` (20px)                        | Increased from current `w-4 h-4` (16px). 20px with 2px stroke suits 44px touch target.           |
| Color transitions | `duration-150 ease-in-out`              | 150ms per animation spec. Symmetric easing per charter.                                          |
| Focus ring        | Blue (`--dc-color-interactive-primary`) | Consistent across both zones. Focus is system-level, not zone-specific.                          |

### Editor Panel Architecture (Future Book Editor)

The panel shell is view-mode agnostic. Content is provided by variant-specific components:

```tsx
<EditorPanel isOpen={isEditorPanelOpen} onClose={closeEditorPanel} variant={viewMode}>
  {viewMode === 'chapter' ? (
    <ChapterEditorContent {...chapterEditorProps} />
  ) : (
    <BookEditorContent {...bookEditorProps} />
  )}
</EditorPanel>
```

No separate `BookEditorPanel` shell component. The shell is structural; the content is behavioral.

### Hardcoded Color Migration

| Location                               | Current                    | Token Replacement                                                                                      |
| -------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `workspace-toggle.tsx`                 | `bg-gray-100`              | `bg-[var(--dc-color-surface-tertiary)]`                                                                |
| `editor-toolbar.tsx` (Library active)  | `bg-blue-50 text-blue-700` | `bg-[var(--dc-color-interactive-primary-subtle)] text-[var(--dc-color-interactive-primary-on-subtle)]` |
| `editor-toolbar.tsx` (Library idle)    | `text-gray-600`            | `text-[var(--dc-color-text-muted)]`                                                                    |
| `settings-menu.tsx`                    | `hover:bg-gray-100`        | `hover:bg-[var(--dc-color-surface-tertiary)]`                                                          |
| `export-menu.tsx`                      | `hover:bg-gray-100`        | `hover:bg-[var(--dc-color-surface-tertiary)]`                                                          |
| `workspace-toggle.tsx` (inactive text) | `text-muted-foreground`    | `text-[var(--dc-color-text-secondary)]`                                                                |

---

## 8. Technical Constraints

### Touch Target Audit (P0)

5 of 7 toolbar interactive elements fail the 44px minimum mandated by Apple HIG and WCAG 2.5.8.

| Element                   | Current                      | Fix                           |
| ------------------------- | ---------------------------- | ----------------------------- |
| WorkspaceToggle container | `h-9` (36px)                 | `h-11` (44px)                 |
| WorkspaceToggle options   | `h-8` (32px), `min-w-[60px]` | `h-10` (40px), `min-w-[72px]` |
| Editor panel toggle       | `h-9` (36px)                 | `min-h-[44px]`                |
| Library panel toggle      | `h-9` (36px)                 | `min-h-[44px]`                |
| ExportMenu trigger        | `h-9` (36px)                 | `min-h-[44px]`                |
| SettingsMenu trigger      | `h-9 w-9` (36x36px)          | `min-h-[44px] min-w-[44px]`   |

The toolbar container height remains `h-12` (48px). All 44px touch targets fit within 48px.

### Contrast Audit (P0)

| Element              | Foreground | Background | Ratio                  | Fix                                                                           |
| -------------------- | ---------- | ---------- | ---------------------- | ----------------------------------------------------------------------------- |
| Toggle inactive text | `#6b7280`  | `#f3f4f6`  | **3.8:1 (FAIL)**       | Use `--dc-color-text-secondary` (`#374151`). New ratio: 9.6:1.                |
| Library active text  | `#2563eb`  | `#eff6ff`  | **4.4:1 (borderline)** | Use `--dc-color-interactive-primary-on-subtle` (`#1d4ed8`). New ratio: 5.9:1. |

**Note:** Editor active state (`#7c3aed` on `#f5f3ff`) is 4.6:1 — passes AA for large text (14px bold qualifies). However, `font-medium` (500 weight) is load-bearing for compliance. If weight is reduced to 400, this pairing fails.

### ARIA Summary

| Component           | Role            | Key Attributes                                                 |
| ------------------- | --------------- | -------------------------------------------------------------- |
| `EditorToolbar`     | `toolbar`       | `aria-label="Editor toolbar"`, `aria-orientation="horizontal"` |
| `WorkspaceToggle`   | `radiogroup`    | `aria-label="View mode"`                                       |
| `ToggleOption`      | `radio`         | `aria-checked`, `aria-label="{label} view"`                    |
| `PanelToggleButton` | `button`        | `aria-pressed`, `aria-label="Open/Close {name} panel"`         |
| `EditorPanel`       | `complementary` | `aria-label="Chapter editor"`                                  |
| Live region         | —               | `aria-live="polite"`, `aria-atomic="true"`                     |

The overlay variant (`EditorPanelOverlay`) uses `role="complementary"`, NOT `role="dialog"` — the design intent is non-modal so users can still select text in the editor.

### Toggle Easing Fix

Current: `transition-transform duration-200 ease-out`
Required: `transition-transform duration-200 ease-in-out` + `motion-reduce:transition-none`

The Design Charter specifies `ease-in-out` for state changes (symmetric easing). The toggle is a state change, not an entrance.

### Responsive Breakpoints

| Name      | Width       | Primary Device              |
| --------- | ----------- | --------------------------- |
| Portrait  | < 1024px    | iPad portrait               |
| Landscape | 1024-1279px | iPad landscape              |
| Desktop   | >= 1280px   | Desktop, iPad Pro landscape |

Panel behavior by breakpoint:

| Breakpoint  | Editor Panel | Library Panel | Both Open                          |
| ----------- | ------------ | ------------- | ---------------------------------- |
| < 1024px    | Overlay      | Overlay       | Both overlay                       |
| 1024-1279px | Persistent   | Persistent    | Second is overlay                  |
| >= 1280px   | Persistent   | Persistent    | Both persistent if center >= 400px |

### Performance

- Toolbar must render in < 2ms on iPad Pro
- `PanelToggleButton` extraction adds ~0.02ms (immeasurable)
- No lazy loading for toolbar icons (above-the-fold, synchronous render required)
- All icons are inline SVGs inheriting `currentColor` for zone-aware coloring
- Toggle height changes fit within existing 48px toolbar — no reflow in writing area

---

## 9. Inspiration & Anti-Inspiration

### Inspiration: Products That Establish Collaborator Relationships

**GitHub Copilot** — Named after a collaborator role, not a feature. A copilot helps you fly. Copilot does not call its suggestions "AI completions" — it calls them suggestions. The technology is invisible; the collaboration is visible.

**Grammarly** — The invisible editor. No "AI is analyzing your text" announcements. Suggestions appear as editorial marks, not API responses. The Editor's suggestions in DraftCrane should feel like editorial marks on a manuscript.

**Hemingway Editor** — Role in the name. "I am going to have my writing edited." Naming your AI after an editorial role only works if the product behaves like an editor: reviewing existing text, suggesting improvements, deferring to the Author's judgment.

**Notion AI** — Natural integration. AI appears inline, in context, as part of the writing flow. DraftCrane's floating action bar and Editor panel achieve this: the Author selects text anywhere, and the Editor responds.

**iA Writer** — Restraint as identity. Fewer than ten toolbar controls. The toolbar communicates: the writing is what matters. The Editor button should feel like natural furniture, not a promoted feature.

### Anti-Inspiration: Products That Treat AI as the Star

**Jasper AI** — AI as the primary actor. "Let Jasper write your..." DraftCrane inverts this: the Author performs, the Editor supports. Never position the Editor as the author of the text.

**Canva Magic Write** — "Magic" as brand. Spectacle rather than craft. For consultants and academics writing serious nonfiction, "magic" is patronizing. No "magic," "smart," or "genius" prefixes.

**ChatGPT** — Conversation as paradigm. Wrong for a writing editor. An editor does not have a conversation about the text — an editor reads it, marks it up, and gives it back. No chat interface.

**Sudowrite** — AI as author. The "Write" button generates new prose. DraftCrane's Principle 3: "The author writes. The AI assists." The Editor never writes first drafts. The sequence is never reversed.

---

## 10. Design Asks

### P0 — Ship Together (Toolbar Dimensions & Contrast)

| #   | Ask                                  | Description                                                                                                                                                                                                                         | Files                                                                                |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | **Fix toolbar touch targets**        | WorkspaceToggle: `h-9` → `h-11`, options `h-8` → `h-10`, `min-w-[60px]` → `min-w-[72px]`. Panel buttons: `h-9` → `min-h-[44px]`. Export trigger: `h-9` → `min-h-[44px]`. Settings trigger: `h-9 w-9` → `min-h-[44px] min-w-[44px]`. | `workspace-toggle.tsx`, `editor-toolbar.tsx`, `export-menu.tsx`, `settings-menu.tsx` |
| 2   | **Fix toggle easing**                | Sliding indicator: `ease-out` → `ease-in-out`. Add `motion-reduce:transition-none`.                                                                                                                                                 | `workspace-toggle.tsx`                                                               |
| 3   | **Fix inactive toggle contrast**     | Inactive text from `text-muted-foreground` (`#6b7280`, 3.8:1) to `--dc-color-text-secondary` (`#374151`, 9.6:1).                                                                                                                    | `workspace-toggle.tsx`                                                               |
| 4   | **Add missing color tokens**         | `--dc-color-interactive-primary-on-subtle` (`#1d4ed8`), `--dc-color-text-primary` (`#111827`), `--dc-color-surface-tertiary` (`#f3f4f6`), `--dc-color-surface-primary` (`#ffffff`).                                                 | `globals.css`                                                                        |
| 5   | **Replace Library hardcoded colors** | `bg-blue-50 text-blue-700` → semantic tokens.                                                                                                                                                                                       | `editor-toolbar.tsx`                                                                 |

### P1 — Ship Together (Author/Editor Metaphor Establishment)

| #   | Ask                                      | Description                                                                                                                                | Files                          |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 6   | **Revise onboarding tooltip copy**       | Step 2: "Your chapters live here..." Step 3: "Your documents are here..." Step 4: "Your Editor is here..." with violet accent on "Editor." | `onboarding-tooltips.tsx`      |
| 7   | **Update Editor panel empty state**      | Replace pencil icon with sparkles. Copy: "Ready when you are." + instruction text.                                                         | `chapter-editor-panel.tsx`     |
| 8   | **Update landing page copy**             | Revise tagline and description to seed the Author/Editor metaphor.                                                                         | `page.tsx` (landing)           |
| 9   | **Change panel button label breakpoint** | `hidden sm:inline` → `hidden lg:inline` for Editor and Library labels.                                                                     | `editor-toolbar.tsx`           |
| 10  | **Extract PanelToggleButton**            | Shared component replacing inline panel toggle JSX. Tokenized colors, 44px touch target, `w-5 h-5` icons.                                  | New: `panel-toggle-button.tsx` |

### P2 — Ship Incrementally (Polish & Accessibility)

| #   | Ask                                       | Description                                                                                           | Files                          |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------ |
| 11  | **Update streaming response headers**     | Contextual copy: "Here is a rewrite." / "Here is another take." / "Rewriting..."                      | `chapter-editor-panel.tsx`     |
| 12  | **Add panel exit animations**             | Delayed unmount pattern for 200ms slide-out (ease-in). Currently panels unmount immediately.          | `editor-panel.tsx`             |
| 13  | **Add `role="toolbar"` to EditorToolbar** | `role="toolbar"`, `aria-label="Editor toolbar"`, `aria-orientation="horizontal"`.                     | `editor-toolbar.tsx`           |
| 14  | **Add live region for announcements**     | Hidden `aria-live="polite"` region for view mode and panel state changes.                             | `editor-toolbar.tsx`           |
| 15  | **Implement keyboard shortcuts**          | `Cmd+Shift+E` (Editor), `Cmd+Shift+L` (Library), `Cmd+Shift+B` (view toggle).                         | `editor-toolbar.tsx`, new hook |
| 16  | **Add layout and motion tokens**          | `--dc-toolbar-height`, `--dc-toggle-height`, `--dc-motion-fast`, `--dc-motion-normal`, easing tokens. | `globals.css`                  |

### Future (Not Current Scope)

| #   | Ask                                   | Description                                                                                                                                                                                                          |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17  | **Editor rewrite explanations**       | Include a brief explanation with each rewrite: "Tightened the argument and cut the redundant setup." This is what separates a collaborator from a tool (Target User). Requires AI prompt engineering.                |
| 18  | **Book Editor panel**                 | Manuscript-level editorial assistance: chapter ordering, pacing analysis, structural overview, thematic consistency. Triggered when user is in Book view.                                                            |
| 19  | **Editor continuity across sessions** | Some signal that the Editor has been here before: recent interaction, chapter context. "The difference between a metaphor that deepens over time and one that becomes 'the rewrite thing' by day ten" (Target User). |

---

## 11. Open Design Decisions

### Decision 1: Should the Editor Panel Empty State Use First-Person Voice?

**The question:** Should the Editor's empty state say "I am your Editor. Select some text when you are ready, and I will help you make it stronger" (first person) or "Ready when you are. Select text in your chapter, then choose an instruction or write your own" (third person)?

**Options considered:**

| Approach                            | Proposed By                            | Strengths                                                                                                                  | Risks                                                                                              |
| ----------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| First person ("I am your Editor")   | Target User                            | "The single most powerful moment in the onboarding." Establishes the Editor as a presence, not a tool.                     | Could feel forced. Clippy risk. Contradicts "Not a character" brand principle.                     |
| Third person ("Ready when you are") | Interaction Designer, Brand Strategist | Calm, professional. Does not anthropomorphize. Consistent with "Not a character" principle.                                | Misses the emotional opportunity. "Ready when you are" is warm but does not name the relationship. |
| Hybrid                              | —                                      | "Your Editor is ready. Select some text to get started." Uses "your Editor" (relational) without "I" (anthropomorphizing). | Compromise that might not satisfy either goal.                                                     |

**Why it matters:** The Target User identified this as "the single most important design decision in the entire Author/Editor metaphor." The empty state is the first time the Author sees the Editor panel. If it reads as a tool, the metaphor is dead on arrival. If it reads as a presence, everything else makes sense retroactively.

**Recommendation (Brand Strategist):** Third person. The Editor is a capability, not a character. First person violates "the Editor does not have a persona."

**Recommendation (Target User):** First person. "If the tone is right — calm, professional, a little warm — it could be the single most powerful moment in the onboarding."

**Needs:** Founder call. This is a brand identity decision that determines how far the metaphor extends.

### Decision 2: Should Rewrite Results Include Explanations?

**The question:** Should the Editor's rewrite result include a brief explanation of what was changed and why?

**Current behavior:** The Editor streams the rewritten text. No explanation.

**Proposed behavior:** The Editor streams the rewritten text, followed by a one-sentence explanation. Example: "Tightened the opening and cut the repeated qualifier."

**Why it matters:** The Target User identified this as the difference between a feature and a metaphor. "The feature is the rewrite. The metaphor is the explanation. Without the explanation, 'Editor' is just a label. With it, 'Editor' is an experience."

**Technical consideration:** Requires modifying the AI rewrite prompt to include a brief reasoning summary. May increase response time slightly. Could be implemented as a collapsible "What changed" section below the rewrite result.

**Needs:** Design spike + AI prompt engineering experiment. Test with 3-5 rewrite scenarios to evaluate quality and latency impact.

### Decision 3: Icon Library Standardization

**The question:** The codebase uses a mix of inline SVGs and Lucide React icons. Which should be the standard for the toolbar?

**Options:** Heroicons (24px viewBox, matches iOS aesthetic), Lucide (already partially in use), or continue with inline SVGs.

**Why it matters:** The `PanelToggleButton` extraction needs a consistent icon strategy. The sparkles icon for the empty state needs a source.

**Needs:** Technical decision. Low stakes — any of the three approaches work. But consistency matters for maintainability.

---

_This design brief was synthesized from 4 agent contributions (Brand Strategist, Interaction Designer, Design Technologist, Target User) in the `docs/design/contributions-archive/2026-02-24-4/` archive. 16 design asks across P0/P1/P2, 3 open design decisions, 19 future asks identified._
