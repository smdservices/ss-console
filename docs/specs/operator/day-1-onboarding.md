# Day-1 Onboarding Screen Sequence

**Spec for issue #803.** First hour in the dashboard, after Captain-led setup session. Without screen-by-screen sequence, Captain cannot operate fluently in the meeting and onboarding feels improvised. UX Lead's contribution is the source.

## Cross-spec dependencies

The screens in this spec compose other specs. A reader implementing one screen reaches for these:

- [customer-yaml-schema.md](./customer-yaml-schema.md) populates `personas[]`, `voice_library`, `connectors[]`, and `users[]`. Several screens render directly from these fields. If a field is unpopulated at provision time, the screen renders the empty-state per `docs/style/empty-state-pattern.md`, never invented copy.
- [voice-gate-fallback.md](./voice-gate-fallback.md) owns the blind-test state surfaced in Screen 3. The screen reads the latest `VOICE_GATE_*` event and follows the three-state contract (Pass / Near-pass / Fail).
- [capability-contracts.md](./capability-contracts.md) defines the `Email` interface as Pattern A only at v1. Screen 5 (Trust ceiling explainer) and Screen 7 (first trust promotion) must reflect the Pattern A rule: drafts land in the reviewer's drafts folder; no agent-held send token; nothing autonomous can produce an external send in v1.
- [dashboard-roles.md](./dashboard-roles.md) drives Screen 4 (Skills) and the Operator / Compliance branches in Operator onboarding (parallel) below.
- [mobile-approval-flow.md](./mobile-approval-flow.md) is the surface the principal lands on at Screen 9 if they finished on a phone.
- [d1-schema.md](./d1-schema.md) defines the `audit_log` action-type vocabulary used by every screen's audit event (`WELCOME_VIEWED`, `WALKTHROUGH_STEP_COMPLETED`, `TRUST_PROMOTED`, `ONBOARDING_COMPLETED`, `MOBILE_UPLOAD_FALLBACK`).

## Contract

### Pre-Day-1 context

Captain has already pre-provisioned `hermes-{slug}` (per §16.2 aircraft-carrier moment), conducted the 4-6h Captain-led voice calibration session (§9.6 Gate 2), and run the blind-test. Day-1 begins when the principal first opens the dashboard on their own time.

### Sequence

#### Step 0 — Welcome email (delivered 60s after Captain finalizes onboarding)

Subject: `Welcome — Marcus is ready at {firm-name}`.

```
{Principal first name},

Marcus is configured and ready. Your dashboard is at:

  https://portal.smd.services/operator

You'll see a Day-1 walkthrough the first time you log in (about 12 minutes).
After that, Marcus will start watching your inbox and you'll get a daily
digest at 8am.

Two phone numbers in case you need anything:
- {Captain phone} (Scott)
- {Backup operator phone}

Talk soon,
Scott
```

#### Screen 1 — Welcome / orient (first dashboard land)

```
┌─────────────────────────────────────────────────┐
│  Welcome, {Principal name}                       │
│                                                  │
│  Marcus is configured for {firm-name}.           │
│  Here's what's set up. We'll walk through it.   │
│                                                  │
│  ✓ Persona (Marcus)                              │
│  ✓ Voice samples (32 anchors loaded)             │
│  ✓ Blind-test passed (84%)                       │
│  ✓ Connectors (Outlook, Filevine, DocuSign)      │
│  ✓ Skills (4 enabled)                            │
│                                                  │
│  Walkthrough takes about 12 minutes.             │
│  You can skip and come back to this any time.    │
│                                                  │
│  [Start walkthrough]   [Skip — show me Today]    │
└─────────────────────────────────────────────────┘
```

Stored: `audit_log.WELCOME_VIEWED` (actor=principal). If they skip, they get a banner on the Today tab: "Walkthrough available — click to start." The walkthrough never auto-opens after dismissal.

#### Screen 2 — Persona review (≈1 min)

```
┌─────────────────────────────────────────────────┐
│  Step 1 of 7 — Persona                           │
│                                                  │
│  Name: Marcus                                    │
│  Title: AI Associate                             │
│  Signature: (preview rendered here)              │
│  Avatar: (image)                                 │
│  Tone: warm-but-professional, concise            │
│                                                  │
│  This is who Marcus is internally — on the       │
│  dashboard, in audit logs. Externally, drafts    │
│  go to your Outlook drafts as you.               │
│                                                  │
│  [Looks good]   [Edit persona]                   │
└─────────────────────────────────────────────────┘
```

