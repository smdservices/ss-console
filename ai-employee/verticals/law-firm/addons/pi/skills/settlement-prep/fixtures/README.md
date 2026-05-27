# Fixtures - settlement-prep

Two synthetic personal-injury matter inputs and two reference output memos. The fixtures exercise two profiles that anchor the skill's behavior across different injury severity and liability profiles:

1. **`01-soft-tissue-clear-liability-matter.yaml` + `01-soft-tissue-clear-liability-matter-memo.md`** - low-severity soft-tissue matter with clear liability, comparable-verdict corpus surfaces 3 matching rows, both opposing counsel and carrier are in the firm's prior-pattern corpus, weaknesses fact list is empty.
2. **`02-disc-herniation-contested-liability-matter.yaml` + `02-disc-herniation-contested-liability-matter-memo.md`** - higher-severity disc-herniation matter with contested liability, comparable-verdict corpus surfaces 2 matching rows, opposing counsel is in the corpus, carrier is NOT, weaknesses fact list has 2 entries (prior back injury and no-fault-attribution police report).

Every fixture is watermarked `[SYNTHETIC FIXTURE - NOT A REAL MATTER]`. Every name is fictional. Every email address uses the `.invalid` TLD. Every document path, case number, and claim number is synthetic. The fixtures are not derived from any real client matter and do not reflect any guidance about settlement valuation, posture, or strategy.

## Schema of the input YAML

The matter YAML fixtures approximate what `PracticeManagement.get_matter` returns combined with what `DocumentStorage.list_folder` returns when called against the matter's documents folder, plus the relevant customer-yaml memory-rule excerpts. The fixture is one consolidated document for convenience; in production the adapter calls return their pieces separately. The fixture's top-level keys:

- `matter` - the `Matter` shape from `src/lib/ai-employee/capabilities/practice-management.ts`. Includes `id`, `client_name`, `matter_type`, `status`, `opened_at`, `closed_at`, `custom_fields`.
- `documents` - an array of `StoredDocument` shapes from `src/lib/ai-employee/capabilities/document-storage.ts`. Each entry includes `id`, `path`, `filename`, `mime_type`, `size_bytes`, `created_at`, `modified_at`, `current_version`, `classification`.
- `customer_yaml_excerpt` - the relevant subset of `customer.yaml`: firm name, supervising partner, partner's reviewer account ID, signature block, voice samples count and internal-memo-tagged sub-count, practice areas, the comparable-verdict memory rule, the opposing-counsel prior-pattern memory rule, the carrier prior-pattern memory rule.

## How a downstream test suite uses these fixtures

The voice-gate harness, the adapter conformance suite, and the fabrication-filter regression corpus all replay against these fixtures. Each suite owns the harness; this PR owns the fixtures themselves.

Replaying fixture 01 against a correctly-implemented runtime should produce a memo byte-for-byte equivalent to `01-soft-tissue-clear-liability-matter-memo.md` modulo timestamp rendering. Deviations are skill regressions.

## Watermarking

Every input matter and every reference output is watermarked:

```
[SYNTHETIC FIXTURE - NOT A REAL MATTER]
```

The watermark appears in:

- The first line of every YAML input as a top-of-file comment.
- The first line of every reference output memo as a horizontal-rule preamble.
- The `matter.custom_fields.fixture_watermark` field on every YAML.

A runtime that strips the watermark before memo assembly is a regression; the watermark must not appear in the final `Email.create_draft` body (the test harness verifies this).
