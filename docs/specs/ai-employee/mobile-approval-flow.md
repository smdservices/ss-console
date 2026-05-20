# V1 Mobile Approval Flow

**Spec for issue #799.** Screen-by-screen specification for the 60-second partner loop: morning digest → phone → tap → review → approve. Target Customer named this as a sign-or-no-sign condition: *"I'd want to see the actual approval UX during the demo. Not described. Shown."* If the demo can't drive this end-to-end on the partner's phone, the meeting fails.

## Source

- platform-prd.md §12 (dashboard IA)
- `docs/pm/ai-employee/prd-contributions/round-1/ux-lead.md` User Journey + Gap 6
- `docs/pm/ai-employee/prd-contributions/round-1/target-customer.md` sign-conditions

## Contract

### The 60-second loop (target wall-clock)

```
0s   Partner opens phone, sees Hermes email in inbox
3s   Tap email → opens morning digest summary
8s   Tap "5 drafts pending" → opens Queue on phone (web app)
14s  Tap first draft card
18s  Read draft body
30s  Tap "What Marcus used to write this" → see sources
42s  Tap "Send" → confirmation modal
46s  Confirm
50s  Next draft auto-loads
```

p95 wall-clock budget per the platform-prd.md §16.2 performance commitments: draft load ≤8s, send confirmation ≤2s.

### Screen 1 — Morning digest email

Delivered at customer's local 8am via Resend. Subject line includes draft count: `[Hermes] 5 drafts pending — {date}`.

```
┌─────────────────────────────────────┐
│ Hermes daily digest — Thu May 20    │
│                                     │
│ Pending review:    5 drafts         │
│ Flagged:           1 item           │
│ Absorbed corrections: 3 (last 24h)  │
│                                     │
│ [Open Queue]   <— primary CTA       │
│                                     │
│ Top item: Reply to Karen Chen re:   │
│ Hendricks intake (high priority)    │
│ [Review now]                        │
│                                     │
│ Sent from your AI Employee at SMD   │
└─────────────────────────────────────┘
```

CTAs deeplink to `https://portal.smd.services/ai-employee/queue` (Open Queue) and `https://portal.smd.services/ai-employee/queue/{draft-id}` (Review now). Both require Clerk session — if expired, magic-link re-auth lands them back at the deeplink within 8s.

### Screen 2 — Today (mobile)

```
┌─────────────────────────────────────┐
│  Hermes                       [☰]   │
│  Marcus | Thu May 20, 8:04          │
│─────────────────────────────────────│
│  5 drafts pending review            │
│  1 item flagged                     │
│  3 corrections absorbed             │
│                                     │
│  ▶ Review Queue ──────────────────  │
│  ▶ Flags                            │
│                                     │
│  This week:                         │
│  Marcus drafted 47, sent 42,        │
│  flagged 3, learned from 6.         │
└─────────────────────────────────────┘
```

Touch targets ≥44×44pt (WCAG 2.2 AA). Stack-vertical layout; no horizontal scroll. Bottom nav: Today, Queue, Memory, More.

### Screen 3 — Queue list (mobile)

```
┌─────────────────────────────────────┐
│  ← Queue (5 pending)          [⚙]  │
│─────────────────────────────────────│
│ ●●●  Karen Chen   12m ago     ⚠    │
│   Re: Hendricks intake             │
│   "Thanks for the clarification..." │
│─────────────────────────────────────│
│ ●●    Bob (Acme Ins)  1h ago        │
│   Re: settlement timing            │
│   "Confirming receipt of..."        │
│─────────────────────────────────────│
│ ●     Vendor X   2h ago             │
│   Invoice question                  │
│   ...                              │
└─────────────────────────────────────┘
```

Priority dots (●●●/●●/●) read priority 1-3/4-6/7-10 from `draft_queue.priority`. ⚠ = `FABRICATION_FILTER_TRIGGERED` (severity=flag). Tap row → Screen 4.

### Screen 4 — Draft detail (mobile)

```
┌─────────────────────────────────────┐
│  ← Hendricks intake reply       ⋮  │
│─────────────────────────────────────│
│  To: Karen Chen <kc@acmeplaintif…>  │
│  Subject: Re: Hendricks intake      │
│─────────────────────────────────────│
│  Karen,                             │
│                                     │
│  Thanks for the clarification on   │
│  the policy limits. I'll review    │
│  the medical records ...           │
│                                     │
│  Best,                              │
│  Mark                               │
│─────────────────────────────────────│
│  ▼ What Marcus used to write this   │
│                                     │
│  • Memory rule: "Always sign with  │
│    first name to clients"          │
│  • Person mapping: Karen Chen      │
│    (opposing counsel, Acme)        │
│  • Matter: Hendricks (PI, open)    │
│  • Voice cohort: anxious-client     │
│─────────────────────────────────────│
│  [Edit]  [Flag]   [Send] ◄ primary  │
└─────────────────────────────────────┘
```