Edits land on Persona tab. Audit event: `WALKTHROUGH_STEP_COMPLETED` (step=persona).

#### Screen 3 — Voice review (≈2 min)

```
┌─────────────────────────────────────────────────┐
│  Step 2 of 7 — Voice                             │
│                                                  │
│  32 anchor samples loaded across 3 cohorts:      │
│                                                  │
│  • Clients (16 samples)                          │
│  • Opposing counsel (10 samples)                 │
│  • Vendors (6 samples)                           │
│                                                  │
│  Blind-test passed at 84% — three judges who     │
│  know you couldn't reliably tell Marcus's drafts │
│  from yours.                                     │
│                                                  │
│  [Run a test draft]   [Continue]                 │
└─────────────────────────────────────────────────┘
```

"Run a test draft" opens the Voice tab test sandbox; principal types a scenario, sees a draft. Builds confidence before the first real one ships.

#### Screen 4 — Skills configuration (≈3 min)

```
┌─────────────────────────────────────────────────┐
│  Step 3 of 7 — Skills                            │
│                                                  │
│  4 skills are enabled:                           │
│                                                  │
│  ▶ Inbox triage & draft       draft_for_review   │
│    Watches your inbox; drafts replies            │
│                                                  │
│  ▶ Morning digest              autonomous        │
│    Generates 8am summary                         │
│                                                  │
│  ▶ PI intake triage           draft_for_review   │
│    Handles new PI lead intake                    │
│                                                  │
│  ▶ Memory curator              autonomous        │
│    Learns from your edits                        │
│                                                  │
│  [Looks good]   [Configure skills]               │
└─────────────────────────────────────────────────┘
```

Tap a skill row → drawer with trust-ceiling toggle, scope config, "Operator may approve" toggle (per dashboard-roles.md).

#### Screen 5 — Trust ceiling explainer (≈1 min)

```
┌─────────────────────────────────────────────────┐
│  Step 4 of 7 — Trust ceilings                    │
│                                                  │
│  Three levels:                                   │
│                                                  │
│  draft_for_review  — Marcus drafts; you send     │
│  autonomous        — Marcus does it; logs it     │
│  refused           — Marcus doesn't run this     │
│                                                  │
│  Drafts that touch clients, settlements, or      │
│  court filings stay at draft_for_review forever. │
│  You can promote others as trust builds.         │
│                                                  │
│  [Got it]                                        │
└─────────────────────────────────────────────────┘
```

#### Screen 6 — Voice samples upload (≈3 min — mobile-friendly)

For partners who have additional samples on their phone (e.g. Outlook drafts on iPhone). Mobile file picker.

```
┌─────────────────────────────────────────────────┐
│  Step 5 of 7 — Add more voice samples (optional) │
│                                                  │
│  We loaded 32 from your published writing and    │
│  what you sent us. More is better. Drop in       │
│  emails, status updates, or letters you've       │
│  written.                                        │
│                                                  │
│  [📎 Pick files]   [Skip]                        │
└─────────────────────────────────────────────────┘
```

Mobile: native iOS/Android picker; supports `.eml`, `.msg`, `.txt`, `.docx`, `.pdf`. Upload → R2 per r2-vectorize-naming.md `voice/samples/` prefix; `voice_samples` row written; sanitization queued (Captain reviews before activation).

#### Screen 7 — Trust ceiling first promotion (≈1 min)

```
┌─────────────────────────────────────────────────┐
│  Step 6 of 7 — First trust promotion (optional)  │
│                                                  │
│  morning-digest is recommended for autonomous.   │
│  It reads your inbox and produces an 8am         │
│  digest. No external communication.              │
│                                                  │
│  Promote to autonomous?                          │
│                                                  │
│  [Yes, promote]   [Keep at draft_for_review]     │
└─────────────────────────────────────────────────┘
```

This is the first real audit-log event of the trust-building loop. `TRUST_PROMOTED` event written.

#### Screen 8 — Daily digest setup (≈1 min)

