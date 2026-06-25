# {{CUSTOMER_NAME}} — Entitlement Configuration (onboarding surface)

> Copy this to `operator/customers/<slug>/ENTITLEMENTS.md` at onboarding, fill the
> **client-specifies** column with the customer, then materialize the result into
> `customer.yaml` (`scope.action_ceilings`, `inbound_allow_from`, connector grants).
> The A&P instance (`operator/customers/ashton-price/ENTITLEMENTS.md`) is the worked
> example.

**Who decides:** the customer. Every entitlement below is **theirs to specify**. We
bring a recommended default and the reasoning; the customer confirms or changes each
one. This is a standing, forward part of onboarding — never something we set quietly
on their behalf, and never a system default. (Doctrine: ADR 0035 no-imposed-defaults;
ADR 0025 configurable per action class. ADR 0005's old "external-send floor" is
**retired** — external send holds no special status over any other entitlement.)

## How entitlement works

Two independent dials, set **per action class** and **per connector/identity**:

- **Ceiling** — how far the Operator may go on its own: **autonomous** (acts) →
  **draft_for_review** (prepares, a named human approves) → **refused** (won't act).
- **Reach** — _who/what_ it may touch: which inbox folders, which recipients are
  in-roster vs. out, which connectors are wired at all.

The action classes (the whole spectrum — external send is one row, not the headline):

| Action class                           | What it covers                                | Typical recommended default                                                                     | Why                                                       | **Customer specifies** |
| -------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------- |
| **read**                               | see records, docs, calendar, inbox            | **autonomous**                                                                                  | can't coordinate what it can't see                        |                        |
| **internal_write**                     | notes, tasks, drafts, internal state, staging | **autonomous**                                                                                  | the bulk of the work; nothing leaves the org              |                        |
| **external_send — to staff**           | replies to verified in-org senders            | **autonomous, recipient-locked** (roster)                                                       | an assistant that needs a click to answer staff isn't one |                        |
| **external_send — to outside parties** | any outbound to a non-roster recipient        | **draft_for_review** (a named approver), graduating per recipient-class as the customer chooses | conservative while a new engagement earns trust           |                        |
| **commitment**                         | signing, accepting terms, agreeing to dates   | **refused / never autonomous**                                                                  | a human makes binding commitments                         |                        |
| **destructive**                        | delete / remove                               | **per-call approval**                                                                           | reversible-by-default; explicit confirm                   |                        |
| **code_execution**                     | arbitrary code / shell / subagent             | **authored-only, fail-closed**                                                                  | off unless a specific use authors it                      |                        |

Blank cells in the last column = the customer's call at onboarding. A class with
nothing authored is **fail-closed: refused** (never silently drafted).

## Reach — also the customer's to specify

- **Inbox visibility:** which folders the Operator sees vs. stays blind to.
- **Reply roster (`inbound_allow_from`):** who gets real answers vs. a draft.
- **Connectors wired:** each connector is a grant the customer makes; capabilities
  turn on as each seam comes live, not by assumption.

## Not on the dial — integrity controls (these are not entitlements)

Two controls are retained regardless of how the customer configures the above,
because turning them "off" grants no capability — it only opens a hole:

- **Irreversibility ban** — no autonomous money movement, ledger posting, or court
  filing at the adapter level (`BANNED_METHOD_NAMES`). A conservative **default, not
  immutable**: a customer that wants one of these gets a deliberate per-connector
  unban that falls through to the commitment/destructive approval gate — surfaced as
  its own decision, not a silent grant.
- **Taint-gate** — an outside party who messages the Operator cannot _make_ it act
  autonomously (prompt-injection defense). The customer's authored autonomy still
  applies to the org's own instructions; this only stops untrusted inbound from
  escalating.

## The graduation conversation (recommended, customer's choice)

For the highest-value outside sends, a common recommendation is **draft-first during
early validation, then graduate to autonomous** once it proves out — but that pace is
the customer's to set. They may choose autonomous from day one, or keep a permanent
approver on a given recipient-class. We implement what they specify here.

---

_This is the standard Operator onboarding entitlement step. Every engagement gets
one; the recommended-default column is ours, the customer-specifies column is theirs._
