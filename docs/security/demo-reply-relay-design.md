# Design — Demo Operator autonomous reply (the email-in / email-back loop)

**Status:** Draft for independent security review. Not yet implemented.
**Author:** session 2026-06-11. **Reviewer:** TBD (must be someone other than the author — this touches Phase 1 controls).

## What this enables

The tangible law demo: a prospect emails an intake to a demo address; the demo Operator runs `new-matter-intake` against the seeded Clio dev tenant; the prospect gets the result back by email (a CONFLICT-HOLD or an intake-packet acknowledgment). The open problem is the **reply**: how does the Operator's output get back to the prospect, given the Phase-1 safety model is built to _prevent_ an Operator from autonomously emailing on an untrusted-fed turn?

## The gate stack an autonomous reply must clear (grounded in code)

A reply is `agentmail:reply_to_message`, classified `EXTERNAL_SEND` (`shared/action_classes.py:169`). For it to send autonomously, it must clear, in order (`plugins/hermes-smd-trust/enforce.py`):

1. **Banned-tool** — `reply_to_message` is _not_ banned (ADR 0025; `action_classes.py:98-113`). ✓
2. **Trust ceiling** — `external_send` is fail-closed unless authored (`enforce.py:165`); demo-law would author `autonomous`.
3. **Vertical floor** — `_VERTICAL_FLOORS["law-firm"]` pins `EXTERNAL_SEND` → `draft_for_review` (`enforce.py:643-647`). `resolve_ceiling` takes the most-restrictive, so **the law floor forces the reply to draft even under an authored autonomous ceiling.** This is the `external-send-draft-floor` compliance floor (ADR 0005). **Hard blocker #1.**
4. **Taint-gate** — the inbound prospect email taints the session (`hermes-smd-inbound/__init__.py:83` marks `SESSION_TAINT`); `enforce.py:311-320` refuses autonomous `EXTERNAL_SEND` on a tainted turn. **Hard blocker #2.**
5. **Content-sensitivity floor** — `enforce.py:733` forces money/contract/scope/legal bodies to draft. The receipt-only ack is clean and passes; but the floor exists and would catch a legal-keyword body.
6. **Fabrication gate** — `shared/outbound_gate.py` Tier-2 citation scan (law). The ack is citation-free. ✓ (Runs on draft creation.)

These are two different _kinds_ of control, and conflating them is a mistake:

- **#3 (law external-send-draft floor) is an authorable posture, not a constraint.** Vertical packs are quick-start templates the engagement configures, not expertise the system imposes (Captain doctrine 2026-06-11) — "it's the client's operator, they configure as they will." And the floor's own rationale (ADR 0005) is about _client/tribunal-bound legal mail_; a demo Operator replying to a prospect who emailed in is outside that scope. So we don't _defeat_ #3 — we **author the demo's posture** past it. (Separate finding: the code floors _all_ law external*send, blunter than ADR 0005's actual scope; and the floor being \_non-raisable* is itself in tension with "they configure as they will" — a product thread to revisit, non-blocking here.)
- **#4 (the taint-gate) is an integrity control, not an entitlement.** It doesn't say the operator "isn't allowed to send" — it says untrusted inbound can't _make_ it autonomously act (prompt-injection defense). Authoring it off grants no capability; it just opens the hole. So the design goal is to deliver the reply capability _without_ loosening it.

