# Safety substrate

The five irreducible invariants the AI Employee enforces in code, not in prompt. This directory holds the fixture tests that prove each invariant holds across the four failure modes that historically broke similar agents (context compaction, restart, tool failure, prompt injection).

The substrate runs every container start (via `bootstrap.sh`). On `--strict`, any test failure halts the agent loop — the agent does not run.

## The five invariants

1. **No destructive action without confirmation.** Delete, archive, drop, irreversible writes. Agent refuses unless the current invocation contains explicit user approval text. "Confirmed by previous session" is invalid; approval must live in the current turn. Reference incident: OpenClaw, Meta AI Safety director's agent deleted operator's inbox after compaction dropped a "don't act" instruction (Feb 2026).
2. **No outbound external send without confirmation.** Email send, SMS send, social post, calendar invite to external attendees. Agent drafts only unless explicit approval in current turn.
3. **No contract or commitment execution autonomously.** Signing, accepting terms, agreeing to scope, agreeing to dates. Always draft-for-review.
4. **"Don't act" / "stop" instructions are sticky.** Pinned outside compressible turn history; survive context compaction; honored across the session.
5. **Trust-ceiling per skill is enforced in code, not prompt.** The `AIEmployee` adapter inspects the skill's declared ceiling against the action being attempted. Adapter refuses when prompt drift tries to escalate.

## Test layout

Each invariant is exercised against four failure-mode fixtures. Test files at `tests/test_<invariant>_<failure_mode>.py`. Convention:

- A test file exports a `run() -> tuple[bool, str]` callable.
- `bool` is True iff the invariant held under the failure mode.
- `str` is a one-line message describing the verdict.
- The runner (`run_invariants.py`) imports each test, calls `run()`, collects results.

## Running locally

Inside the customer container (during `bootstrap.sh`):

```
python3 /app/safety-substrate/run_invariants.py \
  --customer "${CUSTOMER_SLUG}" \
  --fixtures /app/safety-substrate/tests \
  --strict
```

From the repo root for development:

```
uv run --with pyyaml python3 ai-employee/safety-substrate/run_invariants.py \
  --customer smd \
  --fixtures ai-employee/safety-substrate/tests
```

(Omit `--strict` when developing; add it when committing the substrate as a gate.)

## What "ships" means for a substrate test

- The test simulates the failure mode (e.g., serializes a session, truncates the early turns to mimic compaction, then deserializes and replays an action).
- It invokes the `AIEmployee` adapter against a mock skill with the relevant ceiling.
- It asserts the adapter refuses or routes-to-draft the way the invariant requires.
- Any actual call to a real Composio/MCP/build connector is monkey-patched to record-only — substrate tests never reach a real tool.

## When to extend

Add new test files when:

- A real incident reveals a failure mode our current four don't cover.
- A new action class is introduced and needs ceiling enforcement.
- Hermes' tool dispatch behavior changes (e.g., new hook point) and we need to verify the adapter still intercepts everything.

Every Hermes SHA bump re-runs the full substrate on container start. The build is gated; a failing substrate blocks the container from serving traffic.
