# customer.yaml — Formal Schema

**Spec for issue [#790](https://github.com/venturecrane/ss-console/issues/790).** Source of truth for one customer's configuration. Git is the authoritative store ([ADR 0012](../../adr/0012-customer-yaml-storage.md)); the portal D1 `customer_configs` table and per-customer R2 prefix are materialized projections, not competing sources. Never contains literal secret values.

## Source

- [Platform PRD](../../pm/ai-employee/platform-prd.md) §7.3 (example), §19 (ADR list), §20 (Phase 1 schema lock)
- [Law Firm PRD](../../pm/ai-employee/law-firm-prd.md) §7 (cross-references this spec for connector wiring)
- [ADR 0006](../../adr/0006-capability-adapter-pattern.md) — capability-interface + adapter pattern
- [ADR 0011](../../adr/0011-multi-persona-per-customer.md) — `personas:` is an array (length ≥ 1 at v1)
- [ADR 0012](../../adr/0012-customer-yaml-storage.md) — git source of truth, CI-validated on merge
- [`docs/pm/ai-employee/prd-contributions/round-1/technical-lead.md`](../../pm/ai-employee/prd-contributions/round-1/technical-lead.md) Risk 2 — secret-exclusion vulnerability framing

## Schema version

Files declare `schema_version: 1`. CI rejects merges where the file's `schema_version` is not in the validator's accepted-version set. Schema evolution rules: see [ADR 0012](../../adr/0012-customer-yaml-storage.md) §8.

## Contract

```yaml
schema_version: 1 # REQUIRED. Currently only "1" is accepted.

# ---- IDENTITY (REQUIRED) ----

customer_id: <slug> # ^[a-z0-9][a-z0-9-]{0,31}$ — matches the configs-repo file name (sans .yaml)
customer_name: <string> # display only; max 100 chars
vertical: <enum> # marketing-agency | law-firm | real-estate | manufacturing | insurance | mixed
practice_areas: <list<string>> # required when vertical=law-firm; otherwise OPTIONAL
fly_region: <string> # Fly.io region slug (e.g. iad, lax, ord)

# ---- RUNTIME (REQUIRED) ----

model: <string> # Anthropic model ID (e.g. claude-opus-4-7)
hermes_ref: <string> # Fork tag from venturecrane/hermes-agent per ADR 0015 (e.g. v2026.5.7-smd.0)

machine:
  size: <string> # Fly VM class (performance-1x, etc.)
  memory_mb: <int> # 256-8192

# ---- HUMANS WITH PORTAL ACCESS (REQUIRED) ----
# See dashboard-roles.md.

users:
  - email: <string>
    role: <enum> # principal | operator | compliance
    full_name: <string>
    voice_profile_id: <slug> # OPTIONAL; ^[a-z0-9][a-z0-9-]{0,31}$; unique within users[]
    # When set, Layer 2 voice transform selects this user's profile
    # for drafts attributed to this reviewer. When omitted, the user
    # inherits the customer-level general voice. See ADR 0011 for the
    # multi-user-vs-multi-persona distinction.

# ---- PERSONAS (REQUIRED; ARRAY; length ≥ 1) ----
# Per ADR 0011: array at v1, length=1 in practice; Phase 2 may grow.

personas:
  - slug: <slug> # ^[a-z0-9][a-z0-9-]{0,31}$; unique within this file
    status: <enum> # active | archived (length-≥-1-active enforced at v1)
    name: <string> # first name; max 50 chars
    title: <string> # OPTIONAL; e.g. "AI Associate"; max 50 chars
    signature_html: <string> # OPTIONAL; generated at provision if absent
    avatar_url: <string> # OPTIONAL; https URL
    tone: <list<string>> # 3-5 adjectives; e.g. ["warm-but-professional", "concise"]
    pronouns: <enum> # OPTIONAL; "they/them" (default) | "he/him" | "she/her"
    send_as: # OPTIONAL; AgentMail identity
      agentmail_identity: <string> # e.g. marcus@<customer_id>.agents.smd.services
    skills:
      - name: <skill-slug>
        version: <string> # OPTIONAL; 6-char content hash or "pending" (CI defaults to "pending")
        trust_ceiling: <enum> # autonomous | draft_for_review | refused
        enabled: <boolean> # OPTIONAL; default true
        cost_estimate: # OPTIONAL but required for cost telemetry rollup
          tokens_in_per_run: <int>
          tokens_out_per_run: <int>
          tool_calls_per_run: <int>
          runs_per_day_typical: <int>
        scope: <list<string>> # OPTIONAL skill-specific scope tags
    voice_overrides: <object|null> # OPTIONAL; inherits voice_library when null
    escalation_overrides: <object|null> # OPTIONAL; inherits top-level escalation when null
    channel_bindings: # OPTIONAL; integrations this persona drives
      - integration: <string> # e.g. ms-graph, gmail, slack
        channels: <list<string>> # e.g. ["primary-inbox"]

# ---- CUSTOMER-SCOPE CONFIG (REQUIRED) ----

connectors:
  # Map of capability name → adapter binding. Capability names are the closed
  # union from src/lib/ai-employee/capabilities/types.ts CapabilityName:
  # PracticeManagement | Email | Calendar | DocumentStorage | ESign |
  # CourtAccess | Payments | Accounting | IntakeCRM | CallTracking | InternalComms
  <CapabilityName>:
    adapter: <slug> # e.g. filevine, microsoft-graph, docusign
    backend: <string> # composio:<toolkit> | mcp:<url> | build:<wrapper> | synthetic:<fixture>
    enabled: <boolean> # OPTIONAL; default true
    scopes: <list<string>> # OPTIONAL; oauth scopes this connector needs
    token_ref: <string> # OPTIONAL; Infisical reference; see Secret Exclusion
    composio_connection_id: <string> # REQUIRED iff backend starts with "composio:"; see "Composio per-connection isolation" below

scope: # email / folder visibility envelope
  email_folders_visible: <list<string>>
  email_folders_blind: <list<string>>
  email_keyword_blocks: <list<string>>
  domain_blocks: <list<string>>
  matter_blocks: <list<string>> # OPTIONAL; external PM matter refs

escalation: # default; per-persona override allowed via personas[].escalation_overrides
  red_flag_recipients: <list<email>> # at least one
  failure_recipients: <list<email>> # at least one
  acknowledgement_window_minutes: <int> # OPTIONAL; default 60

voice_library: # OPTIONAL; shared across personas unless overridden
  samples_path: <string> # OPTIONAL; r2:// path

business_hours: # OPTIONAL; defaults to M-F 08:00-18:00 in fly_region tz
  timezone: <string> # IANA tz
  days: <list<string>> # ["mon", "tue", ...]
  start: <HH:MM>
  end: <HH:MM>

memory: # MUST satisfy isolation invariant (see Failure modes)
  d1_namespace: <slug> # MUST equal customer_id
  r2_vault_path: <string> # MUST equal "vaults/{customer_id}/"; see r2-vectorize-naming.md
  vectorize_index: <slug> # MUST equal "hermes-{customer_id}-vault"

logging: # OPTIONAL
  level: <enum> # debug | info | warn | error
  ship_to: <list<enum>> # cloudflare-d1 | fly-logs

pause: # OPTIONAL
  active: <boolean> # default false
  reason: <string> # required if active=true
```

## Memory retention

**Added by [#863](https://github.com/venturecrane/ss-console/issues/863).** Per-data-type retention windows for the periodic cleanup runner (`adapter/memory/retention.py` + `bin/cron-retention.py`). The entire `memory.retention:` block is OPTIONAL; missing fields fall back to the documented defaults below. See [`memory-retention.md`](./memory-retention.md) for the full spec.

```yaml
memory:
  # ...existing memory.* fields...
  retention: # OPTIONAL
    matters_days: <int> # OPTIONAL; default 730 (2 years)
    documents_days: <int> # OPTIONAL; default 365 (1 year)
    recipients_days: <int> # OPTIONAL; default 730 (2 years)
    voice_samples_days: <int> # OPTIONAL; default 365 (1 year)
    audit_log_days: <int> # OPTIONAL; default 2555 (7 years; legal industry norm)
    drafts_days: <int> # OPTIONAL; default 90 (90 days)
```

Field rules:

- Every `*_days` value MUST be a positive integer. Non-int values trigger a logged fallback to the module default in `MemoryRetentionPolicy.from_customer_yaml`; zero or negative values raise `ValueError` at policy-construction time.
- Unknown keys under `memory.retention:` are ignored (forward-compat with future schema versions that add more knobs).
- The runner only sweeps memory + voice today. `audit_log_days` and `drafts_days` declare the policy now; their sweep code lands in follow-ons against `memory-retention.md` §"Per-pipeline scope".
- The default scheduled cron uses `access_scope = firm-wide`; partner-only and attorney-list rows require a narrower Captain-invoked sweep (see `memory-retention.md` §"Access-scope discipline").

## Capability binding

The `connectors:` map keys MUST be drawn from the canonical capability union published by [`src/lib/ai-employee/capabilities/types.ts`](../../../src/lib/ai-employee/capabilities/types.ts):

```
PracticeManagement | Email | Calendar | DocumentStorage | ESign |
CourtAccess | Payments | Accounting | IntakeCRM | CallTracking | InternalComms
```

This union is the wire contract from [ADR 0006](../../adr/0006-capability-adapter-pattern.md). Adding a key outside this set is a validation error — new capabilities require an ADR that extends the type union, then a follow-on schema version bump per [ADR 0012](../../adr/0012-customer-yaml-storage.md) §8.

The `adapter:` value is the SMD-internal adapter slug (e.g. `filevine`, `microsoft-graph`, `docusign`). It is treated as opaque by the schema; the per-adapter conformance harness at boot ([ADR 0006](../../adr/0006-capability-adapter-pattern.md), `src/lib/ai-employee/capabilities/conformance.ts`) verifies the adapter actually satisfies the interface's required-method set. The schema does NOT enumerate accepted slugs — that registry lives with the adapter implementations.

## Secret-exclusion enforcement

`customer.yaml` is git-committed. A secret committed here lands in git history permanently. For a law-firm tenant, that is a privilege-breach with bar-discipline consequences ([Technical Lead Risk 2](../../pm/ai-employee/prd-contributions/round-1/technical-lead.md)).

The validator runs a secret-scan pass over the raw file text BEFORE structural parsing, so a malformed YAML containing a secret still fails closed.

### Banned at the value level (anywhere in the document)

1. **Provider-shaped API keys** matching `^(sk|pk|rk)_(live|test)_[A-Za-z0-9]{20,}$` (Stripe / Anthropic / Resend / similar)
2. **JWT-shaped tokens** matching `\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b` (three base64url segments separated by `.`)
3. **AWS-shaped access key IDs** matching `^AKIA[0-9A-Z]{16}$`
4. **GitHub-shaped tokens** matching `^gh[pousr]_[A-Za-z0-9]{36,255}$`
5. **OpenAI-shaped keys** matching `^sk-[A-Za-z0-9]{32,}$` or `^sk-proj-[A-Za-z0-9_-]{32,}$`
6. **Slack-shaped tokens** matching `^xox[abprs]-[A-Za-z0-9-]{10,}$`
7. **Google OAuth client secrets** matching `^GOCSPX-[A-Za-z0-9_-]{20,}$`
8. **Hex-encoded secrets** — any standalone string of 40+ hex characters (`^[a-f0-9]{40,}$`)
9. **Base64 secret-shaped** — any string matching `^[A-Za-z0-9+/]{40,}={0,2}$` with length > 80, outside known-safe fields (`signature_html`, `avatar_url`)
10. **High-entropy long strings** — any string of 32+ characters whose Shannon entropy ≥ 4.5 bits per character, outside the same allowlist

### Banned at the field-name level

The validator flags any field name containing (case-insensitive) one of:
`password`, `passwd`, `secret`, `client_secret`, `api_key`, `apikey`, `access_token`, `refresh_token`, `private_key`, `bearer`, `auth_token`

The presence of one of these field names is by itself a rejection — even if the value is `~` / empty / a placeholder. Such fields belong in Infisical, not the YAML.

### The only permitted secret-reference pattern

```yaml
connectors:
  PracticeManagement:
    adapter: filevine
    backend: build:filevine-mcp
    token_ref: 'infisical:/ai-employee/{customer_id}/practice-management/oauth-refresh'
```

`token_ref` strings:

1. MUST begin with the literal prefix `infisical:`
2. MUST have at least three slash-separated path segments after the prefix (`/<scope>/<customer>/<purpose>`)
3. MUST NOT contain any value that itself triggers a secret heuristic (you cannot smuggle a secret as a "ref")

References are resolved by `bin/provision-customer.sh` at deploy time and injected as Fly secrets. They never appear in Hermes container env vars at rest.

### Allowlisted fields (NOT scanned for high-entropy / base64 patterns)

- `personas[].signature_html` — HTML signature bodies legitimately contain long encoded strings (e.g. embedded image data URIs)
- `personas[].avatar_url` — https URLs may have long query strings
- `personas[].send_as.agentmail_identity` — long subdomain identities
- `users[].email`, `escalation.red_flag_recipients[]`, `escalation.failure_recipients[]` — email addresses
- `customer_name` — display names

Allowlisted fields are still scanned for **provider-shaped keys** (the patterns in §1-7 above); an OpenAI key smuggled into `signature_html` is still rejected.

## Composio per-connection isolation

**Added by [#850](https://github.com/venturecrane/ss-console/issues/850).** Composio manages OAuth for Gmail, Slack, and GitHub connectors (`backend: composio:*`). The provisioner stages one tenant-wide `COMPOSIO_API_KEY` per fleet and scopes per-customer access by **connection ID** — every Composio API call carries a connection ID that names whose OAuth credential the action runs against. A misrouted connection ID is a cross-customer leakage vector that [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md)'s structural per-Machine isolation alone does not cover.

The contract is enforced at two layers:

1. **Authoring-time validator** — `connectors.<CapabilityName>.composio_connection_id` is REQUIRED when `backend` starts with `composio:`, must be ABSENT otherwise, and must match the shape `conn_{customer_id}_{suffix}` where suffix is 4-80 chars of `[A-Za-z0-9_-]`. The slug captured in the ID MUST equal `customer_id` — a mismatch is an `IsolationViolation`.

2. **Runtime backstop** — [`ai-employee/adapter/connectors/composio_assertion.py::ComposioConnectionGuard`](../../../ai-employee/adapter/connectors/composio_assertion.py) wraps every Composio API call site. The guard is constructed per Machine against the bound customer slug and refuses any call whose connection ID doesn't match. Refusal raises `ComposioIsolationError` and writes one `INVARIANT_VIOLATION` audit row.

Example:

```yaml
connectors:
  Email:
    adapter: gmail
    backend: composio:gmail
    token_ref: 'infisical:/ai-employee/smith-pi-firm/email/refresh'
    composio_connection_id: 'conn_smith-pi-firm_2bcae9a8'
```

## Multi-user voice profiles

**Added by [#858](https://github.com/venturecrane/ss-console/issues/858).** A customer may have multiple humans on portal access — for example, a principal partner who personally writes the firm's most consequential email and an associate attorney whose drafts go out under the associate's identity. The reviewer-as-sender model ([ADR 0005](../../adr/0005-reviewer-as-sender.md)) attributes every shipped message to the user who approved it; Layer 2 voice transform shapes the draft to match _that reviewer's_ writing voice, not a single firm-wide composite.

The `users[].voice_profile_id` field is the seam:

- When set, voice samples ingested while this user's identity was the sent-folder author are tagged with the user's profile slug. Layer 2 looks up the per-user profile and reshapes the draft to match.
- When omitted, the user inherits the customer-level **general voice profile** — the aggregate across every sample regardless of authorship. This is the default and what every existing customer uses until per-user calibration runs.
- When the per-user profile has fewer than `MIN_PROFILE_SAMPLE_COUNT` samples ([`adapter/voice/transform.py`](../../../ai-employee/adapter/voice/transform.py)), Layer 2 falls back to the general profile rather than reshape against a noisy target.

**Distinct from multi-persona.** Per [ADR 0011](../../adr/0011-multi-persona-per-customer.md), a customer's deployment runs one or more **personas** — AI agent identities (Marcus the paralegal-substrate, Casey the intake-handler). v1 ships with one persona. Multi-user voice is orthogonal: a single persona may draft on behalf of several human reviewers, each with their own voice profile. The architecture is:

- **Persona** (Marcus) — the AI agent's identity (signature, send-as inbox, skills, trust ceilings)
- **User** (Partner Sarah) — the human who reviews and approves drafts; carries an optional `voice_profile_id`
- **Voice profile** — the writing-style signature aggregated from samples tagged with one user's slug

One persona, one customer Machine, N users with distinct voice profiles. Multi-persona runtime support is Phase 2; multi-user voice is v1 (this PR).

## Failure modes

| Condition                                                  | Validator behavior                                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing required field                                     | Reject with `MissingField` error naming the JSONPath                                                                                                                                               |
| Required string is empty                                   | Reject with `EmptyField` error                                                                                                                                                                     |
| Enum field value not in accepted set                       | Reject with `EnumViolation` error listing accepted values                                                                                                                                          |
| `customer_id` does not match `^[a-z0-9][a-z0-9-]{0,31}$`   | Reject with `InvalidSlug` error                                                                                                                                                                    |
| `personas` array is empty OR has no `status: active` entry | Reject with `MissingActivePersona` error                                                                                                                                                           |
| Persona slug duplicated within `personas[]`                | Reject with `DuplicatePersonaSlug` error                                                                                                                                                           |
| `connectors` key not in `CapabilityName` union             | Reject with `UnknownCapability` error                                                                                                                                                              |
| `trust_ceiling` raises above SKILL.md authored ceiling     | Reject with `TrustCeilingExceeded` error (validator surfaces both values; ceiling-floor lookup happens at provision time, not in this validator at v1)                                             |
| Secret pattern matched in any value                        | Reject with `SecretDetected` error naming the JSONPath + pattern category; the matched **substring is NOT echoed** in the error (avoid log/transcript leak)                                        |
| Banned field name encountered                              | Reject with `BannedFieldName` error naming the JSONPath                                                                                                                                            |
| `token_ref` does not begin with `infisical:`               | Reject with `InvalidTokenRef` error                                                                                                                                                                |
| `backend: composio:*` without `composio_connection_id`     | Reject with `MissingField` error (per-connection isolation cannot be enforced without it; see [composio_assertion.py](../../../ai-employee/adapter/connectors/composio_assertion.py) + issue #850) |
| `composio_connection_id` malformed                         | Reject with `InvalidFormat` error (shape: `conn_{customer_id}_{suffix}`, suffix is 4-80 chars of `[A-Za-z0-9_-]`)                                                                                  |
| `composio_connection_id` slug ≠ `customer_id`              | Reject with `IsolationViolation` error (cross-customer leakage vector — see [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md) + issue #850)                                            |
| `composio_connection_id` set on non-composio backend       | Reject with `IsolationViolation` error (the field is meaningful only when Composio mediates OAuth)                                                                                                 |
| `memory.d1_namespace` ≠ `customer_id`                      | Reject with `IsolationViolation` error (cross-Machine query prevention; see [r2-vectorize-naming.md](./r2-vectorize-naming.md) + [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md))    |
| `memory.r2_vault_path` ≠ `vaults/{customer_id}/`           | Reject with `IsolationViolation` error                                                                                                                                                             |
| `memory.vectorize_index` ≠ `hermes-{customer_id}-vault`    | Reject with `IsolationViolation` error                                                                                                                                                             |
| `vertical: law-firm` without `practice_areas`              | Reject with `MissingField` error citing `practice_areas`                                                                                                                                           |
| `pause.active: true` without `pause.reason`                | Reject with `MissingField` error citing `pause.reason`                                                                                                                                             |
| `users[].voice_profile_id` malformed slug                  | Reject with `InvalidSlug` error                                                                                                                                                                    |
| Duplicate `users[].voice_profile_id` across users          | Reject with `DuplicateVoiceProfileId` error (per-user attribution model — two users cannot share a profile)                                                                                        |

All errors are returned as a list; the validator does not short-circuit on the first error. Authors get the full picture in one round-trip.

## Verification

### Runtime validator

[`src/lib/ai-employee/customer-yaml/validator.ts`](../../../src/lib/ai-employee/customer-yaml/validator.ts) — TypeScript validator. Consumes the parsed YAML as an `unknown` (the consumer chooses its YAML parser — portal uses one, Hermes uses another per [ADR 0012](../../adr/0012-customer-yaml-storage.md) §4) and returns a `ValidationResult` with a typed `CustomerYaml` on success or a list of `ValidationError` entries on failure. Hand-rolled (no schema-library dependency) — the contract is narrow enough that a 200-line validator with explicit checks reads better than a 50-line schema declaration whose rules you have to translate back to docs.

### Secret detector

[`src/lib/ai-employee/customer-yaml/secret-detector.ts`](../../../src/lib/ai-employee/customer-yaml/secret-detector.ts) — accepts raw file text plus an `allowlist` of field paths and returns a list of `SecretFinding` entries. Pre-commit hooks and CI both call this directly; the validator also invokes it as the first pass on the structural parse. Error messages name the line and pattern category but **never echo the matched substring** — a precaution that keeps secret values out of CI logs, terminal history, transcripts, and the gitleaks-of-the-validator-output failure mode.

### Test surfaces

- [`tests/customer-yaml-validator.test.ts`](../../../tests/customer-yaml-validator.test.ts) — round-trips valid YAML to typed shape; rejects every category in _Failure modes_ above; verifies aggregate error list (validator does not short-circuit); verifies error messages never echo matched secret substrings.
- [`tests/customer-yaml-secret-detector.test.ts`](../../../tests/customer-yaml-secret-detector.test.ts) — covers each pattern category, the field-name ban, the allowlist, and the no-echo rule.

### CI wiring (deferred to ADR 0012 follow-on PR)

Pre-commit hook + CI workflow live with the canonical configs repo per [ADR 0012](../../adr/0012-customer-yaml-storage.md) §5. The validator + secret detector exported from `src/lib/ai-employee/customer-yaml/` are the modules that workflow imports. The repo + workflow themselves are out of scope for [#790](https://github.com/venturecrane/ss-console/issues/790) — they land in the follow-on PR specified by ADR 0012 _Implementation_ phase 4.

## Implementation notes

- Schema is consumer-agnostic. Both the portal (TypeScript, [`src/lib/portal/customer-config.ts`](../../../src/lib/portal/customer-config.ts) — reads the D1 projection) and Hermes (Python pydantic — reads the YAML directly from R2) build typed representations against this spec. The TypeScript validator in this PR is the portal-side and the CI-side check; a Hermes-side pydantic validator is the Hermes-side check. Both validators target the same contract.
- The `synthetic:` backend prefix is supported so dev/test fixtures can wire fake adapters; CI rejects `synthetic:` in production-targeted YAML via a separate `mode: 'production' | 'development'` flag on the validator, defaulting to production.
- Per-customer schema migration is a PR in the configs repo, not a database migration. Schema version bump triggers a CI sync re-projection for every customer ([ADR 0012](../../adr/0012-customer-yaml-storage.md) §8).

## Cross-references

- [Platform PRD §7.3](../../pm/ai-employee/platform-prd.md) — customer.yaml worked example
- [Law Firm PRD §7](../../pm/ai-employee/law-firm-prd.md) — connector strategy, cross-references this spec for wiring
- [`d1-schema.md`](./d1-schema.md) — per-customer Hermes D1 contract (`persona_slug` nullable columns)
- [`dashboard-roles.md`](./dashboard-roles.md) — `users[].role` vocabulary
- [`r2-vectorize-naming.md`](./r2-vectorize-naming.md) — memory.\* isolation invariants
- [`oauth-lifecycle.md`](./oauth-lifecycle.md) — how `token_ref` resolves at provision time
- [ADR 0006](../../adr/0006-capability-adapter-pattern.md) — capability-interface + adapter pattern (the `connectors:` shape)
- [ADR 0007](../../adr/0007-per-customer-machine-isolation.md) — per-customer Machine isolation
- [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md) — cross-Machine query prohibition (the `memory:` invariants)
- [ADR 0011](../../adr/0011-multi-persona-per-customer.md) — multi-persona per customer (the `personas:` array shape)
- [ADR 0012](../../adr/0012-customer-yaml-storage.md) — git as source of truth (validator runs at PR time and in pre-commit)