```
┌─────────────────────────────────────────────────┐
│  Step 7 of 7 — Daily digest                      │
│                                                  │
│  When should the morning digest arrive?          │
│                                                  │
│  ○ 7:00 AM                                       │
│  ● 8:00 AM      (recommended)                    │
│  ○ 9:00 AM                                       │
│  ○ Custom                                        │
│                                                  │
│  Where should it go?                             │
│  ● Email at {principal-email}                    │
│  ○ Both email + SMS                              │
│                                                  │
│  [Save and finish]                               │
└─────────────────────────────────────────────────┘
```

#### Screen 9 — Go-live confirmation

```
┌─────────────────────────────────────────────────┐
│  All set                                          │
│                                                  │
│  Marcus is now watching your inbox. You'll see   │
│  the first morning digest tomorrow at 8 AM.      │
│                                                  │
│  Bookmark this page:                              │
│  https://portal.smd.services/operator            │
│                                                  │
│  Questions: scott@smd.services / {Captain phone} │
│                                                  │
│  [Take me to Today]                              │
└─────────────────────────────────────────────────┘
```

Audit event: `ONBOARDING_COMPLETED`. Lands on Today tab.

### Per-screen gating

Each screen has explicit prerequisites. If a prerequisite is unmet, the screen renders an empty-state stub (per `docs/style/empty-state-pattern.md`) and the walkthrough does not advance past it. Captain receives an escalation per `escalation.failure_recipients` from customer.yaml.

| Screen                           | Prerequisite                                                                                                                              | If unmet                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1. Welcome / orient              | customer.yaml present and validated; at least one `personas[]` entry with `status: active`; principal user resolvable per dashboard-roles | Walkthrough cannot start. Principal lands on an "onboarding not yet provisioned" screen and Captain is paged.      |
| 2. Persona review                | personas[0] populated with `name`, `tone`. `signature_html` and `avatar_url` optional (Step 0 provisioning generates if absent).          | Empty-state stub on the missing field; tap-to-edit opens Persona tab. Screen marks itself complete only on Save.   |
| 3. Voice review                  | `voice_library.samples_path` present; voice gate has run at least once per voice-gate-fallback.md (Pass, Near-pass, or Fail recorded).    | If no gate run yet, the screen shows "Gate not yet run, calibration scheduled" with a Captain contact button.      |
| 3. Voice review (gate Near-pass) | Same prereqs as Pass.                                                                                                                     | Screen surfaces voice-gate-fallback.md near-pass calibration cycle copy and the "Run a test draft" CTA.            |
| 3. Voice review (gate Fail)      | Same prereqs as Pass.                                                                                                                     | Screen surfaces voice-gate-fallback.md Path A / Path B disclosure script and disables Step 6's external-skill CTA. |
| 4. Skills configuration          | `personas[0].skills[]` non-empty; every skill resolved against the SKILL.md registry per capability-contracts.md.                         | Screen shows the empty-state stub "No skills enabled yet" and disables the "Looks good" CTA.                       |
| 5. Trust ceiling explainer       | None beyond Screen 4.                                                                                                                     | n/a.                                                                                                               |
| 6. Voice samples upload          | None. This screen is OPTIONAL; the skip path is supported and audited.                                                                    | Skip writes `WALKTHROUGH_STEP_COMPLETED` with `outcome: skipped`.                                                  |
| 7. Trust ceiling first promotion | Voice gate state is Pass (per voice-gate-fallback.md). On Near-pass or Fail, the screen is hidden.                                        | Screen hidden; walkthrough advances directly to Screen 8.                                                          |
| 8. Daily digest setup            | None.                                                                                                                                     | n/a.                                                                                                               |
| 9. Go-live confirmation          | Screens 1, 2, 3, 4, 8 all complete (status `completed` or `skipped`). Screens 5, 6, 7 may be incomplete and onboarding still completes.   | If a required prereq screen is incomplete, Screen 9 cannot render and the walkthrough resumes at the gap.          |

The state machine resolves prerequisites at the start of every walkthrough turn so a resumed session always sees the current gate state, even if voice-gate-fallback.md transitioned between sessions.

### Done criteria

"Onboarding complete" has a precise definition. It is the state where the system commits to running the steady-state loop (morning digest, draft queue, audit log) without further walkthrough prompts.

**For the customer:**

- Principal has read Screen 1, reviewed persona and voice (Screens 2 and 3), confirmed skill set (Screen 4), and set digest cadence (Screen 8).
- Steady-state Today tab is the default dashboard landing surface from this point onward.
- Walkthrough never auto-opens again. A persistent "Walkthrough" entry remains in the More menu for the principal to revisit.

