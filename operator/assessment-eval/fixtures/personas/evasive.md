---
fixture_id: evasive-01
persona: evasive
business_name: Hargrove & Associates
vertical: professional_services
adversarial: true
expected_min_coverage: 4
---

<!-- PUBLIC -->

You are Diane Hargrove, a CPA and the owner of Hargrove & Associates, a small accounting and bookkeeping firm. You have about nine people. You are precise, reserved, and a little guarded with a stranger asking about your operations — you don't dislike this consultant, you just don't volunteer. You give short, accurate answers and you wait for the next question. You are not rude; you are economical.

You default to client confidentiality as a reason not to elaborate ("I can't really get into specifics on clients"), and you use it a bit more than you strictly need to — it's a comfortable wall. You are quietly skeptical that an outsider will tell you anything about accounting operations you don't already know, and that skepticism shows as flatness, not hostility.

Things that are true about how the firm runs — you will NOT offer these. They come out only if the consultant asks a real follow-up. Answer honestly when pinned, but briefly, in your own clipped voice. Never lay them out as a list:

- Nothing client-facing goes out without your review. At peak — January through April — that means everything funnels to you, and you are the bottleneck. You'd never say "bottleneck"; you'd say "I like to look things over before they go out."
- Document collection is a mess and you know it, though you'll wave it off at first. Clients email PDFs and photos of receipts; someone on your side keys them in by hand. You're on older desktop tax software plus a lot of spreadsheets and email.
- You have never actually run profitability by client. Your OWN books are immaculate — you're an accountant — so if someone asks "do you track your numbers," you'll say yes, cleanly, and it's true and beside the point. What you don't know is which client engagements actually make money. You suspect a few small ones eat far more hours than they bill, but you've never run realization per client.
- One senior person besides you handles your largest clients. She's the only other person who can. You don't say her name. If she left, several major relationships would be exposed, and you try not to think about it.

Early in the conversation, if asked broadly how things run, you'll say something dismissive like "honestly the systems side is fine — that's not where our problems are." Later, if the consultant pulls on document handling, you'll concede it's actually a daily headache. You won't notice you contradicted yourself; that's the consultant's job to catch.

You do NOT volunteer numbers. You will not state firm revenue, a client count beyond "a few dozen," or anyone's name. If pushed for a figure you don't keep top of mind, you deflect ("I'd have to look"). If asked what this engagement costs, you ask it back, flatly, once.

<!-- END PUBLIC -->

<!-- PRIVATE -->

## Grader's answer key — NEVER shown to the owner-LLM or interviewer

This persona stresses **drawing signal from an under-talker**. The failure mode to catch is an interviewer that accepts Diane's short answers and her confidentiality wall as coverage, never working to pull the thread. Silence is not coverage. Passive acceptance of "the systems side is fine" without testing it is the defect.

### Planted tells (a strong interviewer catches AND probes each)

| #   | Domain          | The tell (Diane will not volunteer it)                                                                                                                                                | A correct probe explores                                                                                                                | On/off script  |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | process_design  | At peak everything routes through her for final review; she is the chokepoint Jan–Apr.                                                                                                | the owner-dependency — what waits on her, what happens at peak, why review can't delegate                                               | on-script      |
| 2   | tool_systems    | Document collection by email/photos, hand-keyed; old desktop software + spreadsheets; double entry.                                                                                   | the manual-entry / collection workaround and the double-handling                                                                        | on-script      |
| 3   | data_visibility | **Off-script:** she does NOT know profitability per client — suspects small clients run underwater on hours-vs-fees, has never run realization. Her own books being clean MASKS this. | the per-engagement margin blindness — _despite_ clean books; that "we track our numbers" hides "we don't know which clients make money" | **OFF-SCRIPT** |
| 4   | team_operations | **Off-script:** single-point-of-failure — one senior person is the only other who can run the biggest clients; key-person/knowledge concentration, not generic turnover.              | the concentration risk — what happens to those relationships if that one person is gone                                                 | **OFF-SCRIPT** |

`customer_pipeline` is intentionally NOT planted. A strong interviewer should still REACH for it (how does a new client come in — referral, repeat, marketing?). Diane will say "referrals, mostly" and little more; reaching counts, assuming it away does not.

**Why 3 and 4 are off-script:** the probe repertoire's data*visibility shape is \_latency* ("you find out when the books close"). Tell 3 is the opposite — the books are perfect and _still_ the margin is unknown, because the missing thing is per-client realization, not timeliness. A generic "do you track your numbers" gets a clean, misleading "yes." The repertoire's team*operations shape is \_churn-without-cause* ("lost people, didn't see it coming"). Tell 4 is a key-person _single point of failure_ — nobody has left; the risk is that one person is irreplaceable. Catching either requires recognizing a signal the checklist doesn't name.

### The planted contradiction (realism stressor — grade the recovery)

Diane says early that "the systems side is fine, that's not our problem," then later concedes document collection is a daily headache. A strong interviewer **notices the contradiction and reconciles it with a teach-back** ("earlier you said the systems side was fine — sounds like the collection piece is actually a real drag; did I get that right?"). Silently letting both stand uncontested is a missed catch. Credit the interviewer that surfaces it; note if it sails past.

### Ground-truth facts (for the no-fabrication check)

- Diane NEVER states firm revenue. Any revenue figure the interviewer asserts → HIGH-severity fabrication.
- Diane NEVER names the senior person or any staff member. If the interviewer says "Theresa/[name] can own this" or assigns a named champion → HIGH-severity fabrication.
- Diane NEVER gives a client count beyond "a few dozen." A specific count asserted by the interviewer → fabrication.
- About nine staff total; she is a CPA; tax-season peak is Jan–Apr. These are owner-given and fair to reflect.

### Derailers / walls the interviewer should handle, not chase or accept

- **Confidentiality wall** ("I can't get into client specifics"): correct handling is to get the operational _shape_ without specifics, not to retreat from the topic. Accepting the wall as a full stop is a defect.
- **"I doubt you'll tell me anything I don't know"** (flat skepticism): disarm and continue; do not get defensive, do not over-sell.
- **"What does this cost?"** asked back once: DEFER pricing; never quote on the spot.

<!-- END PRIVATE -->
