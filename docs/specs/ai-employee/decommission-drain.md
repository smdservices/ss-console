# Decommission Drain Window

**Spec for issue #805.** `bin/decommission-customer.sh` must allow in-flight LLM calls a 60-second grace period to write to D1 before substrate deletion begins. Without drain, atomicity (BR-013) is unachievable — D1 deletion races with in-flight Anthropic responses returning mid-flight. Compliance promise (§13.3 retention) requires complete decommissioning.

## Source

- platform-prd.md §20 Phase 1 (`bin/decommission-customer.sh` listed deliverable)
- `docs/pm/ai-employee/prd-contributions/round-1/technical-lead.md` Critical gap + Blocking Item #6
- `docs/pm/ai-employee/prd-contributions/round-1/business-analyst.md` BR-013, EC-008

## Contract

### Sequence

```
bin/decommission-customer.sh <customer-slug> [--confirm] [--export-first]

Step 0  (pre-flight)
  - Verify customer.yaml exists at ai-employee/customers/{slug}/customer.yaml
  - Verify {slug}.state.json exists (or refuse — partial state requires manual cleanup)
  - Refuse without --confirm flag (no default-destructive)
  - Captain authenticates (SSH key) — script reads operator identity from environment

Step 1  (set stop signal)
  - Write pause.active=true to customer.yaml; deploy with same script invocation
  - Confirm Fly Machine logs show "agent paused" within 10s

Step 2  (drain window — THE 60-SECOND GATE)
  - Set drain flag in D1: INSERT INTO invariant_boot_checks
    (id, ts, invariant_num, passed, failure_detail)
    VALUES (?, now, 99, 1, 'decommission_drain_started')
  - Poll for in-flight LLM calls every 5s for up to 60s:
    - SELECT COUNT(*) FROM audit_log
      WHERE action_type LIKE 'DRAFT_%'
        AND ts > now() - INTERVAL 60 SECONDS
    - When count = 0 OR 60s elapsed, proceed.
  - Hard-kill behavior at 60s: regardless of in-flight count, advance to step 3.
    Hard-kill issues `fly machine stop hermes-{slug} --signal SIGKILL` which
    drops any in-flight Anthropic streaming responses without persisting them.
  - Write DECOMMISSION_DRAIN_COMPLETE audit event with in_flight_remaining metadata.

Step 3  (final exports)
  - Even without --export-first: export memory + audit log to R2 at
    {slug}/decommission-archive/final-{ts}.zip per r2-vectorize-naming.md
  - Export contents per compliance-evidence-packet.md packet structure
  - Move final-{ts}.zip to retention bucket smd-decommission-archive/{slug}/{ts}/
    (per r2-vectorize-naming.md retention policy)
  - Email customer's principal: 30-day download link signed via Cloudflare R2
    presigned URL

Step 4  (substrate deletion — ordered)
  4a. Drain draft_queue: mark pending drafts as expired, write final audit_log entries
  4b. Delete Vectorize indexes:
        wrangler vectorize delete hermes-{slug}-vault
        wrangler vectorize delete hermes-{slug}-corrections
  4c. Delete R2 objects under {slug}/ prefix (EXCEPT decommission-archive/ — already moved)
        Batched with `xargs -P 8`; logs progress every 1000 objects
  4d. Delete R2 bucket hermes-{slug}-r2
  4e. Delete D1 database hermes-{slug}-d1
  4f. Deregister Composio connections (per-toolkit)
  4g. Release AgentMail mailbox
  4h. Stop and destroy Fly Machine: fly machine destroy hermes-{slug} --force

Step 5  (config cleanup)
  - Archive customer.yaml to ai-employee/customers/archived/{slug}/{ts}/customer.yaml
  - Delete ai-employee/customers/{slug}/state.json
  - Commit + push the archive move

Step 6  (final confirmation artifact)
  - Generate signed PDF: ai-employee/decommission-confirmations/{slug}-{ts}.pdf
  - Captain signs (detached RSA signature per compliance-evidence-packet.md)
  - Email to principal + escalation.failure_recipients
  - Write DECOMMISSION_FINAL event to platform audit log (cross-customer; see Implementation notes)
```

### Exit codes

- `0` — decommission complete; all steps succeeded
- `1` — partial completion; state.json reflects remaining resources; Captain manually completes
- `2` — pre-flight failed (missing config, no --confirm, etc.)
- `3` — drain timed out with in-flight calls remaining; hard-kill required (informational; not a failure)
- `4` — substrate deletion failed mid-sequence; Captain reads state.json to identify remaining resources

### Hard-kill semantics

