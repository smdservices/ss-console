# Ashton & Price — Entitlement Configuration (onboarding surface)

**Who decides:** the firm. Every entitlement below is **A&P's to specify**. We bring
a recommended default and the reasoning for it; Christa and Chris confirm or change
each one. This is a standing, forward part of onboarding — not something we set
quietly on the firm's behalf and not a system default. (Doctrine: ADR 0035
no-imposed-defaults; ADR 0025 configurable per action class. ADR 0005's old
"external-send floor" is **retired** — external send holds no special status over
any other entitlement.)

This worksheet is the source the firm signs off on; it materializes into
`customer.yaml` (`scope.action_ceilings`, `inbound_allow_from`, connector grants).

## How entitlement works

Two independent dials, set **per action class** and **per connector/identity**:

- **Ceiling** — how far the Operator may go on its own: **autonomous** (acts) →
  **draft_for_review** (prepares, a named human approves) → **refused** (won't act).
- **Reach** — _who/what_ it may touch: which inbox folders, which recipients are
  in-roster vs. out, which connectors are wired at all.

The action classes (the whole spectrum — send is one row, not the headline):

| Action class                                                | What it covers                                                   | Our recommended default for A&P                    | Why                                                                                                                                      | **Firm specifies** |
| ----------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **read**                                                    | see matters, docs, calendar, inbox                               | **autonomous**                                     | the Operator can't coordinate what it can't see                                                                                          |                    |
| **internal_write**                                          | Smokeball memos, tasks, folders, staging, internal notes/digests | **autonomous**                                     | this is the bulk of the work; nothing leaves the firm                                                                                    |                    |
| **external_send — to firm staff**                           | replies to Chris/Christa/@ashtonandprice.com who email it        | **autonomous, recipient-locked** (ADR 0055 roster) | a coordinator that needs a click to answer staff isn't a coordinator                                                                     |                    |
| **external_send — to clients / opposing / court / vendors** | any outbound to a non-firm recipient                             | **draft_for_review** (a named approver)            | client- and tribunal-bound mail under a human, while a brand-new pilot earns trust; **graduate per recipient-class as the firm chooses** |                    |
| **commitment**                                              | signing, accepting terms, agreeing to dates                      | **refused / never autonomous**                     | a licensed human makes legal attestations                                                                                                |                    |
| **destructive**                                             | delete/remove                                                    | **per-call approval**                              | reversible-by-default; explicit confirm                                                                                                  |                    |
| **code_execution**                                          | arbitrary code / shell / subagent                                | **authored-only, fail-closed**                     | off unless a specific use authors it                                                                                                     |                    |

Blank cells in the last column = the firm's call to fill at onboarding. A class with
nothing authored is **fail-closed: refused** (never silently drafted).

## Reach — also the firm's to specify

- **Inbox visibility:** default Inbox + Sent; the firm names any folder kept blind.
- **Reply roster (`inbound_allow_from`):** who gets real answers vs. a draft.
  Default = the whole firm + the SMD operator. Anyone outside is drafted.
- **Connectors wired:** Smokeball (system of record) + the Operator's own inbox at
  go-live; M365, InfoTrack, etc. added as each seam comes live — each is a grant the
  firm makes, not an assumption we carry.

## Not on the dial — integrity controls (these are not entitlements)

Two controls are retained regardless of how the firm configures the above, because
turning them "off" grants no capability — it only opens a hole:

- **Irreversibility ban** — no autonomous money movement, ledger posting, or court
  filing at the adapter level (`BANNED_METHOD_NAMES`). This is a conservative
  **default, not immutable**: if the firm later wants one of these, it's a deliberate
  per-connector unban that falls through to the commitment/destructive approval gate —
  not a rearchitecture. We'd surface that as its own decision.
- **Taint-gate** — an outside party who emails the Operator cannot _make_ it act
  autonomously (prompt-injection defense). The firm's authored autonomy still applies
  to the firm's own instructions; this only stops untrusted inbound from escalating.

## The graduation conversation (recommended, firm's choice)

For the highest-value sends (e.g. the client-verification chase — A&P's #1
slippage), our recommendation is **draft-first during per-matter validation, then
graduate to autonomous** once it proves out — but that pace is the firm's to set.
The firm may also choose autonomous from day one, or keep a permanent approver on a
given recipient-class. We implement what A&P specifies here.

---

_This is the A&P instance of the standard Operator onboarding entitlement step.
Every engagement gets one; the recommended-default column is ours, the
firm-specifies column is the client's._
