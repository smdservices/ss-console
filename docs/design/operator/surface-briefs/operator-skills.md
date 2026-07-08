# Surface Brief — Operator › Skills

Route: `portal.smd.services/portal/products/operator/skills`
Facet: `skills` (facet registry `src/lib/portal/operator/facet-registry.ts`)
Status: **DRAFT — awaiting Captain sign-off** (drafted 2026-07-08)

The second facet made real under the content/functionality pass (ADR 0069). The
landing's "Skills" door currently deep-links to the legacy Configure page; this
brief gives Skills its own briefed, honest surface.

---

## 1. Target user

The client principal or staff member on the account (roles `principal`, `staff`,
`compliance` — the same read access Configure grants). Context: they are on the
operator console trying to understand **what this thing actually does for them**.
Not a power user tuning knobs — a business owner answering "what did I buy, and
what should I expect it to handle."

## 2. User tasks

> "When I come here, I want to see everything my operator can actually do, and
> how each of those gets set in motion, so I understand what I'm paying for and
> what to expect it to handle."

Secondary: "so I can tell whether a thing I need is already something it does."

## 3. Business objective

Skills is the concrete answer to the console's central question — "what can it
do" — and the heart of the ADR 0069 legibility thesis and the ADR 0037
competes-with-a-hire frame: the client should be able to read the operator's job
like a role description. Surfacing it makes the retainer legible (justifies the
price), sets correct expectations (cuts "why didn't it do X" support load), and
gives the consultant a shared artifact to point at.

## 4. Inward paths

- The **Skills** door in the landing's Role section. Today it deep-links to
  Configure; this brief redirects that door here.
- Direct URL / bookmark.
- Future: an assessment/onboarding hand-off ("here's what we set up"). No email
  links today.

## 5. Core content

Only what the projection really carries, and only that:

- **REAL, shown — the skill inventory.** The list of skills configured on the
  active persona (`persona.skills[].name`), in authored priority order. Presence
  in the list means the skill is configured for this operator. The portal has
  only the slug (not the `SKILL.md` prose), so we humanize the slug for display
  (`inbox-triage` → "Inbox triage") — a reformat of the same string, never an
  invented description sentence.
- **REAL, shown, currently invisible anywhere — initiation.** Each skill's
  `SkillInitiation { manual, scheduled, webhook }` — **how** the skill gets set
  in motion. This is the informative payload Configure throws away. Client-legible
  labels:
  - `manual` → "On request"
  - `scheduled` → "On a schedule"
  - `webhook` → "When something happens"
    When no initiation mode is true, show nothing for that skill rather than imply a
    trigger.
- **NOT shown (would be fabrication or belongs elsewhere):**
  - Per-skill **enabled / On-Off**. The projection dropped `enabled`;
    `skillToggleRowsFromPersona` hardcodes `enabled: true` (settings.ts:201-208),
    so today's Configure "On/Off" is a constant, not real state. We do not
    reproduce a status the data can't back.
  - `version`, `cost_estimate`, `scope[]` — dropped from the projection.
  - Per-skill **trust ceiling / exposure / autonomy**. That is a separate facet
    (the Governance door; registry `entitlements` + `authority`). Per Lock 4 —
    one viewer per facet — Skills is inventory + initiation, never autonomy.
- **Honest empty state** (docs/style/empty-state-pattern.md): no config row, no
  active persona, or an empty skills list → "Your operator's skills appear here
  once they're configured." Never a placeholder row.

## 6. Forward paths

Read-only surface, matching Configure's read posture at launch.

- Back to the operator landing (breadcrumb).
- **Request a change** — the one existing change-request path (the same
  mechanism Configure's `DomainSurface` uses), so a client who wants a skill
  added or removed has a real route.
- Explicitly **not** the legacy enable/disable toggle from `SkillTogglesSection`
  — it logs intent and hardcodes state; reintroducing it would be theater.

## 7. Verdict

**BUILD** Skills as its own facet page: a real, honest skill inventory that shows
each configured skill and how it is triggered, in authored order. It replaces the
Skills → Configure deep-link. It deliberately does **not** show enable/disable
state, ceilings, versions, or costs — those are dropped from the projection
(fabrication risk) or belong to the Governance facet.

Pattern (ADR 0069 Lock 4): one shared resolver (`src/lib/portal/operator/facets/skills/…`)

- one shared viewer component, both portals mount; flip the registry `skills`
  surface `planned` → `has_viewer` pointing at the resolver.

Register: build in the current **loud** operator register to match its siblings
(Configure, the landing) while the calm migration is parked; add the new files to
`CALM_REGISTER_PENDING` so the whole operator area flips to calm together later,
not one lone page at a time.

---

## Open questions for sign-off

1. **The honest cut.** Skills = inventory + initiation only. This is a real
   reduction from what Configure shows today (it drops the always-"On" state).
   Confirm we show what's real and cut the rest.
2. **Initiation labels.** "On request" / "On a schedule" / "When something
   happens" — confirm the client-legible wording.
3. **Register.** Loud (match siblings now) vs. calm this one page. Recommend loud.