**For the system:**

- `audit_log` contains `ONBOARDING_COMPLETED` (action_type per d1-schema.md, actor = principal, metadata captures which screens completed vs skipped, mobile vs desktop, captain-led vs self-service).
- `customer_configs` projection sets `onboarding_completed_at` to the audit-event timestamp.
- The morning-digest scheduler is armed for the next 8am local (or the time selected at Screen 8).
- The inbox-triage skill is active at `draft_for_review` per the customer.yaml ceiling.
- Voice gate state is Pass, OR (Near-pass / Fail) and the corresponding voice-gate-fallback.md fallback mode is active and surfaced in the dashboard banner.
- Trust ceiling for any `external_send` skill is gated by `external_send_blocked_by_voice_gate` (zero or one) per voice-gate-fallback.md.

Onboarding does not "complete" while any required-screen is incomplete. Captain-led path (next section) writes the same `ONBOARDING_COMPLETED` event with `metadata.captain_led: true`.

### Captain walk-through cadence (co-existing path)

Some customers skip self-service onboarding. The spec accommodates a Captain-led live walk-through at the signed-and-shipped handoff. This is not a fallback; it is a first-class second path that runs alongside the self-service walkthrough.

**When Captain runs it:**

- Inside the signed-and-shipped demo close, while the partner and (typically) the paralegal are still in the room or on the same video call. Captain shares screen and drives the dashboard.
- Within 24 hours of beta-1 sign. The 60 minutes with the partner on the Day-1 schedule is the natural anchor for the principal's walk; the 4 hours with the paralegal is the natural anchor for the operator's walk.

**What Captain runs:**

| Walkthrough step      | Captain-led behavior                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Step 0 welcome email  | Captain sends after the meeting, not before. Email subject reads "Marcus is live at {firm-name}" instead of the self-service variant. |
| Screen 1              | Captain narrates "Here is what we configured for you" while the partner watches. No "Start walkthrough" click; Captain advances.      |
| Screen 2 persona      | Captain confirms the persona name aloud and captures any partner edits live.                                                          |
| Screen 3 voice        | Captain runs one test draft against a synthetic scenario so the partner sees calibrated voice on screen.                              |
| Screen 4 skills       | Captain reads the four default skills aloud, confirms each, opens any drawer the partner asks about.                                  |
| Screen 5 trust        | Captain reads the three-level explainer; no quiz, no required acknowledgement.                                                        |
| Screen 6 voice upload | Optional. Captain offers; partner usually defers to paralegal session.                                                                |
| Screen 7 promotion    | Skipped in the partner session. Captain promotes morning-digest later, after the paralegal session, with partner async sign-off.      |
| Screen 8 digest       | Captain sets cadence to 8am unless partner names a different time.                                                                    |
| Screen 9 go-live      | Captain confirms aloud "Marcus is now watching your inbox. You will see the first digest tomorrow morning."                           |

**What gets written:**

- Every screen still writes `WALKTHROUGH_STEP_COMPLETED` with `metadata.actor: captain`, `metadata.captain_led: true`, `metadata.principal_present: true`.
- `ONBOARDING_COMPLETED` event writes with `metadata.captain_led: true` at the end of Screen 9.
- The compliance evidence packet (per compliance-evidence-packet.md) renders Captain-led onboarding identically to self-service for audit purposes; the only difference is the `actor` metadata field.

**What follows automatically:**

- The principal receives a follow-up email within 1 hour titled "What we covered" with a 12-minute video walkthrough link, a bookmark to the dashboard, and Captain contact details. The video walkthrough is the same content as the self-service flow, narrated by Captain; it is not a re-run requirement.
- The paralegal (Operator) walkthrough runs separately per the Operator onboarding section below, either Captain-led in the §11.9 4-hour session or self-service after the meeting closes.

**Hybrid is supported:**

- Captain may run Screens 1 through 5 live, then hand the partner the dashboard and let the partner finish Screens 6 through 9 on their own time. The state machine resumes from the last completed step regardless of actor. The audit log shows the actor change as the actor metadata field flips between captain and principal mid-walkthrough.

### Operator onboarding (parallel, separate)

If `customer.yaml.users` includes an operator, they receive a separate welcome email. Their walkthrough is the same sequence, except:

