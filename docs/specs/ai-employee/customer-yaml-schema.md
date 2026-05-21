# customer.yaml — Formal Schema

**Spec for issue #790.** Source of truth for one customer's configuration. `provision-customer.sh` reads this file, validates it, and deploys against it. Never contains literal secret values.

## Source

- platform-prd.md §7.3 (current example), §19 (ADR list)
- `ai-employee/customer.yaml.schema.md` (PR #812 — current implementation)
- `docs/pm/ai-employee/prd-contributions/round-1/technical-lead.md` Risk 2

## Contract

```yaml
# REQUIRED FIELDS

customer_id: <slug> # ^[a-z0-9-]+$, max 32 chars, matches dir name
customer_name: <string> # display only; max 100 chars
vertical: <enum> # marketing-agency | law-firm | real-estate | manufacturing | insurance | mixed
practice_areas: <list<string>> # validated against vertical's registry; required for law-firm
model: <string> # Anthropic model ID (e.g. claude-opus-4-7)
fly_region: <string> # Fly.io region slug (e.g. iad, lax, ord)
hermes_ref: <string> # Hermes content-hash SHA or date tag (e.g. v2026.5.7)
gateway: <enum> # cli | slack | email | sms
oauth_scopes: <list<string>> # OAuth scope URIs the customer authorized

machine:
  size: <string> # Fly VM class
  memory_mb: <int> # 256-8192

persona:
  name: <string> # first name; max 50 chars
  title: <string> # e.g. "AI Associate"; max 50 chars
  signature_html: <string> # OPTIONAL; generated at provision if absent
  avatar_url: <string> # OPTIONAL; https URL
  tone: <list<string>> # 3-5 adjectives; e.g. ["warm-but-professional", "concise"]
  pronouns: <enum> # OPTIONAL; "they/them" (default) | "he/him" | "she/her"

users: # See dashboard-roles.md (#788)
  - email: <string>
    role: <enum> # principal | operator | compliance
    full_name: <string>

connectors:
  <capability-or-slug>:
    backend: <string> # composio:<toolkit> | mcp:<url> | build:<wrapper> | synthetic:<fixture>
    enabled: <boolean>
    scopes: <list<string>> # OPTIONAL; oauth scopes this connector needs
    token_ref: <string> # OPTIONAL; Infisical path; see Secret Exclusion below

skills:
  - name: <skill-slug>
    version: <string> # 6-char content hash or "pending"
    trust_ceiling: <enum> # autonomous | draft_for_review | refused
    enabled: <boolean>
    cost_estimate: # OPTIONAL but required for cost telemetry rollup
      tokens_in_per_run: <int>
      tokens_out_per_run: <int>
      tool_calls_per_run: <int>
      runs_per_day_typical: <int>
    scope: <list<string>> # OPTIONAL skill-specific scope tags

scope: # Email/folder visibility envelope
  email_folders_visible: <list<string>>
  email_folders_blind: <list<string>>
  email_keyword_blocks: <list<string>>
  domain_blocks: <list<string>>
  matter_blocks: <list<string>> # external PM matter refs

escalation:
  red_flag_recipients: <list<email>> # at least one
  failure_recipients: <list<email>> # at least one
  acknowledgement_window_minutes: <int> # OPTIONAL; default 60

business_hours: # OPTIONAL; defaults M-F 08:00-18:00 in fly_region tz
  timezone: <string> # IANA tz
  days: <list<string>> # ["mon", "tue", ...]
  start: <HH:MM>
  end: <HH:MM>

memory:
  d1_namespace: <slug> # MUST equal customer_id
  r2_vault_path: <string> # MUST equal "vaults/{customer_id}/"; see r2-vectorize-naming.md
  vectorize_index: <slug> # MUST equal "hermes-{customer_id}-vault"

logging:
  level: <enum> # debug | info | warn | error
  ship_to: <list<enum>> # cloudflare-d1 | fly-logs

pause:
  active: <boolean> # default false
  reason: <string> # required if active=true
```

## Secret-exclusion enforcement

**Banned at the field-value level (anywhere in document):**

- Strings matching `^(sk|pk|rk)_(live|test)_[A-Za-z0-9]{20,}$` (Stripe/Anthropic-shaped)
- Strings matching `^ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$` (JWT)
- Strings matching `^[A-Za-z0-9+/]{40,}={0,2}$` AND length > 80 (base64 secret-shaped)
- Any field name containing case-insensitive `password|secret|client_secret|api_key|access_token|refresh_token|private_key`

**The only permitted secret-reference pattern:**

```yaml
token_ref: 'infisical:/ai-employee/{customer-slug}/{connector}/{field-name}'
```

Refs are resolved by `provision-customer.sh` at deploy time and injected as Fly secrets. They never appear in container env vars at rest.

## Failure modes

- **Missing required field** → exit 2, stderr names the field. Provisioning aborted before any Fly action.
- **Vertical not in accepted enum** → exit 2. Provisioning aborted.
- **Skill `enabled: true` but skill dir not present** → exit 2.
- **Connector `enabled: true` but referenced wrapper/fixture/MCP server unreachable** → exit 2.
- **trust_ceiling raises above SKILL.md authored ceiling** → exit 2 with both values printed.
- **Secret pattern matched** → exit 2; line number and pattern type reported; no values echoed to stderr.
- **memory.d1_namespace ≠ customer_id** → exit 2 (cross-Machine query prevention; see r2-vectorize-naming.md).

## Verification

**Validator:** `ai-employee/adapter/validate_customer_yaml.py` (PR #812).
**Schema tests:** `tests/ai-employee/customer-yaml.test.ts` covers:

1. Every required field present
2. Every enum field accepts only documented values
3. Every secret-shaped value in any field rejected with non-empty file-line context
4. Round-trip: validated YAML deploys cleanly; invalid YAML refused before any side effect
5. memory.\* fields enforce customer-isolation invariant per r2-vectorize-naming.md

**Pre-commit hook:** `bin/precommit/customer-yaml-secret-scan.sh` runs validator's secret-scan pass on every `ai-employee/customers/*/customer.yaml` touched by the commit. Hook is wired in `.husky/pre-commit` and CI-mirrored in `.github/workflows/customer-yaml-validate.yml` (block-on-fail).

## Implementation notes

- Add typed schema to `ai-employee/customer.yaml.schema.md` (extend PR #812's prose with the typed block above).
- Add Python `pydantic` model at `ai-employee/adapter/customer_yaml_model.py` matching the contract; `validate_customer_yaml.py` uses it.
- Extend the existing `ACCEPTED_VERTICALS`, `ACCEPTED_CEILINGS`, `ACCEPTED_BACKEND_PREFIXES` constants to cover the new `users`, `business_hours`, `escalation` sections.
- Add `infisical:` to `ACCEPTED_BACKEND_PREFIXES` when used in `token_ref`.
- Pre-commit hook lives at `bin/precommit/customer-yaml-secret-scan.sh`; wire into `.husky/pre-commit`.

[AMBIGUITY: PR #812's existing LawPay connector stores OAuth tokens in `tokens.json` on the Fly Machine volume, not Infisical. This spec assumes Infisical resolution at provision time. Captain decision needed: is Infisical the source of truth for connector tokens, with `tokens.json` as a runtime cache, or does the PR #812 file-based approach replace Infisical for OAuth refresh tokens? See oauth-lifecycle.md for the path forward.]
