# Fixtures: opposing-counsel-response

Three synthetic personal-injury matter inputs and three reference output drafts. The fixtures exercise the skill's three correspondence-kind behavior classes:

1. **`01-settlement-counter-offer-matter.yaml` + `01-settlement-counter-offer-matter-draft.md`** matter served a settlement counter-offer from opposing counsel; the skill produces a draft with a verbatim inbound-claim recital (offer amount, payment timing, release condition), a 4-row prior-correspondence table (the settlement-thread history), a tone-classification label (`contested`), and a TBD-marker substantive-response section explicitly forbidding settlement-number authoring.
2. **`02-motion-correspondence-matter.yaml` + `02-motion-correspondence-matter-draft.md`** matter served a meet-and-confer letter regarding a planned motion for summary judgment, with a proposed order attached; the skill produces a draft with a verbatim motion-inbound recital (motion title, relief sought, proposed hearing date, response deadline, and verbatim citation-bearing factual statement), a 2-row motion-correspondence-history table, a tone-classification label (`procedural`), and a TBD-marker substantive-response section forbidding motion-argument authoring.
3. **`03-scheduling-negotiation-matter.yaml` + `03-scheduling-negotiation-matter-draft.md`** matter served a scheduling letter proposing a deposition date with an attached proposed stipulation; the skill produces a draft with a verbatim scheduling-inbound recital (proposed date, proposed venue, affected deadline, conditional stipulation), a 3-row scheduling-history table, a tone-classification label (`routine`), and a TBD-marker substantive-response section forbidding scheduling-commitment authoring.

Every fixture is watermarked `[SYNTHETIC FIXTURE - NOT A REAL MATTER]`. Every name is fictional. Every email address uses the `.invalid` TLD. Every document path, case number, and claim number is synthetic. The fixtures are not derived from any real client matter and do not reflect any guidance about settlement posture, motion strategy, or scheduling commitments.

## Schema of the input YAML

The matter YAML fixtures approximate what `PracticeManagement.get_matter` returns combined with what `EmailThread.list_messages_for_matter` returns when called against the matter's relevant correspondence thread, plus the inbound message body. The fixture is one consolidated document for convenience; in production the adapter calls return their pieces separately. The fixture's top-level keys:

- `matter` the `Matter` shape from `src/lib/operator/capabilities/practice-management.ts`. Includes `id`, `client_name`, `matter_type`, `status`, `opened_at`, `closed_at`, `custom_fields`.
- `email_thread` the relevant subset of EmailThread for the matter. Top-level fields: `thread_id`, `thread_tag` (one of `settlement`, `motion`, `scheduling`), `messages` (an array of `EmailThreadMessage` shapes from `src/lib/operator/capabilities/email-thread.ts`). Each message includes `id`, `thread_id`, `direction` (`inbound` or `outbound`), `sender_name`, `sender_email`, `recipient_emails`, `subject`, `received_at` (for inbound) or `sent_at` (for outbound), `body_text`, `attachments`, and a `synopsis` field if recorded by the firm.
- `inbound_message` the inbound message under response. References by message ID into the `email_thread.messages` array. Includes parsed `factual_claims` (sentence-level extraction) and `expected_correspondence_kind` (an annotation the test harness uses to verify the skill's detection against the correspondence-kind-detection rubric).
- `customer_yaml_excerpt` the relevant subset of `customer.yaml`: firm name, supervising partner's name, partner's reviewer account ID, signature block, voice samples count, practice areas, the tone-classification memory rule, and any per-jurisdiction response-window rules.

## How a downstream test suite uses these fixtures

The voice-gate harness, the adapter conformance suite, and the fabrication-filter regression corpus all replay against these fixtures. Each suite owns the harness; this PR owns the fixtures themselves.

Replaying fixture 01 against a correctly-implemented runtime should produce a draft byte-for-byte equivalent to `01-settlement-counter-offer-matter-draft.md` modulo timestamp rendering (the date in the header block is "today" when the run executes). Deviations are skill regressions.

## Watermarking

Every input matter and every reference output is watermarked. The watermark string is:

```
[SYNTHETIC FIXTURE - NOT A REAL MATTER]
```

The watermark appears in:

- The first line of every YAML input as a top-of-file comment.
- The first line of every reference output draft as a horizontal-rule preamble.
- The `matter.custom_fields.fixture_watermark` field on every YAML.

A runtime that strips the watermark before draft assembly is a regression; the watermark must not appear in the final `Email.create_draft` body (the test harness verifies this).
