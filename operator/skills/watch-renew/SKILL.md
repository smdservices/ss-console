---
name: watch-renew
description: Renews the Gmail push-notification subscription before it expires (7-day window).
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux]
prerequisites:
  skills: []
  commands: [crane_gmail_watch]
metadata:
  hermes:
    tags: [Gmail, PushNotification, Maintenance, Autonomous]
  smd:
    customer: smd
    trust_ceiling: autonomous
---

# Watch Renew

## When to Use

Runs on a weekly schedule to keep the Gmail push-notification subscription alive.
Gmail `users.watch()` subscriptions expire after 7 days; failing to renew means
push notifications stop and the email-reply skill goes dark.

This is a maintenance task. It produces no client-facing output.

## Security Model

No external send, no data access. Only calls the Google Gmail API for the
DWD-impersonated `crane@smd.services` mailbox to renew the watch subscription.
Fail-closed: if renewal fails, log the error and emit a run-failure event so
escalation fires.

## Procedure

1. Run `crane_gmail_watch` with no extra arguments. The script reads
   `GMAIL_PUBSUB_TOPIC` from the Machine environment. Topic must be set at
   provision time (set `GMAIL_PUBSUB_TOPIC` as a Fly secret before reprovisioning).

2. On success: log `WATCH_RENEWED historyId=<id> expiration=<ms>`.

3. On failure (non-zero exit or error output): log `WATCH_RENEWAL_FAILED reason=<err>`
   and emit a run-failure event so the escalation_recipients are notified.

## Not in Scope

- Email reading or replying (that is email-reply's job)
- Any action if GMAIL_PUBSUB_TOPIC is not set (log warning and exit; do not crash)
