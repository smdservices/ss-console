# Operator Console Structure — the work is the spine

Status: **SUPERSEDED as governing doc by
[05-console-blueprint.md](05-console-blueprint.md) — 2026-07-14** (same day as
its lock; the blueprint dispositions every resolution locked here in its §1,
carrying the honesty rules, one-viewer-two-mounts, the grid-as-spine, and the
§5b configurability substrate, and revising the chapter set and naming).
Preserved as history. Original status: LOCKED — Captain approval 2026-07-14
(directional approval of the structure + resolutions on naming grounding, tier
language, and configurability; execution plan approved same day). Evolves ADR
0076 §2 (same employee-manual doctrine, sharper table of contents); grounded in
`operator/customers/pilot-smokeball/routine-grid.yaml` (ADR 0075), the facet
registry, and three build iterations of the console.

---

## 1. The failure pattern this fixes

Three times now, a console page was built from a **config mechanism** and
failed a **client question**:

1. "What's its job" — the Captain expected the litigation lifecycle under
   _Scope_; the lifecycle had no page because it isn't a config key.
2. "What can it see" — the Scope page rendered `scope:` fields ("Sees: Inbox,
   Sent" / "Never sees: None set") and never mentioned Smokeball, because
   Smokeball lives under `connectors:`. The most-informed reader found the
   page useless; a client would too.
3. "How much can it do alone" — Governance was queued as its own page, but
   autonomy is not a thing; it is a **dimension of every thing**. A Governance
   page would have repeated failure #2.

The diagnosis: settings-noun pages cannot answer question-shaped visits. The
`customer.yaml` decomposition (scope / connectors / skills / entitlements /
cron) exists because that is how **enforcement** works. It is not how a
client thinks.

## 2. The evidence for the alternative

When a real client needed to understand and control this operator, the
artifact that worked was **the routine matrix** (correspondence file 07):
every duty the operator performs, with its trigger and its autonomy dial
attached, grouped by lifecycle stage. Christa marked it up row by row and
returned it. It is the only console-like artifact a genuine customer has
ever engaged with successfully.

That artifact is now **authored data**: `routine-grid.yaml` (ADR 0075) carries
19 routines under 8 lifecycle sections (Discovery, Case Initiation, Medical
Records and Chronology, Motions, Minor's Compromise, Trial Prep, Mediation /
Settlement / Liens, Firm-wide). Each row carries:

- `routine` — a client-legible name ("Records chase", "Motion calendar")
- `letter_section` — the lifecycle grouping
- `skills[]` — the implementing skill(s)
- `start_tier` / `ceiling_tier` — flag-only | prepare-and-route | auto-handle,
  with the letter's verbatim language preserved
- `enforcement` — initiation, governing exposure keys, content floor, banned
  tools, and honest caveat notes (including where composition NARROWS the
  letter)

A drift gate (`tests/customer-commitments.test.ts`) asserts the grid's
exposure keys equal the live seat values. The grid is therefore not
documentation — it is the reconciled truth connecting the client commitment,
the config, and the enforcement.

**The organizing principle:** the client-native mental model is _the work,
with its settings attached_ — never settings, with the work implied.
Grouping is by **lifecycle phase** (Captain call, 2026-07-14): it is how the
client narrates the work to themselves; the system a routine touches is named
per row, not used as the grouping.

## 2b. Standing on the employment world's shoulders

Captain directive (2026-07-14): before inventing structure or names, take
guidance from how the employment world already documents an employee. The
mapping holds remarkably well — each chapter corresponds to a standard
employment artifact:

| Chapter         | Standard employment artifact                                                                                                                                                                                          | What that artifact answers                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Status          | (presence/attendance — operational, not a document)                                                                                                                                                                   | is the employee here and OK                 |
| The work        | **Job description** (duties & responsibilities) crossed with a **Delegation of Authority matrix** (who may do what, to what threshold, under what conditions — the corporate-governance standard for approval levels) | what they do, and their authority per duty  |
| Access          | **Systems access** (the IT/onboarding provisioning record)                                                                                                                                                            | what accounts and systems they hold keys to |
| People          | **Reporting lines / working relationships** (org context, escalation path)                                                                                                                                            | who they work with, report to, may contact  |
| The record      | **Personnel file / employment record**                                                                                                                                                                                | what they have done                         |
| The arrangement | **Employment agreement**                                                                                                                                                                                              | the terms of the engagement                 |

The DoA-matrix correspondence is the strongest finding: it is the exact
industry artifact for per-duty authority tiers with named caps ("managers
approve to X, directors to Y, never above Z"), which is precisely what the
routine grid's start/ceiling tiers and permanent caps are. We are not
inventing a novel concept; we are rendering a familiar governance document
for an AI employee. Where our labels improve on the industry's (a business
owner reads "The work" faster than "Delegation of Authority"), we keep the
plain label and let the structure carry the correspondence.

Sources: [SHRM sample handbook](https://www.shrm.org/content/dam/en/shrm/business-solutions/SHRM-Sample-Employee-Handbook-2023.docx),
[SHRM handbook how-to](https://www.shrm.org/topics-tools/tools/how-to-guides/how-to-develop-employee-handbook),
[DoA matrix overviews](https://tallyfy.com/delegation-of-authority-matrix-template/)
([ACC form](https://www.acc.com/resource-library/quick-overview-delegation-authority-sample-form)).

## 3. The console: six chapters

The operator view collapses to six chapters. The facet system underneath is
unchanged (registry stays the closed truth; one shared viewer per facet,
ADR 0069 Lock 4); chapters are **compositions** that mount viewers.

### 1 — Status _(exists; keep)_

Is it OK, does it need me. The health-led hero (aliveness + identity). The
"who it is" block lives here: persona name, title, and — when the voice facet
is real — how it sounds. Honest-empty when the runtime bridge has no data.

### 2 — The work _(the spine; new page, absorbs four planned pages)_

The rendered routine grid, grouped by lifecycle section, one row per routine:

> **Records chase** — _Medical Records and Chronology_
> Chases the firm's records vendor for outstanding medical records.
> Works in: Smokeball, email (records vendor).
> Starts: on request, and weekly on a schedule.
> Today: **prepares it for you** — every chase email is drafted for a
> person to review.
> Can become: **handles it** — you may authorize sending on its own,
> whenever you choose; never automatic.
> Always true: reads matter metadata only; never reads document contents.

**Tier language (locked, Captain 2026-07-14): plain sentences.** The reader
is a colleague, not a technician. The closed tier vocabulary renders as:
`flag-only` → **"surfaces it"**, `prepare-and-route` → **"prepares it for
you"**, `auto-handle` → **"handles it"**. The letter's verbatim phrases stay
available at the row's detail level (they are the contract language); the
internal token names never appear on the page and may change freely in code.

Rendered strictly from grid fields: routine name, section, the skill
summaries catalog, initiation, `start_tier`/`ceiling_tier` (with the
verbatim letter language available), and the caps from `enforcement.notes` —
**only as far as authored**, never paraphrased into new promises.

This chapter **absorbs, as pages**: Skills (rows), Schedule (the "starts"
column; plus business hours as a header line, rendered honestly — today only
the timezone materializes, so days/hours must not display as effective,
Lock 2), Workflows (the lifecycle IS the grouping), and Governance (the
per-routine dial). What remains of "governance" beyond the grid is the small
set of global floors and permanent caps (money, court, opposing counsel,
deadlines) — rendered as a short "Permanent rules" block at the top of this
chapter, sourced from the grid's caps and banned tools.

### 3 — Access _(new page; absorbs Connections + the seeing-half of Scope)_

The accounts and systems it holds keys to, one block per system, in
consequence sentences:

> **Email** — works in the `<mailbox identity>` mailbox. Reads the Inbox and
> Sent folders; no other folder is visible to it.
> **Smokeball** — connected; managed by SMD. _(reach stated only as far as
> the connector config authors it)_
> **Web search** — can search the open web and read pages.

Folder visibility moves here from the dead Scope page, attached to the
system it describes — answering "which inbox?" structurally. Connector
health renders only when a real probe exists (today it is authored-static;
say so or say nothing).

### 4 — People _(new page; absorbs Team + the who-half of Scope + escalation)_

Everyone the operator interacts with, and on what terms:

- **Who it responds to** — the inbound roster (ADR 0055), kept exactly as
  built on the retired Scope page (that block worked).
- **Who it writes to for the firm** — the outbound roster classes
  (client, records vendor; ADR 0075), each with its plain-language meaning.
- **Who it escalates to** — escalation contacts.
- **Who is on the account** — team members and roles (existing viewer).
- **What it must never touch** — blocked topics / senders / work, one plain
  sentence when empty ("No topics, senders, or specific work are blocked.").

### 5 — The record _(exists; keep)_

Activity, role-scoped compliance folded in (as planned).

### 6 — The arrangement _(exists; keep)_

Account: subscription, data export, cancellation.

## 4. Facet registry mapping (complete)

Every registry facet lands in exactly one chapter. Registry `mounts`/`plane`
unchanged; only `surface` decisions and door composition move.

| Facet (registry id)                                                                                                                              | Chapter                           | Disposition                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| status, identity                                                                                                                                 | 1 Status                          | as built (hero)                                                                                                                                                                                |
| skills                                                                                                                                           | 2 The work                        | viewer becomes the grid row detail; flat-list fallback for gridless seats                                                                                                                      |
| entitlements, authority                                                                                                                          | 2 The work                        | per-routine dial column + "Permanent rules" block; write-back stays Tier-0-gated                                                                                                               |
| schedule, bundles                                                                                                                                | 2 The work                        | "starts" column (needs projection extension, unchanged)                                                                                                                                        |
| workflow                                                                                                                                         | 2 The work                        | **plane changes: `no_schema` → grid-backed** (routine-grid.yaml is the schema, arrived via ADR 0075)                                                                                           |
| business-hours                                                                                                                                   | 2 The work (header)               | timezone only; days/hours inert, never shown as effective                                                                                                                                      |
| agent-skills                                                                                                                                     | 2 The work                        | later slice, unchanged                                                                                                                                                                         |
| connections                                                                                                                                      | 3 Access                          | per-system blocks                                                                                                                                                                              |
| scope                                                                                                                                            | 3 Access + 4 People               | **page retired**; visibility → Access, rosters/blocks → People. The scope _viewer/resolver_ built 2026-07-13 is refactored into those two mounts (and extended: it predates `outbound_roster`) |
| voice                                                                                                                                            | 1 Status ("who it is")            | small block when real                                                                                                                                                                          |
| people, escalation                                                                                                                               | 4 People                          | as planned                                                                                                                                                                                     |
| activity, compliance                                                                                                                             | 5 The record                      | as planned                                                                                                                                                                                     |
| memory                                                                                                                                           | 4 People or 6 — **open question** | runtime seam, later slice                                                                                                                                                                      |
| provisioning, cost, observability, safety-sticky-stop, mcp-connector, digest, relationship, webhook-triggers, addons, practice-areas, gmail-push | admin-only / suppressed           | unchanged                                                                                                                                                                                      |

**Pages that die:** the Scope page (built 2026-07-13 — retire; contents
disperse with context), Configure (dissolves once chapters 2–4 are real),
and the planned separate Governance / Schedule / Workflows pages (never
built — now never needed). The Skills page survives temporarily as the
gridless fallback and becomes the grid's detail view.

## 5. Honesty and fallbacks

- **Gridless seats** (smd, Hosted Agent): chapter 2 renders the honest
  degradation — the skills + initiation inventory (today's Skills content),
  with no invented tiers. The grid rendering lights up only where a
  routine-grid is authored. This keeps the console truthful across both
  products with one structure.
- **Grid prose**: `enforcement.notes` are engineer-authored. The client
  rendering uses the tier vocabulary, verbatim letter language, and a
  reviewed per-routine summary catalog (same pattern as `skill-summaries.ts`
  — hand-compressed, guard-tested, never runtime paraphrase).
- **Nothing renders as effective that isn't** (Lock 2): business-hours
  sub-fields, static connector "health", inert addons.

## 5b. Configurability is the substrate (Captain directive, 2026-07-14)

> "Ultimately we want as much of the operator as possible to be configurable
> by the client, should they choose to do that. Whatever we're designing,
> that needs to be an underlying part of the structure — so as we make it
> available to clients, we're not rebuilding."

This is a structural requirement on every chapter, not a later feature.
Concretely:

- **Every rendered fact declares its change-path from day one.** Each viewer's
  view model carries not just the value but _how that value changes_: which
  customer.yaml field it renders, and which change mechanism applies
  (request-a-change today → governed self-service write when enabled). A
  chapter is mis-built if making its content editable would change its
  structure rather than its permission.
- **One write pipeline, already mostly real.** The edit path is always:
  governed change → validated customer.yaml write-back (ADR 0012 §5 / ADR
  0026 — the config surface is a security boundary; floors and validators
  apply to client edits exactly as to ours) → git as source of truth → the
  merge-triggered projection auto-sync (live since 2026-07-13) → portal and
  seat. Client configurability is _that pipeline with a different author_,
  gated per-domain by the authority model (ADR 0041 managed ↔ self-managed).
  The one missing piece is the write-back itself (ADR 0069 Tier 0) — which
  makes it the enabling build for all client-facing configurability, once,
  rather than per-page work.
- **The grid is the first instance.** Chapter 2's per-routine forward action
  — "let it handle this on its own" — is a graduation request against a
  named row (a one-line exposure/initiation change, per the grid's own
  enforcement notes). Designed into the chapter 2 brief (Captain: yes,
  2026-07-14). It ships as request → Captain applies; it becomes
  self-service by flipping the domain's authority, with no page rework.
- **Fail-closed stays the floor.** Nothing about client editability weakens
  ADR 0035: unauthored remains fail-closed, vertical floors and permanent
  caps (money, court, opposing counsel) are not client-raisable, and the
  page must render the difference between "your dial" and "a permanent rule"
  honestly.

## 6. Data plane

`routine-grid.yaml` is in-repo only. To render chapter 2 it must reach the
portal the same way customer.yaml does: extend the `customer_configs`
projection with a `routine_grid_json` column (or a sibling table), projected
by the same canonical mapper path — which now auto-syncs on merge
(deploy.yml `sync-customer-configs`, shipped 2026-07-13), so the grid can
never go portal-stale. The drift gate already pins grid ↔ config; the
projection extension pins grid ↔ portal.

## 7. Build sequence (proposed)

1. **Lock this document** (Captain sign-off on structure + chapter names).
2. Amend ADR 0076 §2 to this table of contents; update the facet registry
   (workflow plane, scope disposition); retire the Scope door.
3. Projection extension: routine-grid → D1 (+ the auto-sync picks it up).
4. **Chapter 2, The work** — its own Surface Brief against the real grid,
   then build. This is the centerpiece and the next real surface.
5. Chapter 3 Access, then Chapter 4 People (each a small brief; both mostly
   recompose existing viewers + the scope resolver).
6. Retire Configure once 2–4 are live.

A&P timing works in our favor: the lifecycle rework revises the grid, and
chapter 2 renders whatever the grid says — the portal spine and the
enforcement spine are the same artifact, so the rework and the console stop
being separate alignment problems.

## 8. Captain resolutions (2026-07-14)

1. **Chapter names — grounded, not invented.** Directive: take guidance from
   industry-standard employment documents; improve where it makes sense, but
   stand on their shoulders. §2b maps each chapter to its standard artifact
   (job description + DoA matrix, systems access, reporting lines, personnel
   file, employment agreement). Final labels are proposed in §3 with that
   grounding; the one remaining naming call is cosmetic (e.g. "The work" vs
   "Duties") and is made at the chapter 2 brief, not here.
2. **Tier language: plain sentences — RESOLVED.** "Surfaces it / prepares it
   for you / handles it." Readers are colleagues, not technicians. Letter
   verbatim at detail level; internal token names never on the page.
3. **Memory's home — PARKED.** Decided when the memory facet becomes real
   (runtime seam, later slice); default lean People ("what it knows about
   us"), export stays in The arrangement.
4. **Per-routine graduation request: in scope — RESOLVED.** Designed as part
   of the chapter 2 brief, per §5b. And §5b elevates the underlying
   directive to a structural requirement on every chapter: design for
   client configurability as the substrate, so enabling it is a permission
   flip, never a rebuild.
