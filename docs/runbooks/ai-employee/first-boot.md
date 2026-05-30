# First boot — standing up a customer Machine

How Captain boots a customer's AI Employee Machine end to end for the first time. This is the [ADR 0024](../../adr/0024-hermes-consumption-and-update-cadence.md) / [ADR 0007](../../adr/0007-per-customer-machine-isolation.md) "first real boot" milestone: it provisions a dedicated Fly.io Machine, builds the customer-shape Hermes container (upstream Hermes pinned by SHA + the hermes-smd overlay), and runs the boot smoke test.

The first boot is **Captain-gated**: it spends on a real Fly.io org, stages real credentials, and consumes a real Anthropic key. Everything up to `fly deploy` is automated by `provision-customer.sh`; the go/no-go is yours.

## What "first boot" verifies (and what it does not)

The boot smoke test (`ai-employee/bin/boot-smoke-test.sh`, run automatically as the last step of provisioning) confirms the **dependency chain comes up cleanly**: Machine `started` → Postgres → Redis → Honcho health → `customer.yaml` on the volume → Hermes profiles materialized → overlay plugins registered (`hermes plugins list | grep hermes-smd-`) → curator disabled ([ADR 0017](../../adr/0017-skill-curator-disposition.md)).

It does **not** exercise a real agent turn, a live LLM call, or a connector write. Those need the customer's OAuth tokens and are the next step after a clean boot (see "After a clean boot" below). The first boot proves the substrate stands up; it does not prove a task runs end to end.

## Prerequisites

### Tooling (operator machine)

- `fly` CLI, authenticated to the target org (`fly auth login`). The script creates the app with `--org personal`; change that in `provision-customer.sh` if booting into a different org.
- `aws` CLI (for the R2 `customer.yaml` upload), `openssl`, `pbpaste` (macOS).

### Operator environment (exported before running — never pasted into chat)

```
R2_ENDPOINT_URL        # https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID       # operator-local, used by `aws s3 cp` for the customer.yaml upload
R2_SECRET_ACCESS_KEY
R2_BUCKET_CONFIG       # optional; defaults to "smd-customer-config"
# Optional (warn-and-skip if unset): CF_API_TOKEN + CF_ACCOUNT_ID (per-customer skill-bodies
# bucket auto-create), SENTRY_DSN, MACHINE_HEARTBEAT_KEY, HEALTHCHECKS_API_KEY (ADR 0023 Wave 1).
```

### Secrets you'll be prompted to paste (clipboard → `fly secrets`, never echoed)

The script prompts for each; copy to clipboard, press Enter (or `s` to skip). Values flow straight into `fly secrets import --stage`:

- `ANTHROPIC_API_KEY` — the model key for this Machine.
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT_URL` — Machine-scoped R2 access (R/W on `vaults/<slug>/`) so `bootstrap.sh` can fetch `customer.yaml` on boot.
- `R2_SKILL_BODIES_ACCESS_KEY_ID` / `R2_SKILL_BODIES_SECRET_ACCESS_KEY` — bucket-scoped to `ss-ai-employee-<slug>-skills` ([ADR 0022](../../adr/0022-vertical-pack-architecture.md) Stream 2). Verify the token scope before pasting; the bucket is the trust boundary ([ADR 0007](../../adr/0007-per-customer-machine-isolation.md)).

`HONCHO_API_KEY` is generated locally (`openssl rand -hex 32`) and staged directly — no paste.

### Customer fixture

`ai-employee/customers/<slug>/customer.yaml` must exist and validate. **customer-zero is `smd`** (`ai-employee/customers/smd/customer.yaml`) — we dogfood the SMD AI Employee on SMD itself. Its `hermes_ref` is pinned (`v2026.5.16@a91a57fa…`); the Dockerfile clones `NousResearch/hermes-agent` at that tag and asserts the cloned HEAD matches the SHA.

## The command

From the **repo root** (not a worktree subdir), with the operator env exported:

```bash
ai-employee/bin/provision-customer.sh smd
```

That single command: validates `customer.yaml` → uploads it to R2 → renders `fly.toml` → creates the Fly app + a 10 GB volume → prompts for secrets → `fly deploy` (builds the Dockerfile: clones+asserts upstream Hermes, installs the overlay **v0.2.0**, bundles Postgres/Redis/Honcho) → runs the boot smoke test. It is idempotent — safe to re-run.

## Overlay pin (why v0.2.0 matters)

The Dockerfile pins the overlay at **v0.2.0** (`OVERLAY_REF`). The runtime trust plugin imports `shared.outbound_gate`, which first shipped after v0.1.1. The build now hard-asserts the policy core is importable (`import shared.outbound_gate, shared.inbound, shared.action_classes`) — a stale pin fails the build instead of booting a harness-less Machine. If you bump the overlay, re-tag and bump `OVERLAY_REF` in lockstep. (Known follow-up: `hermes plugins install` clones the overlay's default branch and cannot pin a ref, so the _plugin surface_ tracks main HEAD at build time; for a tagged build, main == the tag.)

## What to watch on the FIRST ever boot

This is the first time the full chain runs on real infra, so budget for first-run surprises and watch the logs (`fly logs -a hermes-smd`):

- **Docker build** clones upstream Hermes + runs `npm install` + `playwright install chromium` + `uv sync` + web builds — it is a heavy, multi-minute build.
- **Hermes CLI surface** — bootstrap execs `hermes chat` and the overlay calls `hermes plugins …`; both are verified to exist at the pinned SHA, but a live boot is their first real exercise.
- **`hermes-smd bootstrap`** translating `customer.yaml` → profile config is first-exercised here.
- **Honcho `1.0.0`** schema migration runs against the in-container Postgres for the first time.

If the smoke test fails, the Machine is up but the chain is unhealthy: `fly logs -a hermes-smd` shows which step (`[bootstrap] FATAL: …` / `[smoke/smd] FAIL: …`).

## After a clean boot

1. `fly ssh console -a hermes-smd` — shell into the container.
2. `fly logs -a hermes-smd` — watch the agent loop.
3. Run the OAuth setup for the enabled connectors (Gmail / Calendar / Drive via MCP) inside the container so the agent can act on the principal's mailbox.
4. Drive a first real inbound message through quarantine → draft → outbound gate → reviewer to verify the harness end to end (the milestone-C "proven in life" step).

## Rollback / teardown

```bash
fly apps destroy hermes-smd            # removes the Machine + volume (irreversible)
```

For a non-destructive pause (keep state, stop the agent loop), use the pause sentinel path in `bootstrap.sh` step 9 rather than destroying the app.

## References

- `ai-employee/bin/provision-customer.sh` — the provisioning entrypoint
- `ai-employee/templates/bootstrap.sh` — in-container 11-step startup
- `ai-employee/bin/boot-smoke-test.sh` — the dependency-chain smoke test
- [ADR 0024](../../adr/0024-hermes-consumption-and-update-cadence.md) (Hermes pin), [ADR 0007](../../adr/0007-per-customer-machine-isolation.md) (per-customer Machine), [ADR 0028](../../adr/0028-outbound-integrity-gates-provenance-and-voice.md) (overlay harness)
