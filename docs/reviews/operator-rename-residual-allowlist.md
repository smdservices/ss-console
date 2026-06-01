# Operator rename — expected-residual allowlist (PR 1)

Authored in Stage A of the "AI Employee" → "Operator" rename (ADR 0034), **before** any
content edits, so the final verification is a mechanical assertion rather than a judgment
call: after the rename, `git grep -niE 'ai-employee|AI Employee|AiEmployee'` **minus the
patterns below must be empty.** Anything not listed is a miss.

Every entry is an `ai-employee` / "AI Employee" occurrence that is *supposed* to survive PR 1,
with the reason. The workflow (Stage B) and this file are excluded from its own scope so the
agents never rewrite the allowlist patterns.

## Permanent keeps (survive all PRs)

1. **External infra resource names** (slug-independent; not customer-facing; ADR 0034 §4):
   - `smd-ai-employee` — Sentry project (`src/env.d.ts`, `src/pages/api/webhooks/sentry.ts`).
   - `smd-ai-employee-skill-bodies`, `ss-ai-employee-<id>-skills` — R2 buckets / model names
     (`src/lib/operator/customer-yaml/types.ts`).
2. **Legacy intake alias** `'ai-employee'` — kept so pre-rename `/book?interest=ai-employee`
   links still resolve (`src/lib/booking/intake-core.ts`, `src/pages/api/intake/send.ts`,
   `src/pages/book.astro`, `src/components/booking/IntakeIntroCard.astro`).

## Deferred to PR 2 (boot-substrate cutover)

3. **The `ai-employee/` boot substrate** and all code/comment references to its internals —
   `ai-employee/{adapter,connectors,skills,safety-substrate,templates,bin,customers,verticals,voice-gate,grading,migrations}`,
   `cd ai-employee` substrate shell commands, the `crane ai-employee <subcommand>` CLI namespace,
   the `ai_employee_*` Python module names, and the `ai-employee-smd-customer-zero` git branch
   identifier. Renaming the directory requires the `hermes-smd-overlay` companion PR + a Fly
   re-bootstrap (ADR 0034 Delivery). Includes `tests/ai-employee-dockerfile.test.ts` and the
   substrate CI workflows `.github/workflows/ai-employee-substrate.yml` and
   `.github/workflows/ai-employee-skill-regression.yml` (both `working-directory: ai-employee`),
   plus the spec/PRD references to those workflow filenames.

## Historical records (immutable by convention)

4. **Historical ADR bodies** — all numbered ADR files `docs/adr/00NN-*.md` retain "AI Employee"
   in their bodies (the load-bearing 0004/0013/0023 carry amendment banners pointing to ADR 0034).
   ADRs are historical records of decisions made under the prior name; `decision-stack.md` and
   `index.md` (living docs) are renamed. The `src/middleware.ts` legacy-redirect block
   intentionally references the old `/ai-employee` paths (they are the redirect *sources*).
5. **ADR 0034 itself + the index entry + the banners** necessarily contain "AI Employee" — they
   are *about* the rename and quote the prior name.
6. **Dated review artifacts** — `docs/reviews/ai-employee-code-review-*.md` (point-in-time
   reviews) and this allowlist file.
7. **Applied migrations** — `migrations/0038`, `0043`, `0044`, `0045` comment references. Applied
   migrations are not edited (historical + avoids runner-checksum risk); the new `0048` is the
   migration that performs the rename.

## Stage C assertion (the grep exclusion)

```
git grep -niE 'ai-employee|AiEmployee' \
  | grep -viE \
    'smd-ai-employee|ss-ai-employee|interest=ai-employee|['"'"'"]ai-employee['"'"'"]|ai-employee/(adapter|connectors|skills|safety-substrate|templates|bin|customers|verticals|voice-gate)|tests/ai-employee-dockerfile|docs/adr/(0004|0005|0013|0023|0034)|docs/adr/index.md|docs/reviews/ai-employee-code-review|docs/reviews/operator-rename-residual-allowlist|^migrations/00(38|43|44|45)'
```

Expected output: empty (modulo the live boot-substrate `ai-employee/**` tree itself, which PR 1
leaves in place — restrict the grep to tracked source/docs outside that tree when asserting).