- Screen 5 (trust ceiling explainer) reads "Your principal sets these. You can see them but not promote."
- Screen 7 (first promotion) is skipped (operator cannot promote).
- Skip-tab buttons hidden for tabs they don't have access to (per dashboard-roles.md).

### Mobile-specific behavior

Per mobile-approval-flow.md, the partner may complete onboarding on a phone. This is supported as a first-class flow, not a degraded one. Mobile-specific notes per screen:

| Screen | Mobile behavior                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1      | Welcome card stacks vertically. Both CTAs are 56pt-tall full-width buttons (per mobile-approval-flow.md touch-target rule).                            |
| 2      | "Edit persona" opens the Persona tab in a full-bleed sheet, not a side drawer.                                                                         |
| 3      | "Run a test draft" opens the Voice test sandbox on a full-screen modal; the partner types into a 16pt-minimum text input to prevent iOS zoom.          |
| 4      | Skills list renders as stacked cards, one per row. Skill drawer is a full-bleed sheet.                                                                 |
| 5      | The three-level explainer is a swipeable card stack on mobile, vertical-list on desktop. Either is acceptable; the audit event is identical.           |
| 6      | The file picker dispatches the native iOS / Android picker (`<input type="file" capture>` accepted). Supports `.eml`, `.msg`, `.txt`, `.docx`, `.pdf`. |
| 7      | Standard mobile button rules.                                                                                                                          |
| 8      | Time options render as a native time-picker on iOS / Android; the four discrete options also remain selectable for accessibility.                      |
| 9      | "Take me to Today" lands on the mobile Today surface per mobile-approval-flow.md Screen 2.                                                             |

If the mobile file picker fails on the partner's specific device (MDM lock-down per mobile-approval-flow.md ambiguity), the walkthrough writes `MOBILE_UPLOAD_FALLBACK` to `audit_log`, Step 6 marks itself `skipped`, and the partner sees a banner instructing them to open the dashboard on a laptop later. Onboarding still completes per the done criteria above.

### Compliance onboarding

If a compliance user is added, they get a one-screen orientation: "You have read-only access to the Audit tab. Here's how to export a compliance packet." No walkthrough.

## Failure modes

- **Principal abandons walkthrough partway through**: state persisted in localStorage + `audit_log` `WALKTHROUGH_STEP_COMPLETED` events; resumes on next visit at the step after the last completed one.
- **Voice sample upload fails** (R2 5xx): file queued in IndexedDB; banner "Pending upload"; auto-retry on next session.
- **Mobile file picker doesn't work** on partner's specific device: fallback to desktop upload, dashboard tells them to open on laptop. Audit event `MOBILE_UPLOAD_FALLBACK`.

## Verification

1. **End-to-end walkthrough test** at `tests/operator/onboarding-walkthrough.test.ts` (Playwright): fresh fixture customer, click through every step on desktop and mobile, assert every audit event written, final Today tab loads.
2. **Resume test**: simulate abandon at step 4; reopen; assert the walkthrough resumes at step 5 (next after last completed).
3. **Operator-vs-principal divergence test**: log in as both role types in the same fixture customer; assert the operator walkthrough skips trust promotion and shows the limited trust explainer.
4. **Voice-upload mobile test**: iPhone SE viewport in Playwright; drive the file picker via stubbed input; assert R2 write per r2-vectorize-naming.md.

## Implementation notes

- Onboarding state machine: `src/lib/operator/onboarding-state.ts` — tracks current step, last completed step, total steps.
- Step components: `src/components/operator/onboarding/Step{1-9}.tsx`.
- Resume mechanism reads `audit_log` for the latest `WALKTHROUGH_STEP_COMPLETED` event for the user.
- Welcome email rendered server-side from `templates/onboarding-welcome.md`; delivered via Resend.
- Mobile upload picker uses standard `<input type="file" accept=".eml,.msg,.txt,.docx,.pdf">`; service worker buffers if offline.
- Cross-references: dashboard-roles.md (role visibility), voice-gate-fallback.md (gate state surfaces in step 3 if not yet passed), customer-yaml-schema.md (users[] feeds step access).

[AMBIGUITY: The walkthrough assumes the partner has 12 minutes. Empirically, principals from law firms often skip onboarding walkthroughs entirely and let their paralegal handle setup. Captain should plan to do screen 1 + screen 9 live in the demo close, with the rest available as a follow-up email "here's a 12-minute video walkthrough."]
