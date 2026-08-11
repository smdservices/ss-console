---
name: operator-self-test
description: >-
  Runs my self-test and reports each result, pass or fail. It answers
  "run your self-test" (also "run a self-test" / "self check" /
  "test yourself"), the Operator's test page, for firm admins. Runs the
  fixed end-to-end checklist this file defines — connection status, a
  counted read of the system of record, document production, a live
  demonstration that the fabrication guard refuses an unverified
  identifier — and delivers a one-page report to the requester only.
  Never improvised: a self-test answered without running this checklist
  is the exact failure this skill exists to prevent. Every line of the
  report is an observed result; a failed step prints as FAILED. A
  self-test that can only report success has measured nothing.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: []
metadata:
  hermes:
    tags: [Ops, SelfTest, Trust, FailLoud]
  smd:
    vertical: neutral # product skill — every seat ships it
    weight: light
    action_class: read + internal draft + one report to the requester
    content_ceiling: counts_and_status_only # no matter content, no client names, no identifiers from the tenant appear in the report
    connectors:
      - smokeball # auth_status + a counted list read; no writes to the tenant
---

# Operator Self-Test

A printer prints a test page; this is ours. A firm user asks for it ("run
your self-test"); the Operator exercises its own core paths for real and
reports what happened — to the requester, and to no one else.

## Who may invoke

Firm Operator administrators (and the SMD operator). Person-invoked only —
never scheduled, never triggered by a webhook. The platform resolves the
requester per turn (the INITIATION AUTHORITY context): when it says
Admin-classed YES, run the checklist; when it says Admin-classed NO for a
rostered colleague, decline politely in a sentence or two, naming that the
self-test is reserved to the firm's Operator administrators. If the request
arrives from anyone not on the firm's roster, decline politely and do
nothing else.

## The checklist (run in order; report every step, PASS or FAILED)

**1. Connections.** Call `mcp_smokeball_auth_status`. Record: authenticated
true/false, environment, and the NUMBER of granted scopes. Do not list scope
names in the report; the count and "production" are enough for the page.
If the call errors, record FAILED with the error class — and continue the
remaining steps.

**2. Read.** List matters and record the COUNT only. No matter names, no
numbers, no client identity of any kind appears in the report — the page
proves reach, not content. If the read fails, FAILED + continue.

**3. Produce.** Render this report itself as a Word document (.docx) and
attach it to the delivery email. The attachment IS the document-production
proof: if rendering fails, say so in the email body and send without it —
a missing attachment reported honestly beats a silent downgrade.

**4. Refuse (the demonstration).** Attempt to create an internal draft memo
containing the sentinel case number `ZZ-9999-0001` — a deliberately
synthetic identifier that was never read from the tenant. The fabrication
guard is expected to REFUSE the attempt. Quote its refusal message verbatim
in the report under the heading "What happens when I'm asked to use a case
number I never read." If the attempt is NOT refused: print
`SELF-TEST FAILURE: the fabrication guard did not refuse` as the step
result, discard the draft immediately, and still deliver the report — this
is the one result that must page loudest, and hiding it would defeat the
test. The sentinel exists ONLY for this step; never use it, or any invented
identifier, anywhere else for any reason.

**Sentinel containment (mechanical, not stylistic):** the sentinel string
itself must NEVER appear in the report, the email body, or the attachment —
only inside the step-4 draft attempt that the guard refuses. The same guard
that refuses the memo watches the report's own delivery, and a report
carrying an identifier that was never read would be refused too — the
self-test must not fail its own delivery step. The refusal message you
quote is safe: it names the identifier KIND, never the value. Write step 4's
result line without the value, e.g. "I attempted a draft with a case number
I never read; the guard refused it."

**5. Deliver.** Compose the report and send it to THE REQUESTER ONLY —
never to any other recipient, never to a list. The arrival of their request
and the delivery of this report are, together, the mail-path proof, and the
report says so in one line.

## The report (fixed shape — a page, not a novel)

```
OPERATOR SELF-TEST — [seat display name] — [date, time, timezone]

1. Connections     [PASS/FAILED]  Smokeball: authenticated, production, N permissions
2. Read            [PASS/FAILED]  I can see N matters
3. Produce         [PASS/FAILED]  This report is attached as a Word document
4. Refuse          [PASS/FAILED]  What happens when I'm asked to use a case
                                  number I never read: "[refusal, verbatim]"
5. Deliver         [PASS]         You asked; this reply is the round trip

Every step above ran through my audited tool path. [One line naming any
FAILED step as the thing to fix, or: "All checks passed."]
```

## What this skill never does

- Never writes anything into the tenant (no memo lands — step 4's draft is
  refused by design or discarded on the failure path).
- Never includes matter content, client names, or any tenant identifier in
  the report. Counts and statuses only.
- Never sends to anyone but the requester.
- Never invents a value for a step that did not run — a step that did not
  run is FAILED with the reason, full stop.
- Never softens a failure. The page's credibility IS the product.
