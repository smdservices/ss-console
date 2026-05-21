# Fixtures — law-pi-demand-letter-draft

Three synthetic personal-injury matter inputs and three reference output drafts. The fixtures exercise the skill's three behavior classes:

1. **`01-clean-matter.yaml` + `01-clean-matter-draft.md`** — full-information matter; the skill produces a complete draft with all factual sections populated and the four legal-judgment sections as TBD markers.
2. **`02-missing-wages-matter.yaml` + `02-missing-wages-matter-draft.md`** — matter with no employment-verification documents; the skill produces a draft with the lost-wages section as a TBD marker. The shape demonstrates the fabrication-discipline contract: a missing source produces TBD, never inferred content.
3. **`03-citation-in-source-matter.yaml` + `03-citation-in-source-refusal.md`** — matter with a legal citation in a partner-authored narrative field that the skill would otherwise read into its factual prose. The readiness rubric refuses; the output is the matter-internal sourcing note recording the refusal, not a draft letter.

Every fixture is watermarked `[SYNTHETIC FIXTURE — NOT A REAL MATTER]`. Every name is fictional. Every email address uses the `.invalid` TLD. Every document path, claim number, and dollar amount is synthetic. The fixtures are not derived from any real client matter and do not reflect any guidance about valuation, settlement, or strategy.

## Schema of the input YAML

The matter YAML fixtures approximate what `PracticeManagement.get_matter` returns combined with what `DocumentStorage.list_folder` returns when called against the matter's documents folder. The fixture is one consolidated document for convenience; in production the adapter calls return their pieces separately. The fixture's top-level keys:

- `matter` — the `Matter` shape from `src/lib/ai-employee/capabilities/practice-management.ts`. Includes `id`, `client_name`, `matter_type`, `status`, `opened_at`, `closed_at`, `custom_fields`.
- `documents` — an array of `StoredDocument` shapes from `src/lib/ai-employee/capabilities/document-storage.ts`. Each entry includes `id`, `path`, `filename`, `mime_type`, `size_bytes`, `created_at`, `modified_at`, `current_version`. A `synthetic_body` field is added (not part of the production interface) to give the test harness a deterministic body to parse without needing a separate file per document.
- `customer_yaml_excerpt` — the relevant subset of `customer.yaml`: firm name, supervising partner's name, partner's reviewer account ID, signature block, voice samples count, practice areas. Only what the skill reads.

## How a downstream test suite uses these fixtures

The voice-gate harness, the adapter conformance suite, and the fabrication-filter regression corpus all replay against these fixtures. Each suite owns the harness; this PR owns the fixtures themselves.

Replaying fixture 01 against a correctly-implemented runtime should produce a draft byte-for-byte equivalent to `01-clean-matter-draft.md` modulo timestamp rendering (the date in the header block is "today" when the run executes). Deviations are skill regressions.

Replaying fixture 03 against a correctly-implemented runtime should produce a refusal note byte-for-byte equivalent to `03-citation-in-source-refusal.md`. A run that produces a draft from fixture 03 is a fabrication-discipline failure.

## Watermarking

Every input matter and every reference output is watermarked. The watermark string is:

```
[SYNTHETIC FIXTURE — NOT A REAL MATTER]
```

The watermark appears in:

- The first line of every YAML input as a top-of-file comment.
- The first line of every reference output draft as a horizontal-rule preamble.
- The `matter.custom_fields.fixture_watermark` field on every YAML.

A runtime that strips the watermark before draft assembly is a regression; the watermark must not appear in the final `Email.create_draft` body (the test harness verifies this).