The relay below does exactly that: it gives the operator the full reply capability while keeping the injection defense (#4) intact.

## Recommended design — a trusted demo reply relay (defeats neither floor)

**Key insight:** under both floors, the agent already produces exactly what we want — a **governed draft** of the acknowledgment (UPL-safe, receipt-only on conflict, fabrication-scanned at draft creation). We don't need the _agent_ to send. A small, deterministic, demo-scoped **relay** sends that draft to the verified inbound sender. The agent's safety floors stay fully intact; "autonomous send" is implemented _outside_ the model's governed tool path by trusted code with fixed behavior.

### Components

1. **Record inbound origin (new per-session state).** When the webhook router dispatches the prospect email, record `session_id → {sender_address, message_id, content_digest}` in a new bounded `SESSION_INBOUND_ORIGIN` register (parallel to `SESSION_TAINT` in `shared/inbound.py`). This is the recipient-lock anchor — `SESSION_TAINT` today records only the trust _class_, not _who_ sent it.
2. **The relay (`hermes-smd-demo-relay`, a NEW demo-scoped plugin).** Fires on `post_tool_call` for `agentmail:create_draft` (the draft the skill produces). It sends **only when all hold**, else no-op:
   - the customer authored `demo.reply_relay: enabled` (fail-closed; absent ⇒ off — no relay for any real customer);
   - the draft is a reply to the recorded inbound `message_id` for this session, and its recipient resolves to the recorded `sender_address` (**recipient-lock** — the reply can only go back to whoever emailed in);
   - the draft body re-passes `content_floor.classify` **and** `outbound_gate.evaluate` (so the relay enforces the same content/fabrication floors the autonomous-send path would have);
   - a per-sender + global **rate-limit** is not exceeded.
     On all-pass, the relay sends via the AgentMail reply API keyed on `message_id`, and emits an audit row (`DEMO_RELAY_SENT`) with the draft digest + recipient.

### Why this is safe

- **No agent floor is weakened.** The law external-send-draft floor, the taint-gate, the content floor, and the fabrication gate all stay exactly as hardened. The agent still cannot autonomously send — it drafts.
- **Recipient-lock is structural.** The relay can only send to the address that emailed in (the recorded origin), keyed on the original `message_id`. An injected "send to X" cannot redirect it — the relay ignores any recipient except the recorded sender.
- **The body is governed, not attacker-steered.** The relay sends the _skill's_ output draft, which is produced under all the agent's floors and the skill's own UPL/no-fabrication invariants (validated 2026-06-11: `new-matter-intake` holds the UPL line and produces a receipt-only ack even under bait). The relay additionally re-runs the content + fabrication gates before sending.
- **Contained blast radius.** The demo Operator has synthetic firm data only (no real client data to exfiltrate), no real connectors beyond seeded Clio (read) + AgentMail, and rate-limiting. The classic "sender is the attacker" residual (an attacker steering a reply to themselves) has **no payoff**: recipient-locked to the attacker's own address, body governed, nothing sensitive to leak.
- **Fail-closed + demo-only.** `demo.reply_relay` is unauthored everywhere except demo-law; absent ⇒ the relay never acts. It cannot regress a real customer.

## Alternative considered — in-agent taint-gate carve-out (NOT recommended)

Author the demo's posture past the law floor (fine — it's the client's operator, and a prospect reply is outside ADR 0005's scope) **and** add a taint-gate exception permitting `reply_to_message` to the verified inbound sender on a tainted turn. **Rejected** not because the operator is "forbidden" anything, but because the taint-gate is an _integrity_ control: adding a configurable exception to it puts a hole in the injection defense — a hole whose blast radius is every customer that ever uses the exception, to get a capability the relay already delivers without it. The relay achieves the identical demo UX while leaving the injection defense byte-for-byte intact.

## Alternative considered — web-display (no send path at all)

The prospect's result is shown on the demo web surface (via the runtime-read seam) instead of emailed back. Avoids all send-path security. **Not chosen** because the stated demo intent is the email-in / email-back loop (prospect emails, Operator emails the result back). Kept on file as the lowest-complexity fallback if the relay review stalls.

## Code touch points (overlay repo `hermes-smd-overlay`, separate PR)

- `shared/inbound.py` — add `SESSION_INBOUND_ORIGIN` (bounded, per-session sender/message_id/digest).
- `plugins/hermes-smd-webhook-router/` — record the inbound origin on dispatch of a prospect email.
- `plugins/hermes-smd-demo-relay/` — NEW plugin: the relay (post_tool_call on `create_draft`, recipient-lock + content/fabrication re-check + rate-limit + send + audit).
- `shared/customer_config.py` / customer.yaml schema (ss-console) — the `demo.reply_relay` authored flag, fail-closed.
- Tests: recipient-lock (cannot send to a body-derived address), fail-closed (no flag ⇒ no send), content-floor re-check, rate-limit, and that a real (non-demo) customer's behavior is unchanged.

## Independent-review checklist (the reviewer must confirm)

1. The relay can send **only** to the recorded inbound sender — no path lets a body-derived or injected recipient through.
2. `demo.reply_relay` is fail-closed: any customer without it authored gets zero relay behavior; a real customer cannot be regressed.
3. The agent's floors (law external-send, taint-gate, content floor, fabrication gate) are byte-for-byte unchanged.
4. The relay re-applies `content_floor` + `outbound_gate` to the draft body before sending.
5. Rate-limit bounds per-sender and global send volume.
6. Threat model line: state plainly that the safety rests on recipient-lock + synthetic-data containment + governed-draft body, and that the relay must NOT be enabled for any customer holding real client data without a further review.
