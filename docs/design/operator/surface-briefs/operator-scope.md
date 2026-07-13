# Surface Brief — Operator › Scope

Route: `portal.smd.services/portal/products/operator/<instance>/scope`
Facet: `scope` (facet registry `src/lib/portal/operator/facet-registry.ts` —
plane `config_projection`, mounts client + admin)
Status: **SIGNED OFF — BUILT 2026-07-13.** All three sign-off questions
resolved as recommended: (1) the roster (`inbound_allow_from`) is surfaced as
"Who it responds to," with the fail-closed posture stated plainly when empty;
(2) the landing door copy tightens to "What it can see, who it responds to,
and what's off limits"; (3) blocks render as three separately-labeled rows,
the third only when non-empty. One label changed at build time: the ADR 0052
§6 vertical-vocabulary guard bans law words on client operator surfaces
outright, so the `matter_blocks` row ships under the vertical-neutral label
"Blocked work" (the authored values render as authored). The same conversation produced ADR 0076 (the
console is the employee manual, rendered): this page is the first Boundaries
chapter and later composes with the Governance viewer on one Boundaries
surface — no rework, the viewer is the unit.

The third facet made real under the content/functionality pass (ADR 0069),
after the landing and Skills. The landing's "Scope" door currently deep-links
to the legacy Configure page; this brief gives Scope its own briefed, honest
surface.

---

## 1. Target user

The client principal, staff member, or compliance role on the account — the
same read access Configure grants. Context: they want to confirm the
operator's boundaries — what it can see, who it will respond to, and what is
off limits. The compliance role in particular lands here to verify a sensitive
area is actually excluded.

## 2. User tasks

> "When I come here, I want to see what my operator can see and who it
> responds to, so I can confirm its boundaries are exactly what we agreed."

Secondary: "so I can check that a specific sensitive thing (a folder, a
party, a matter) is blocked before I trust it near that area."

## 3. Business objective

Scope is the proof that the operator's reach is authored and bounded — the
trust half of the legibility thesis (ADR 0069). Skills answers "what can it
do"; Scope answers "where may it look and who may it talk to." Surfacing it
kills "can it read X / will it email Y" support pings, gives the compliance
role a real artifact, and makes the fail-closed posture (ADR 0055) visible as
a feature rather than invisible plumbing.

## 4. Inward paths

- The **Scope** door in the landing's Role section. Today it deep-links to
  Configure; this brief redirects that door here.
- Direct URL / bookmark.
- Future: an onboarding hand-off ("here are the boundaries we set"). No email
  links today.

## 5. Core content

Everything below is carried by the projection (`scope_json` = the full
validated `Scope`, `customer-config-projection.ts:89`) — nothing needs new
wiring. Grouped as three client-legible questions:

- **What it can see** — `email_folders_visible` and `email_folders_blind`,
  as two labeled lists ("Sees" / "Never sees"). "None set" per empty list.
- **Who it responds to** — `inbound_allow_from`, the ADR 0055 organization
  roster (addresses and `@domains`). This is the single most consequential
  scope fact and is currently shown **nowhere** (Configure's Scope card drops
  it). Client-legible framing: people on this list get real replies and
  action; everyone else is read-only until someone with authority directs
  otherwise. **Honest fail-closed empty state:** an empty roster means the
  operator drafts but never responds on its own — say that plainly, as the
  safety posture it is, never as an error.
- **What's off limits** — the block lists as three separately-labeled rows,
  not the current mashed single line (Configure joins keyword + domain +
  matter blocks into one "Blocks" string, losing which kind each is):
  - `email_keyword_blocks` → "Blocked topics"
  - `domain_blocks` → "Blocked senders and domains"
  - `matter_blocks` → "Blocked work" — rendered **only when non-empty** (a
    non-law seat should not see an empty law-shaped row), under a
    vertical-neutral label (ADR 0052 §6 bans law vocabulary on client
    operator surfaces; the authored values are the client's own object names
    and render as authored).
- **NOT shown (fabrication risk or belongs elsewhere):**
  - `trusted_sender_domains` — authored in the smd customer.yaml but **not in
    the validated schema** (`sections-scope.ts` ignores it), so it never
    reaches the projection. Not renderable. (Separate authoring-hygiene
    follow-up: it should be schema'd or removed from the yaml.)
  - Business hours — folds into the Schedule facet per the landing brief,
    not Scope.
  - The external-send ceiling / outside-the-roster posture — that is the
    Governance facet (registry `entitlements` + `authority`). Per Lock 4,
    Scope shows the roster (who may trigger a reply); Governance shows the
    ceilings (what the operator may do). One viewer per facet.
- **Honest empty state** (docs/style/empty-state-pattern.md): no config row
  or `scope_json` null → "Your operator's boundaries appear here once scope
  is set." Never a placeholder row.

## 6. Forward paths

Read-only surface, matching Configure's read posture at launch.

- Back to the operator landing (breadcrumb).
- **Request a change** — the existing change-request path (`DomainSurface`,
  domain `configuration`), so a client who wants a folder opened, a sender
  rostered, or a block added has a real route.

## 7. Verdict

**BUILD** Scope as its own facet page: what it can see, who it responds to,
and what's off limits — three honest, separately-labeled groups read straight
from the projection. It replaces the Scope → Configure deep-link and surfaces
the roster for the first time. It deliberately does **not** show ceilings
(Governance's job), business hours (Schedule's job), or the unvalidated
`trusted_sender_domains` key.

Pattern (ADR 0069 Lock 4, the Skills shape): shared resolver
`src/lib/portal/operator/facets/scope/scope.ts` (pure, projection → view
model) + shared viewer `OperatorScope.astro` both portals mount +
instance-addressed page `[instance]/scope/index.astro`; flip the registry
`scope` surface `planned` → `has_viewer`.

Register: build in the current **loud** operator register to match siblings;
add new files to `CALM_REGISTER_PENDING` so the operator area flips to calm
together later.

---

## Open questions for sign-off

1. **The roster, surfaced.** `inbound_allow_from` becomes the centerpiece
   ("Who it responds to"), including the plain-language fail-closed framing
   when empty. Confirm.
2. **Door copy.** The landing door reads "What it handles for you, and the
   shape of its job" — broader than what scope data actually is. Recommend
   tightening to: "What it can see, who it responds to, and what's off
   limits."
3. **Blocks presentation.** Three separate labeled rows (topics / senders and
   domains / matters), matters shown only when non-empty. Confirm labels.
