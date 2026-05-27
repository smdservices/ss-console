# Fixtures - law-pi-discovery-response

Three synthetic personal-injury matter inputs and three reference output drafts. The fixtures exercise the skill's three request-kind behavior classes:

1. **`01-interrogatories-matter.yaml` + `01-interrogatories-matter-draft.md`** - matter served a First Set of Interrogatories; the skill produces a draft with a per-interrogatory response table where every substantive-answer cell is a TBD marker.
2. **`02-requests-for-production-matter.yaml` + `02-requests-for-production-matter-draft.md`** - same matter at a later point in the case, served a First Request for Production of Documents; the skill produces a draft with a per-request response table, a responsive-document mapping per row, a privilege-log skeleton with three rows, and an exhibit list.
3. **`03-requests-for-admission-matter.yaml` + `03-requests-for-admission-matter-draft.md`** - same matter, served a First Set of Requests for Admission; the skill produces a draft with a per-RFA response table where every admit-or-deny cell is a TBD marker.

Every fixture is watermarked `[SYNTHETIC FIXTURE - NOT A REAL MATTER]`. Every name is fictional. Every email address uses the `.invalid` TLD. Every document path, case number, and claim number is synthetic. The fixtures are not derived from any real client matter and do not reflect any guidance about discovery posture, privilege claims, or admission decisions.

## Schema of the input YAML

The matter YAML fixtures approximate what `PracticeManagement.get_matter` returns combined with what `DocumentStorage.list_folder` returns when called against the matter's documents folder, plus the served discovery-request document body. The fixture is one consolidated document for convenience; in production the adapter calls return their pieces separately. The fixture's top-level keys:

- `matter` - the `Matter` shape from `src/lib/ai-employee/capabilities/practice-management.ts`. Includes `id`, `client_name`, `matter_type`, `status`, `opened_at`, `closed_at`, `custom_fields`.
- `documents` - an array of `StoredDocument` shapes from `src/lib/ai-employee/capabilities/document-storage.ts`. Each entry includes `id`, `path`, `filename`, `mime_type`, `size_bytes`, `created_at`, `modified_at`, `current_version`, `classification`. A `synthetic_body` field is added (not part of the production interface) to give the test harness a deterministic body to parse without needing a separate file per document. The served discovery-request document is included in this array with classification `discovery_request`.
- `discovery_request` - the parsed shape of the served discovery-request document. Includes `kind` (interrogatories, requests_for_production, requests_for_admission), `served_at`, `served_by`, `case_caption`, `case_number`, and a `numbered_items` array where each item has `number`, `text`, and (for the fixtures) `expected_objection_categories` annotations that the test harness can use to verify the skill's matching against the memory-rule vocabulary.
- `customer_yaml_excerpt` - the relevant subset of `customer.yaml`: firm name, supervising partner's name, partner's reviewer account ID, signature block, voice samples count, practice areas, the objection-category memory rule, and the jurisdiction rule that computes response due dates.

## How a downstream test suite uses these fixtures

The voice-gate harness, the adapter conformance suite, and the fabrication-filter regression corpus all replay against these fixtures. Each suite owns the harness; this PR owns the fixtures themselves.

Replaying fixture 01 against a correctly-implemented runtime should produce a draft byte-for-byte equivalent to `01-interrogatories-matter-draft.md` modulo timestamp rendering (the date in the header block is "today" when the run executes). Deviations are skill regressions.

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
