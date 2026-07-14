# Operator Console Blueprint — the rendered current configuration

Status: **DRAFT for Captain lock — 2026-07-14.** Supersedes
[04-console-structure.md](04-console-structure.md) as the governing design
document for the client portal's operator section (04 is preserved as history;
its locked resolutions are dispositioned in §1 below). Evolves ADR 0076: the
doctrine survives, the governing metaphor does not (§2).

This document is the console-level design authority. **Every future operator
surface brief must cite it**, and a surface that cannot state which visit
occasion (§3) it serves and which coverage rows (§4) it renders is mis-scoped
by definition.

---

## 1. Disposition of 04's locked resolutions

04 was locked by Captain on 2026-07-14 and partially executed (chapter 2
shipped as PR #1896). Nothing locked there is silently dropped; every
resolution is dispositioned here.

| 04 resolution / element                                                             | Disposition                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Honesty rules (render only authored data; Lock 2 nothing-effective-that-isn't)      | **Carried**, unchanged. The employee-manual idea survives as exactly this rule (§2).                                                                                                                                                                                                  |
| One shared viewer per facet, both portals mount (ADR 0069 Lock 4)                   | **Carried**, unchanged.                                                                                                                                                                                                                                                               |
| Facet registry as the closed truth                                                  | **Carried and promoted** — the registry becomes the coverage contract's ledger (§4).                                                                                                                                                                                                  |
| The routine grid as the console spine                                               | **Carried.** The grid page remains the centerpiece; it is renamed (§6).                                                                                                                                                                                                               |
| Six-chapter structure grounded in employment artifacts                              | **Revised.** The grouping instinct survives as five chapters + a header (§5); the employment-document grounding is dropped as a naming authority — no real manual has a chapter called "The work," and no metaphor governs (§2).                                                      |
| Tier language: plain sentences ("Surfaces it / Prepares it for you / Handles it")   | **Carried** as the tier _values_. The row _labels_ around them ("Today" / "Can become") are replaced (§6).                                                                                                                                                                            |
| §5b configurability is the substrate — every rendered fact declares its change-path | **Carried, explicitly.** Each viewer's view model knows which config field it renders and how that value changes (request-a-change today, governed write-back when a domain flips). The occasion table's "request path on every surface" (§3) is the floor, not a relaxation of this. |
| §6 data plane (grid → `routine_grid_json` projection, auto-sync on merge)           | **Carried; built** (PR #1891, live).                                                                                                                                                                                                                                                  |
| Retire the Scope page and Configure                                                 | **Carried** (build slice 4, §8).                                                                                                                                                                                                                                                      |
| Per-routine graduation request designed into chapter 2                              | **Deferred** (Captain, 2026-07-14): no change-control mechanics beyond the generic request path until a client needs one. The row structure does not preclude it; nothing is rebuilt when it lands.                                                                                   |
| Memory's home                                                                       | **Carried as parked** — decided when the memory facet becomes real.                                                                                                                                                                                                                   |
| Chapter names ("The work", "The record", "The arrangement")                         | **Superseded** by the vocabulary table (§6).                                                                                                                                                                                                                                          |

## 2. The frame

> **The console renders the current authored state of the operator,
> comprehensively, in client language. That is the whole job.**

Three words carry the design:

- **Comprehensive** — every material block of the authored configuration is
  rendered somewhere a client can read it. A config block with no rendering is
  a defect (§4), not a backlog item.
- **Current** — the console always shows the configuration as published now.
  This one property serves every phase with no extra machinery: under
  negotiation it shows what we currently understand the operator will be;
  live, what it is; after a change, the new state. There is no proposed/agreed
  dual state and no versioned review flow.
- **Client language** — the reader is a colleague, not a technician. Internal
  token names, exposure keys, and engineer prose never reach the page.

What the console is **not**:

- **Not evidence.** It is informational — it supports clarity and
  investigation. It is not a legal record of the agreement, carries no
  signature or acknowledgment mechanics, and is never "Exhibit No. 1."
- **Not an operating surface** (ADR 0052 holds). No approvals, no drafts, no
  work product. The operator's work flows through the real channels — the
  mailbox, the matter, the alert.
- **Not a daily destination.** When the operator works, nobody visits. The
  console is built for episodic, purposeful visits (§3), which is why
  readability-in-one-sitting beats dashboard density everywhere.

**The metaphor is demoted.** The employee-manual frame (ADR 0076) survives
only as the honesty rule: _every sentence on the console traces to the
authored config._ No metaphor governs the information architecture — the
visit occasions do. Where a familiar pattern helps a page (the routine grid
reads like a delegation-of-authority matrix; the landing reads like a
declarations page), the pattern is borrowed locally and named in that
surface's brief, never promoted to doctrine.

## 3. Visit occasions and their success tests

The console exists for five occasions. Each carries a falsifiable test; a
surface earns its place by making one of these pass.

| #   | Occasion                                                                                   | Visitor                       | Success test                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Agreement / negotiation** — "this is what we think the operator is for you" (the driver) | principal, with Captain       | **File-07 parity**: everything the emailed routine matrix carried — every duty, its trigger, both autonomy dials, the named permanent caps, and a way to ask for a change — the console carries, checkable row by row against `operator/customers/ashton-price/correspondence/07_…routine-matrix.md`. |
| 2   | **Confirmation** — "does it handle X? will it act on its own?"                             | principal/staff, months later | Any duty and its autonomy level findable in at most 2 clicks from the landing.                                                                                                                                                                                                                        |
| 3   | **Change** — "more rope / rein it in / add something"                                      | principal                     | The generic request path is present on every config surface (the floor; §1's change-path-per-fact directive is the substrate it grows from).                                                                                                                                                          |
| 4   | **Investigation** — "something went wrong; what happened?"                                 | principal/compliance          | The record is findable from the landing but never prominent. (Runtime seam; later slice — see §5 empty-chapter rule.)                                                                                                                                                                                 |
| 5   | **Admin** — billing, users, cancellation                                                   | principal                     | As built today.                                                                                                                                                                                                                                                                                       |

Occasion 1 is the design driver. The A&P negotiation is the proof case: the
configuration of a bespoke system embedded in a law firm is being negotiated
over email attachments in a different format every round. The console is the
replacement — the comprehensive view both parties look at and revise against.

## 4. The coverage contract

**The rule:** _an authored `customer.yaml` block with no client-legible
rendering is a comprehensiveness defect._ Comprehensiveness — not structure —
is what the last three build rounds failed; this rule is the mechanism that
would have caught it.

**The ledger is code, not this document.**
`src/lib/portal/operator/facet-registry.ts` is the closed set of facets, each
carrying a deliberate `surface` decision, enforced by the
`operator-facet-legibility` exhaustiveness test. That registry is the
authoritative, always-current statement of what renders. This document defines
the rule; the registry tracks the instances. (Two hand-maintained truths is
the stale-projection failure mode in document form.)

**Snapshot — as of `555e1fd1` (2026-07-14); authority is the registry:**

| Authored block                                          | Renders today                                              | Status                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Identity (persona name, title)                          | Landing hero                                               | Rendered                                                                                 |
| Duties + per-duty autonomy (routine grid)               | Work page (grid seats)                                     | Rendered                                                                                 |
| Skills + initiation                                     | Skills page; gridless fallback                             | Rendered                                                                                 |
| Visibility (folders), inbound roster, blocks (`scope:`) | Scope page                                                 | Rendered (page retires into chapters, slice 4)                                           |
| Connected systems (`connectors:`)                       | Connections page                                           | Rendered (health is authored-static and says so)                                         |
| Escalation contacts                                     | Account page                                               | Rendered                                                                                 |
| **Entitlements / authority ceilings**                   | Floors buried in Configure; per-skill ceilings in Settings | **Fragmented** — no single honest "how much may it do" view (registry slice 3)           |
| **Outbound roster classes** (who it writes to)          | Nowhere                                                    | **Missing** — the scope resolver predates `outbound_roster` (ADR 0075)                   |
| **Persona / identities it can operate as**              | Nowhere (dead door)                                        | **Missing**                                                                              |
| **Schedule (cron) + bundles**                           | Nowhere                                                    | **Missing** — plane `config_unprojected`; needs projection extension (registry slice 7)  |
| **Voice**                                               | Tone rows inside Configure                                 | **Fragmented/thin** (registry slice 5)                                                   |
| Business hours                                          | Configure (timezone only, honestly)                        | Rendered-partial by design (Lock 2: days/hours are inert and never display as effective) |
| Memory, agent-authored skills, activity/audit           | Nowhere (runtime seams unwired)                            | Parked by Captain — join when their seam lands (§5 empty-chapter rule)                   |
| mcp-connector, addons, practice-areas, digest, webhooks | Admin-only / suppressed per registry                       | Deliberate; unchanged                                                                    |

The bolded rows are the build's substance (slice 1, §8). They — not another
reorganization — are what stands between today's console and "comprehensive."

## 5. Information architecture

### The landing is a one-pager, not a hall of doors

The landing reads as a document — the whole operator, summarized top to
bottom, each block flowing into its chapter for depth. A first-time reader
(Christa, week one) learns the operator by _reading one screen_; the chapters
are where she goes to verify detail, not where she must guess to start.

Composition, top to bottom:

1. **Identity header** — persona name, title, the seat's state, and the
   currency stamp (below). Health lives here, de-emphasized (Captain,
   2026-07-14): a quiet presence line, not a hero panel.
2. **The job in numbers** — rendered from the grid where one exists: "19
   duties across 8 stages of your case lifecycle — 14 prepared for a person's
   review, 3 surfaced for you, 2 handled on its own." (Counts derived from
   authored tiers; nothing invented.) Gridless seats render the skills-count
   sentence instead. → Duties chapter.
3. **Autonomy posture** — the permanent caps in one short reviewed block
   (deadlines, money, opposing counsel, court — sourced from grid cap
   verbatims + banned tools, per the descoped chapter-2 brief item, revived
   here). → Duties chapter.
4. **Systems** — one line per connected system with its identity ("works in
   the `records@…` mailbox; reads Inbox and Sent"). → Access chapter.
5. **People** — who it responds to, who it may write to for the firm, who it
   escalates to. → People chapter.
6. **Plan** — the commercial line. → Plan & billing chapter.

**Currency stamp semantics.** The header carries **"Configuration as
published <date>"**, derived from the projection's `synced_at` + `git_sha`
(the merge-triggered auto-sync, live since 2026-07-13). It states when the
rendered configuration was published — it never claims to describe the live
seat's runtime state. If projection and seat can drift, the stamp stays
honest because it only asserts publication.

### Five chapters behind it

Duties · Access · People · Activity · Plan & billing (names per §6, Captain
to mark up). Chapters are compositions that mount the existing shared facet
viewers (Lock 4 unchanged); the facet registry underneath does not change
shape.

### The empty-chapter rule

**A chapter mounts only when its plane has authored or derivable data;
otherwise it is absent entirely.** Never a hollow door, never "coming soon"
(banned string anyway). Concretely: Activity joins the chapter set when the
runtime read seam is wired, not before. A console that claims
comprehensiveness must not contain rooms with nothing in them.

### What retires

Configure (dissolves once Duties/Access/People carry its content), the
standalone Scope page (visibility → Access; rosters/blocks → People — the
resolver survives, extended with `outbound_roster`), and the dead Persona and
Memory doors (Persona's content joins the identity header / Access; Memory
returns under the empty-chapter rule when real).

## 6. Vocabulary (locked once, then guard-enforced)

One table, decided once by Captain, then enforced so naming stops being
re-litigated per page. **Display labels only** — facet registry ids, route
paths, and internal tokens stay stable (rename the label, never the
identifier). Enforcement: the vocabulary build slice extends
`tests/forbidden-strings.test.ts` (or a sibling guard) to ban the retired
display terms from client-facing surfaces.

| Concept                       | Today                                          | Recommended                           | Alternates considered                |
| ----------------------------- | ---------------------------------------------- | ------------------------------------- | ------------------------------------ |
| The duties/grid page          | "The work"                                     | **Duties**                            | Responsibilities; Job description    |
| Current-autonomy row label    | "Today"                                        | **Autonomy:**                         | Current setting                      |
| Ceiling row label             | "Can become"                                   | **Can be raised to:**                 | Available setting; Maximum           |
| Tier values (plain sentences) | Surfaces it / Prepares it for you / Handles it | **unchanged**                         | —                                    |
| Access chapter                | (unbuilt)                                      | **Access**                            | Systems                              |
| People chapter                | (unbuilt)                                      | **People**                            | Working with                         |
| Record chapter                | "Activity"                                     | **Activity** (keep)                   | The record                           |
| Commercial chapter            | "Account"                                      | **Plan & billing**                    | Account (keep)                       |
| Currency stamp                | (new)                                          | **Configuration as published <date>** | Current as of (rejected: overclaims) |

The "The X" naming pattern ("The work", "The record", "The arrangement") is
retired as a family: it is a literary tic, not an employment convention, and
it tested poorly with its primary reader.

## 7. Minimum sendable console (the milestone that unblocks occasion 1)

What blocks the Christa test is **not** the coverage backlog — the grid
already renders (PR #1896). Two things block sending the link:

- **(a) The seat.** The A&P grid and projection live on the
  `pilot-smokeball` seat; `ashton-price/` has a customer.yaml but no grid, no
  D1 row, no portal entity/roles. **Recommendation:** author
  `routine-grid.yaml` on the `ashton-price` seat at the current reconciled
  state and project it, with A&P portal entity + principal role for Christa —
  per the fixtures → pilot-smokeball → ashton-price promotion doctrine: a
  client sees her own seat, never the pilot. _Alternate (zero build):_ walk
  Christa through the pilot-smokeball instance by screenshare while File-07
  reconciliation is still churning the grid, and promote after her three
  owed answers land.
- **(b) Negotiation-phase visibility.** The portal's `provisioning`
  subscription state currently blanks every config surface ("Your Operator is
  being configured"). For the console to carry a negotiation, config surfaces
  must render in that state — the identity header can honestly say setup is
  in progress while the configuration below it is fully readable.

Together with the landing's grid-summary block, these constitute the
**minimum sendable console**: the link Captain can send that carries the
File-07 conversation. It is build slice 0.

## 8. Build sequence

Each slice is a visible, checkable increment; each gets its own small brief
citing this blueprint.

0. **Minimum sendable console** — §7(a) seat decision executed + §7(b)
   provisioning-state visibility. Passes occasion 1's parity test on the
   duties half.
1. **Coverage** — the bolded §4 rows: entitlements as one honest view,
   outbound roster (extend the scope resolver), persona/identities, schedule
   projection + rendering, voice. Rendered into the existing chapter set.
2. **Landing recomposition** — the §5 one-pager (job in numbers, autonomy
   posture, systems, people; stamp).
3. **Vocabulary pass** — apply §6 labels + extend the forbidden-strings
   guard.
4. **Retirements** — Configure and the Scope page dissolve into
   Duties/Access/People; dead doors removed.

Later, unchanged in priority by this document: Activity/audit (runtime
seam), memory, health emphasis, per-routine graduation mechanics.
