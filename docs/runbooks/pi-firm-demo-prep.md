# PI firm demo prep runbook

**Audience:** Captain.
**Scope:** Pre-meeting preparation for a first-call demo with a personal-injury law firm. Covers the 24-48 hour window before the meeting.
**Source:** Platform PRD §16.2 (pre-provisioning) and §16.3 (demo deliverables). Implements the operational half of issue [#819](https://github.com/venturecrane/ss-console/issues/819).
**Companion tooling:** `operator/customers/_template/`, `operator/bin/provision-customer.sh`, `operator/bin/prepare-demo-firm.sh`.

> The PRD window: anything later than `T - 24 hours` violates §16.2. Build in slack. The earliest acceptable provisioning time is `T - 48 hours`; treat anything inside the 24 hour cushion as a recovery path, not the plan.

---

## Overview

The pre-meeting prep is eight sections, in order. Sections 1-4 are Captain-only; the agent has no autonomous role in identifying firms, scraping their writing, or authoring their config. Section 5 is the provisioning gate. Sections 6-8 are verification and the final walk-through.

| Section | Step                           | Owner   | Tool                                                                      |
| ------- | ------------------------------ | ------- | ------------------------------------------------------------------------- |
| 1       | Identify firm                  | Captain | None (relationship work)                                                  |
| 2       | Compile dossier                | Captain | `customers/_template/dossier.md`                                          |
| 3       | Scrape voice samples           | Captain | Manual + voice ingestion pipeline                                         |
| 4       | Author customer.yaml           | Captain | `customers/_template/customer.yaml` + `scripts/validate-customer-yaml.ts` |
| 5       | Provision Fly Machine          | Captain | `bin/provision-customer.sh`                                               |
| 6       | Run readiness checks           | Captain | `bin/prepare-demo-firm.sh`                                                |
| 7       | Pre-meeting walk-through       | Captain | Manual review                                                             |
| 8       | Deliverable readiness sign-off | Captain | Manual confirmation                                                       |

---

## Section 1: Identify the firm

This step is Captain-only. The agent never scrapes the public web to suggest candidate firms; firm identification is relationship work, not research work.

Sources Captain consults (per `CLAUDE.md` referral source list):

- **Networking groups in Phoenix:** Vistage, EO Arizona, BNI chapters, chamber of commerce.
- **Professional referrals:** fractional CFOs, accountants and bookkeepers serving PI firms, commercial insurance agents.
- **Public PI firm directories** (only for cross-referencing once Captain already has a name): state bar listings, PACER docket search for active PI plaintiff filings in the target jurisdiction.
- **Prior outreach lists:** any past assessment-call interest from a PI firm that did not convert.

Captain confirms the candidate firm with himself before moving to Section 2. The candidate must be:

- A PI plaintiff practice (the v1 skill pack is plaintiff-side).
- In the $750k-$5M revenue band per the venture's buy box, or otherwise within the assessment-call qualification (see Decision Stack).
- Reachable for a first call within the demo window.

Output: the firm's legal name, a chosen slug matching `^[a-z0-9][a-z0-9-]{0,31}$`, and a target demo date.

## Section 2: Compile the dossier

Copy the template:

```bash
cp -r operator/customers/_template operator/customers/{firm-slug}
```

Open `operator/customers/{firm-slug}/dossier.md` and fill every bracketed field in sections 1-7. Source citations only; no paraphrased press releases without verifying the underlying filing.

The dossier sections map to the issue acceptance criteria:

- Sections 1-3 satisfy "partner names, practice areas".
- Section 4 satisfies "recent settlements/cases (public record)".
- Section 5 satisfies "voice samples scraped from their published writing".
- Section 6 satisfies "hypothesized PM stack".
- Section 7 satisfies the decision-maker map that drives the demo angle.
- Section 8 satisfies the matter-fixture choice.

Time budget: 2-3 hours of focused research for a firm Captain already has context on; 4-6 hours when starting cold.

## Section 3: Scrape voice samples

Voice ingestion stores **structural-diffs only**, never raw text. See `docs/specs/operator/voice-ingestion.md` for the storage contract. The minimum sample count before a demo is **10** per AC #3.

Sources, in preferred order:

1. **Firm blog and case-result pages.** Long-form partner-authored posts are the highest-signal source. Skip ghostwritten marketing copy; the structural-diff will not generalize.
2. **Court filings via PACER and state docket portals.** Motions, briefs, and demand letters in the public record. Pull the version signed by the named partner, not the version filed pro forma by an associate.
3. **LinkedIn long-form posts** from named partners. Short posts (under 50 words) are too short to extract structural-diffs from; skip them.
4. **Published articles and op-eds.** Bar journal contributions, local newspaper guest columns.

For each sample:

- Save the source as a local file under `operator/customers/{firm-slug}/voice/` with a descriptive filename (e.g. `partner-lastname-2024-03-demand-letter.txt`). The file extension is informational only.
- Record the citation in dossier section 5 so the source is auditable.
- Run the voice ingestion pipeline against the directory to compute the structural-diff and store it in R2. (Until the live ingestion CLI lands, hand-drop the structural-diff JSON files into the same directory; the readiness check counts files, not run history.)

What Captain does NOT do:

- Scrape any private email account.
- Pull anything from a sealed docket, a protective-order matter, or a confidential settlement.
- Re-host the raw text outside the customer directory. Raw text never leaves the customer's R2 namespace.

## Section 4: Author the customer.yaml

Open `operator/customers/{firm-slug}/customer.yaml` and replace every bracketed field. The schema is documented at `docs/specs/operator/customer-yaml-schema.md`. Required edits, in order:

1. `customer_id` matches the directory slug.
2. `customer_name` is the legal name from dossier section 1.
3. `practice_areas` is a non-empty list (e.g. `["personal-injury-plaintiff"]`).
4. `fly_region` is the closest Fly region to the firm's primary office (e.g. `iad` for east-coast, `lax` for west-coast).
5. `users[]` lists every human with portal access. Use `role: principal` for the partner who signs the check.
6. `personas[]` has at least one entry with `status: active` and a `name`.
7. `connectors` reflects the dossier section 6 hypothesis. Items with `confidence: low` should start as `adapter: synthetic` and switch to a real adapter only after the assessment call confirms the stack.
8. `memory.d1_namespace`, `memory.r2_vault_path`, `memory.vectorize_index` must satisfy the isolation invariants (see `r2-vectorize-naming.md`). The values follow `{customer_id}` exactly.

Validate before moving on (canonical TS validator per ADR 0019):

```bash
npx tsx scripts/validate-customer-yaml.ts \
  operator/customers/{firm-slug}/customer.yaml
```

The validator must exit 0 before Section 5. A non-zero exit means the file is structurally wrong and would fail at provisioning time anyway; fix it now.

## Section 5: Provision the Fly Machine

The provisioning script is `operator/bin/provision-customer.sh`, shipped under issue [#812](https://github.com/venturecrane/ss-console/issues/812). It is read-write and creates real Fly resources; do not run it against a firm that has not been identified and confirmed.

```bash
operator/bin/provision-customer.sh {firm-slug}
```

What the script does (one command, idempotent):

1. Re-validates the customer.yaml.
2. Renders `fly.toml` from the template.
3. Creates the Fly app `hermes-{firm-slug}` if it does not exist.
4. Provisions a persistent volume for memory state.
5. Prompts Captain for `ANTHROPIC_API_KEY`, `COMPOSIO_API_KEY`, `AGENTMAIL_API_KEY` via the pbpaste flow (secret values never appear in any terminal or transcript).
6. Deploys the Hermes container.
7. Runs a per-connector smoke test against the customer's tenant.

If the script fails at any step, re-run with the same slug; every step is idempotent.

## Section 6: Run the readiness checks

`operator/bin/prepare-demo-firm.sh` is the verification tool. It is read-only and re-runnable. Run it as many times as needed during prep until it exits 0.

```bash
operator/bin/prepare-demo-firm.sh --firm-slug {firm-slug}
```

It verifies, in order:

| Check                 | What it validates                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `01_customer_yaml`    | File parses; `customer_id` matches slug; vertical is `law-firm`; at least one active persona; memory namespace matches. |
| `02_voice_samples`    | At least 10 voice samples on disk under `customers/{slug}/voice/`.                                                      |
| `03_memory_ingestion` | At least one `memory_source_state` row reports `ingest_status='ok'`. SKIP when no reader is wired.                      |
| `04_voice_ingestion`  | At least one `voice_source_state` row; none is errored. SKIP when no reader is wired.                                   |
| `05_connector_smoke`  | If PM is `filevine`: the per-connector smoke test passes. Otherwise: synthetic backend is wired (no-PM angle).          |
| `06_synthetic_matter` | At least one synthetic matter fixture is seeded (per-customer dir or yaml `demo.matter_fixture`).                       |

Exit codes:

| Code | Meaning                                                                               |
| ---- | ------------------------------------------------------------------------------------- |
| 0    | All required checks passed. Skips do not block.                                       |
| 2    | Preflight failed (missing customer dir, bad slug, reserved template slug).            |
| 3    | At least one required check failed. Re-read the per-step report and fix the failures. |
| 4    | Unexpected error. Re-run with `bash -x` to capture the failing line.                  |

## Section 7: Pre-meeting walk-through with Captain

≥24 hours before the meeting, walk the whole demo end-to-end at the Hermes Machine. Cover:

- The dossier read-through. Confirm Section 8's demo angle matches what Captain expects to lead with.
- The synthetic matter walk-through. Open the seeded matter in the demo flow and confirm it reads as believable for the firm's practice area.
- The voice sample drilldown. Open the structural-diff for at least one sample and confirm it matches the tone notes in dossier section 5.
- Connector smoke summary. Confirm every required connector is either green or synthetic (no `error` states).
- Escalation routing. Confirm the `failure_recipients` in customer.yaml is an inbox Captain monitors, not the principal's address.

If any item fails the walk-through, the demo is not ready. Defer the meeting or de-scope to a no-PM angle (synthetic adapter only). Never demo a half-wired connector.

## Section 8: Deliverable readiness check

Final sign-off before the meeting. Confirm:

- [ ] `prepare-demo-firm.sh --firm-slug {firm-slug}` exits 0 within the last 24 hours.
- [ ] The synthetic matter has been opened in the demo flow at least once end-to-end without errors.
- [ ] All voice samples are ingested (the dashboard's voice cohort histogram is populated, or the `.demo-prep-state.json` snapshot records the run).
- [ ] Every connector listed in `customer.yaml` is either green or synthetic; no `ingest_status='error'` rows.
- [ ] The escalation recipient list is correct and the inbox is monitored.
- [ ] Dossier section 9 checklist is fully checked.
- [ ] Captain has walked the demo end-to-end in the last 24 hours.

When every box is checked, the demo is ready.

---

## Recovery paths

**Provisioning failed late in the window.** Re-run `provision-customer.sh`. It is idempotent. If the failure is at the secrets step, confirm the source vault (Infisical) has the secret set and re-run.

**Voice samples below 10.** Add more samples from the same source set. If the firm has limited public writing, raise the `--min-voice-samples` floor to whatever count Captain has and document the deviation in dossier section 5; the voice gate will operate at lower confidence until more samples are ingested.

**Filevine smoke fails.** Two paths: fix the credential or downscope. To downscope: edit `connectors.PracticeManagement` in customer.yaml to `adapter: synthetic`, `backend: synthetic:fixture`. Re-run validation and readiness. The demo will run as the no-PM angle; the firm will see the agent operating on synthetic fixtures and the assessment-call conversation pivots to "your PM connector lands after signing."

**Synthetic matter fixture missing.** Pick a fixture from `operator/skills/{lead-skill}/fixtures/` or `operator/fixtures/law-firm/` and either copy it into `operator/customers/{firm-slug}/fixtures/` or set `demo.matter_fixture` in customer.yaml to its relative path.

**Captain runs out of prep time.** The demo is deferred. Do not run the demo from a yellow readiness report; the failure modes are predictable (a connector returns no data mid-conversation, the voice match feels off, the synthetic matter doesn't match the practice area) and they each blow up the meeting. Defer and rebook.

## Decommissioning a demo firm that did not convert

If the firm does not sign within the agreed-upon window after the demo, run `operator/bin/decommission-customer.sh {firm-slug} --live` per the per-customer decommission spec (`docs/specs/operator/decommission-customer.md`, shipped under issue [#820](https://github.com/venturecrane/ss-console/issues/820), wrapper added in PR [#956](https://github.com/venturecrane/ss-console/issues/956)). The decommission pipeline tombstones the customer directory, removes memory and voice substrate, and archives the compliance evidence packet. The dossier is preserved in the tombstone for future re-engagement.