The "What Marcus used" block is collapsed by default — tap to expand. It shows the `audit_log.input_digest` resolved to human-readable source descriptions. The send button is the primary CTA, full-width across the bottom, 56pt tall for thumb reach.

### Screen 5 — Send confirmation modal

```
┌─────────────────────────────────────┐
│         Confirm send                │
│                                     │
│  Send "Re: Hendricks intake" to     │
│  Karen Chen <kc@acmeplaintif…>?     │
│                                     │
│  This sends from your Outlook       │
│  drafts as you.                     │
│                                     │
│       [Cancel]      [Send]          │
└─────────────────────────────────────┘
```

Required confirmation prevents accidental thumb-tap sends. Modal is a sheet overlay; tap outside cancels. "Send" CTA at right; "Cancel" at left (iOS pattern). After confirm: `draft_queue.status = approved`, `audit_log.DRAFT_APPROVED` event, the draft moves out of the queue, and the next pending draft auto-loads.

### Screen 6 — Empty/done state

```
┌─────────────────────────────────────┐
│  ← Queue (0 pending)          [⚙]   │
│─────────────────────────────────────│
│                                     │
│         All caught up               │
│                                     │
│  Marcus has nothing pending right   │
│  now. You'll see a digest tomorrow  │
│  at 8am.                            │
│                                     │
│  [View Today]                       │
│                                     │
└─────────────────────────────────────┘
```

### Offline tolerance

The mobile web app caches the current Queue list and the currently-open draft in the service worker. If the network drops mid-flow:
- Reading existing drafts: works
- Editing: queued in IndexedDB; banner "Pending sync" displayed
- Sending: blocked with banner "Reconnect to send" — never optimistic. Send is a real upstream call that requires confirmation from the email adapter; we don't fake it.

When connectivity returns, queued edits sync within 5s and the banner clears.

### Accessibility

- All interactive elements meet WCAG 2.2 AA touch targets (44×44pt minimum, 56pt tall primary CTAs).
- Color contrast ≥4.5:1 for body text, ≥3:1 for large text.
- Screen-reader labels on every icon (⚠, ⋮, ☰).
- Native iOS/Android keyboard focus management.

## Failure modes

- **Session expired** → Clerk magic-link re-auth flow within the same browser tab; deeplink resumed automatically.
- **Draft no longer in queue** (e.g., the operator approved it from desktop while partner was reviewing on phone) → screen shows "This draft was already handled by {name} at {ts}"; tap "Next pending" to continue.
- **Send fails upstream** (Microsoft Graph 5xx) → draft remains in queue; banner "Send couldn't complete — try again or escalate"; audit event `DRAFT_APPROVAL_SEND_FAILED`.
- **Voice gate not passed** → external_send drafts don't appear in mobile queue; banner "Voice gate calibration in progress" per voice-gate-fallback.md.

## Verification

1. **Playwright mobile profile** at `tests/ai-employee/mobile-queue.test.ts` runs the 60-second loop end-to-end on a 375×667 viewport (iPhone SE baseline); asserts p95 wall-clock from list-tap to send-confirm ≤8s.
2. **Touch-target test** (`tests/ai-employee/mobile-a11y.test.ts`): every tappable element on every queue/draft screen passes the 44×44pt rule.
3. **Service-worker offline test**: simulate network drop after queue load; assert read paths work, write paths show the right banner, sync resumes cleanly.
4. **Visual regression**: screenshots of every screen at iPhone SE + iPhone 14 Pro Max + Pixel 7 baselines.

## Implementation notes

- Mobile layout shares the Queue and Memory components with desktop via responsive breakpoints; primary divergence is bottom-nav (mobile) vs side-nav (desktop), and full-bleed full-screen draft detail on mobile.
- Mobile-only file: `src/components/ai-employee/MobileBottomNav.tsx`.
- Modal sheet pattern: `src/components/ai-employee/SendConfirmSheet.tsx`.
- Service worker: `src/sw/ai-employee-queue-cache.ts`; caches `/api/ai-employee/queue` + per-draft GET.
- Deeplink handler: `src/middleware.ts` already proxies portal subdomain; adds `/ai-employee/queue/{id}` route.
- The "What Marcus used" sourcing block reads from `audit_log.input_digest` + a sourcing resolver at `src/lib/ai-employee/source-resolver.ts` that maps digests to readable descriptions of memory rules / person mappings / matter attributes.

[AMBIGUITY: The 60-second loop assumes the partner is reviewing on their phone in their own kitchen with no domain restrictions. If the firm restricts personal device access via MDM, the dashboard may need to be reachable from desktop only or via an enterprise app store. Confirm during day-1 onboarding.]
