# 08 — Scott → Christa: Portal invite + Operator configuration summary

- **Date:** 2026-07-16
- **From:** Scott Durgan (smdurgan@smdurgan.com)
- **To:** Christa Barrera (Christa@ashtonandprice.com)
- **Subject:** Re: Litigation Lifecycle Solution
- **Gmail message-id:** quoted in msg `19f9106a765c30ff` (Christa's 2026-07-23 reply); re-fetchable from that thread
- **Status:** Substantive outbound — introduces the Client Portal as the configuration source of truth and restates the full routine grid; asks for the three owed answers (verification attempts, treatment-gap days, grid changes)

> Archived verbatim from the plaintext body as quoted in Christa's reply. URL artifacts
> (google.com redirect wrappers) are the mailbox's plaintext rendering, not edits.

---

Hi Christa,

Quick check-in. We have been building and testing your Operator against the Litigation Lifecycle as it is currently defined, and it continues to take good shape.

You can view the current configuration in our Client Portal, which is provided as a consolidated source of truth for the current state of the Operator as we finalize the details. This also serves as a future reference for what the Operator can and cannot do ongoing.
Review your Operator →

A few things we still need from you to finish:

1. Client verification. How many unanswered attempts before it stops chasing your client and escalates to a person?
2. Medical chronology. The treatment-gap length to flag (for example, 30 or 60 days).
3. The routines below. Anything on the grid you'd set differently.

We're moving ahead on everything that doesn't need you. The summary configuration is listed below for your convenience as well as in additional detail in the Portal.

We are prepared to stand up the Operator whenever you are. Once that occurs and the connections to your systems have been authorized we may begin a testing phase. Naturally, everything would be switched off initially, and we would proceed to switch them on methodically per a test plan we would build together.

Please let me know if there is anything further I can do to help.

Thanks,
Scott Durgan

Operator configuration
Ashton & Price LLP
Status: Setup in progress

The Operator
Operator
AI Case Coordinator
Tone: Plainspoken, warm but professional, and concise.
The name is yours to set whenever if you like.

What it does
Three settings per routine: Surfaces it (just flags it), Prepares it for you (drafts it, a person approves), Handles it (does it on its own). Below is where each one runs today and the highest it can go. Anything to opposing counsel or the court always takes a person's send.

Discovery

- Served discovery caught — On request · When something happens — Now: Surfaces it — Limit: Flag-only (only surfaces)
- Response deadlines — On request · On a schedule — Now: Prepares it for you — Limit: Prepare-and-route (capped: deadline)
- Client verification — On request · On a schedule — Now: Prepares it for you — Can be raised to: Handles it (Auto-handle, once you are comfortable) — ⚑ Awaiting your setting: attempts before it escalates to a person
- Separate statement — On request — Now: Prepares it for you — Limit: Prepare-and-route (capped: before a judge)
- Opposing responses reviewed — On request · When something happens — Now: Surfaces it — Limit: Flag-only (an assist, not an authority)
- Meet-and-confer letter — On request — Now: Prepares it for you — Limit: Prepare-and-route (capped: opposing counsel)
- Response inputs staged — On request — Now: Prepares it for you — Can be raised to: Handles it (Auto-handle, once you are comfortable)

Case initiation

- New matter setup — On request — Now: Prepares it for you — Can be raised to: Handles it (Auto-handle, once you are comfortable)
- Service confirmation — On request · On a schedule — Now: Surfaces it — Limit: Flag-only (capped: deadline)

Medical records and chronology

- Records chase — On request · On a schedule — Now: Prepares it for you — Can be raised to: Handles it (Auto-handle, once you are comfortable)
- Medical chronology — On request · On a schedule — Now: Handles it (runs on its own) — Limit: Internal record only (never characterizes) — ⚑ Awaiting your setting: treatment-gap length to flag

Motions

- Motion calendar — On request · On a schedule — Now: Surfaces it — Limit: Flag-only (only surfaces)
- Motion package — On request — Now: Prepares it for you — Limit: Prepare-and-route (capped: before a judge)

Minor's compromise

- Minor's compromise packet — On request · On a schedule — Now: Prepares it for you — Limit: Prepare-and-route (capped: money and court forms)

Trial prep

- Trial binder — On request · On a schedule — Now: Prepares it for you — Limit: Prepare-and-route (capped: deadlines and court)

Mediation, settlement, and liens

- Mediation and settlement — On request · On a schedule — Now: Prepares it for you — Limit: Prepare-and-route (capped: deadline and settlement)
- Lien ledger — On request · On a schedule — Now: Surfaces it — Can be raised to: Prepares it for you (Prepare-and-route, capped: money)
- Settlement statement — On request — Now: Prepares it for you — Limit: Prepare-and-route (capped: money)

Firm-wide

- Daily "what needs you" — On request · On a schedule — Now: Surfaces it — Limit: Flag-only (only surfaces)

What it must leave alone
Built into how it operates. These do not change:
• Moving money or making payments
• Posting to money ledgers
• Creating new files in your practice management system
It never e-files, and anything bound for opposing counsel or the court always takes a person's send.

What it's connected to
Smokeball: your practice management system — System of record · Managed by SMD
It reads your matters and writes the tasks, calendar entries, folders, and drafts it prepares. It never moves trust money or posts to your financial ledgers. You authorize the connection once with your Smokeball owner, and we set it up together.

AgentMail: the Operator's own inbox — Managed by SMD
A dedicated, monitored inbox that reads its own Inbox and Sent, and never sees anything you don't send to it. That gives you a clean record of what the Operator saw and when.

Who it works with
Answers directly: Everyone at ashtonandprice.com. Anyone outside the firm is prepared for a person to review and send, never answered on its own.
Alerts go to: SMD, while we run the Operator with you during the pilot. Your own people can be added whenever you want them in the loop.
Blocks: None set.

SMD Services · Litigation Lifecycle Operator · This reflects the configuration as it stands today.
