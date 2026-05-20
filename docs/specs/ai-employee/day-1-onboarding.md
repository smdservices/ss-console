# Day-1 Onboarding Screen Sequence

**Spec for issue #803.** First hour in the dashboard, after Captain-led setup session. Without screen-by-screen sequence, Captain cannot operate fluently in the meeting and onboarding feels improvised. UX Lead's contribution is the source.

## Source

- platform-prd.md §16 (Demo Framework)
- law-firm-prd.md §11.8 (Day-1 / Week-1 / Week-4 partner experience)
- `docs/pm/ai-employee/prd-contributions/round-1/ux-lead.md` User Journey section

## Contract

### Pre-Day-1 context

Captain has already pre-provisioned `hermes-{slug}` (per §16.2 aircraft-carrier moment), conducted the 4-6h Captain-led voice calibration session (§9.6 Gate 2), and run the blind-test. Day-1 begins when the principal first opens the dashboard on their own time.

### Sequence

#### Step 0 — Welcome email (delivered 60s after Captain finalizes onboarding)

Subject: `Welcome — Marcus is ready at {firm-name}`.

```
{Principal first name},

Marcus is configured and ready. Your dashboard is at:

  https://portal.smd.services/ai-employee

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
│  https://portal.smd.services/ai-employee         │
│                                                  │
│  Questions: scott@smd.services / {Captain phone} │
│                                                  │
│  [Take me to Today]                              │
└─────────────────────────────────────────────────┘
```

Audit event: `ONBOARDING_COMPLETED`. Lands on Today tab.

### Operator onboarding (parallel, separate)

If `customer.yaml.users` includes an operator, they receive a separate welcome email. Their walkthrough is the same sequence, except:
- Screen 5 (trust ceiling explainer) reads "Your principal sets these. You can see them but not promote."
- Screen 7 (first promotion) is skipped (operator cannot promote).
- Skip-tab buttons hidden for tabs they don't have access to (per dashboard-roles.md).

### Compliance onboarding

If a compliance user is added, they get a one-screen orientation: "You have read-only access to the Audit tab. Here's how to export a compliance packet." No walkthrough.

## Failure modes

- **Principal abandons walkthrough partway through**: state persisted in localStorage + `audit_log` `WALKTHROUGH_STEP_COMPLETED` events; resumes on next visit at the step after the last completed one.
- **Voice sample upload fails** (R2 5xx): file queued in IndexedDB; banner "Pending upload"; auto-retry on next session.
- **Mobile file picker doesn't work** on partner's specific device: fallback to desktop upload, dashboard tells them to open on laptop. Audit event `MOBILE_UPLOAD_FALLBACK`.

## Verification

1. **End-to-end walkthrough test** at `tests/ai-employee/onboarding-walkthrough.test.ts` (Playwright): fresh fixture customer, click through every step on desktop and mobile, assert every audit event written, final Today tab loads.
2. **Resume test**: simulate abandon at step 4; reopen; assert the walkthrough resumes at step 5 (next after last completed).
3. **Operator-vs-principal divergence test**: log in as both role types in the same fixture customer; assert the operator walkthrough skips trust promotion and shows the limited trust explainer.
4. **Voice-upload mobile test**: iPhone SE viewport in Playwright; drive the file picker via stubbed input; assert R2 write per r2-vectorize-naming.md.

## Implementation notes

- Onboarding state machine: `src/lib/ai-employee/onboarding-state.ts` — tracks current step, last completed step, total steps.
- Step components: `src/components/ai-employee/onboarding/Step{1-9}.tsx`.
- Resume mechanism reads `audit_log` for the latest `WALKTHROUGH_STEP_COMPLETED` event for the user.
- Welcome email rendered server-side from `templates/onboarding-welcome.md`; delivered via Resend.
- Mobile upload picker uses standard `<input type="file" accept=".eml,.msg,.txt,.docx,.pdf">`; service worker buffers if offline.
- Cross-references: dashboard-roles.md (role visibility), voice-gate-fallback.md (gate state surfaces in step 3 if not yet passed), customer-yaml-schema.md (users[] feeds step access).

[AMBIGUITY: The walkthrough assumes the partner has 12 minutes. Empirically, principals from law firms often skip onboarding walkthroughs entirely and let their paralegal handle setup. Captain should plan to do screen 1 + screen 9 live in the demo close, with the rest available as a follow-up email "here's a 12-minute video walkthrough."]
