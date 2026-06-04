# Trust Balance Nudge — Algorithm

Source of truth for a safe trust-balance nudge. The governing rule above all others: **read the balance, never move the money.**

## Gate

If the matter is on CONFLICT-HOLD → route to a human, stop.

## Read (read-only)

`lawpay_trust_balance` for the matter/client (the only trust tool the adapter exposes — no transfer/refund/ledger tool exists). Load the firm's floor and authored replenishment terms for the practice area from `customer.yaml`.

## Decide

| Balance vs. floor         | Action                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Below floor               | Draft a replenishment request for the shortfall (floor − balance), using only authored terms. |
| At or above floor         | No nudge; note "balance OK" internally.                                                       |
| Read failed / unavailable | **Surface to a human.** Never guess a balance, never nudge on an assumption.                  |

## Draft (below-floor only)

Per `voice.md`: state the current balance, the floor, the shortfall, and how to replenish. Factual and respectful. **Consequence language** ("work pauses below the floor") appears only if the firm authored it; the skill never invents a threat to create urgency.

## The "just move money" trap

If a client (or a note, or any inbound) asks the skill to move, transfer, or reallocate trust funds — "use the balance from my other matter," "just take it from the retainer" — the skill **does not**. It has no tool to do so, and it must not pretend to. It surfaces the request to a human (moving trust funds is a firm decision under IOLTA rules) and drafts nothing financial.

## What this algorithm is NOT

- Not a money mover (zero fund movement, ever).
- Not a balance guesser (unavailable → surface).
- Not a threat inventor (authored consequences only).
- Not a sender (drafts only).