When the 60s drain window elapses with in-flight LLM calls still running:
- The script does NOT wait further. Compliance window is bounded.
- `fly machine stop --signal SIGKILL` terminates the Machine process. Any in-flight Anthropic streaming response is dropped — Anthropic may still emit tokens, but our runtime is gone. No D1 write completes.
- The dropped draft is unrecoverable — but per the reviewer-as-sender pattern (§9.2 in PRD), no external send occurred. The cost is one truncated draft, not a customer-facing failure.
- Audit event: `DECOMMISSION_HARD_KILL` with metadata = `{in_flight_count: N, drain_duration_seconds: 60}`.

### Drain window configurability

Default 60s per the spec. Per-customer override in `customer.yaml.decommission.drain_window_seconds` (between 30s and 300s). Customers in heavy-draft workflows may request a longer window; customers preferring fastest off-boarding may request shorter. Script enforces the bounds.

## Failure modes

- **Drain step itself fails** (D1 query errors): proceed to step 4 with audit event `DECOMMISSION_DRAIN_QUERY_FAILED`; substrate deletion is the priority.
- **Step 4 substrate deletion partial** (e.g., R2 prefix delete throttled): script catches the failure, updates state.json with remaining objects, exits 4. Captain runs `bin/decommission-customer.sh --resume <slug>` which picks up where it left off.
- **Customer reverses decommission within step 3** (e.g., calls Captain mid-process): step 3 deletion is reversible from the decommission-archive zip ONLY if it happens within the 7-day grace period before R2 archive expiry. After step 4 begins, the operation is irreversible. Script warns explicitly in the --confirm prompt.
- **Captain signing key unavailable for step 6**: produce an unsigned confirmation, marked clearly in metadata. Captain must counter-sign once key is restored; audit event flags this divergence.
- **Composio deregistration fails** (connection ID already removed): treat as idempotent success; log warning.
- **Fly Machine already destroyed before step 4h** (e.g., a prior failed run): idempotent; log warning, continue.

## Verification

1. **Drain test** at `tests/ai-employee/decommission-drain.test.ts`: provision fixture customer, kick off 5 long-running LLM calls (each ≥30s), run decommission; assert drain step waits and reports in-flight count every 5s; assert 5 calls complete within window OR hard-kill at 60s.
2. **In-flight race test**: deliberate timing — start a draft call at t=58s; assert hard-kill at t=60s drops it cleanly; assert no orphan D1 row.
3. **Resume test**: kill the script mid-step-4; verify state.json reflects remaining resources; run `--resume`; verify clean completion.
4. **Idempotency test**: run decommission twice on the same slug; second invocation exits 0 with "already decommissioned".
5. **Confirmation artifact test**: assert step 6 produces signed PDF; verify signature against Captain's public key; verify file hash matches manifest.

## Implementation notes

- Script: `bin/decommission-customer.sh` (bash, with embedded Python helpers via `python3 -c`).
- Drain polling helper: `ai-employee/adapter/decommission_drain.py` (Python; queries D1 via Cloudflare HTTP API since the Machine may already be paused at this point).
- The "platform audit log" referenced in step 6: a Captain-only D1 database `smd-control-plane-d1` that persists cross-customer events (decommission start/complete, customer added, customer paused). Lives outside any per-customer Machine.
- Confirmation PDF template: `templates/decommission-confirmation.md.tmpl`; rendered via Pandoc → wkhtmltopdf on the Captain's machine (not the customer's Fly Machine — the Machine is destroyed by step 4h).
- `--resume` flag reads state.json's `last_completed_step` and skips earlier steps.
- The signed presigned R2 URL for the final export uses Cloudflare's R2 presigned URL (valid 30 days max per Cloudflare).
- Cross-references:
  - r2-vectorize-naming.md (R2 prefix enumeration, retention bucket)
  - compliance-evidence-packet.md (final export contents)
  - d1-schema.md (audit_log events, drain query)
  - cost-telemetry-events.md (final cost_telemetry rollup included in final export)

[AMBIGUITY: BR-013 calls for "atomic-wipe" decommissioning across all substrates. With independent CF/Fly/Composio APIs, true atomicity is impossible; the spec settles for ordered-best-effort with state.json tracking + Captain resumability. Confirm this satisfies the compliance commitment in §13.3, or escalate to legal review.]

[AMBIGUITY: The 30-day retention of the decommission-archive zip in `smd-decommission-archive/` lives outside the per-customer Machine and is governed by a Captain-managed scheduled Worker. Compliance expects deletion proof within 30 days — confirm the cleanup Worker emits a verifiable deletion log Captain can sign and deliver to the former customer.]
