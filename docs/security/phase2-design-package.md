# Operator Security — Phase 2 Design Package (PRE-REVIEW DRAFT)

**Status:** Pre-review. Four design tracks complete (design-only, no code shipped, no live Machine touched). This package is the input to the consolidated adversarial review panel. After review it becomes the sequenced implementation plan.

**Mission frame:** Relocate the trust boundary from "around the Google credential" to "around the agent uid." Customer-zero is the founder's OWN live business — no blast wall — so every new component is also a new way to brick a live boot; reliability is a first-class constraint, not an afterthought. Overlay-only, never Hermes core (ADR 0015). Closes findings in `docs/security/operator-threat-model.md`.

---

## WS2a — Close OP-P0-2 by removing the account-wide R2 key from the agent (NO new key)

**Problem:** `operator/bin/provision-customer.sh` (~355-366) defaulted `R2_SKILL_BODIES_*` to the **account-wide** R2 key pair (R/W on every bucket in the account). That key sat in the agent env; an exfil reads/writes _every_ customer's bucket.

**Decision (REVISED after Captain pushback + code verification 2026-06-11):** Do **not** mint a new key. Close OP-P0-2 by **removing** the over-broad key from the agent, not by adding a narrow one. Verified: `R2_SKILL_BODIES_*` only back the agent persisting **self-authored** skills; `skill_capture.load_r2_config_from_env()` returns `None` and **no-ops** when the vars are absent (graceful, no boot impact); customer-zero (`operator/customers/smd/customer.yaml`) runs fixed repo skills (`inbox-triage`, `workspace`) and authors none → the feature is dormant. So:

- `provision-customer.sh`: remove the account-wide fallback; stage `R2_SKILL_BODIES_*` **only** if a genuinely bucket-scoped token is present in `/ss` (warn-and-skip if absent — fail-soft, not fail-closed). **No `require`/`die`.**
- `bootstrap.sh`: `unset R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY` after the boot `customer.yaml` fetch (their only in-Machine consumer), before the gateway exec. `R2_ENDPOINT_URL` KEPT (the scoped skill writer reads it; not a credential).
- Net: agent env holds **no** R2 write key on customer-zero; OP-P0-2 closed with **zero new keys**. Skill-persistence is fail-soft-off until deliberately enabled.

**If/when agent-authored skill persistence is turned on (a later, deliberate feature decision):** mint ONE bucket-scoped R2 token (read+write on `ss-operator-<slug>-skills` only) and add `R2_SKILL_BODIES_ACCESS_KEY_ID` / `R2_SKILL_BODIES_SECRET_ACCESS_KEY` to `/ss` — no code change. Cloudflare dashboard → R2 → Manage R2 API Tokens → Object Read & Write → Apply to specific buckets only. NEVER the account-wide pair. (The earlier "mint a permanent token via `POST /accounts/{acct}/tokens`" design is retained in git history if the API path is ever preferred over the dashboard.)

**Out of scope (separate, lower severity — not the agent env):** the operator-local account-wide key still exists in `/ss` and is used by provisioning + the boot fetch. Scoping _that_ down is the provisioning-credential blast-radius item (OP-P2-5 / WS7), not the crown jewel.

**Flagged risk:** none. The no-op-on-absent path is verified in `skill_capture.py:149-159`; `bash -n` clean; no test asserts the removed fallback.

---

## WS5 — Broker-mediated, append-only, agent-non-writable audit ledger (closes OP-P1-4)

**Load-bearing fact:** the runtime-read gate that serves `GET /runtime/audit_log` runs as **uid 10000 (hermes)** — the same uid as the agent (launched in `bootstrap.sh:667-673`, all under `entrypoint.sh:77-82 exec setpriv --reuid=hermes`). So we **cannot revoke the agent's READ**. The split makes the file group-readable, owner-(broker)-write-only.

**Mechanism (mirror the Google broker uid-split):**

- New principal **uid 10002 `audit-broker`** (`Dockerfile:177-181`); groups `audit-readers` (file read: hermes + audit-broker) and `audit-writers` (socket reach: hermes + audit-broker).
- New dir `/opt/data/audit/` mode **2750** setgid; `audit.db` (+ `-wal`/`-shm`) owner `audit-broker:audit-readers` mode **0640**. Agent (and gate) READ via group; agent **cannot open for write** (not owner, no group-write); an `execute_code`/`terminal` child inherits the denial. Established in `entrypoint.sh` while still root, before the hermes drop (mirror `entrypoint.sh:21-27`). Legacy `audit.db` migrated idempotently and fail-closed (move, never drop rows).
- New `operator/audit_broker/server.py` (mirrors `operator/workspace_broker/server.py`), own venv (mirror `Dockerfile:228-233`). Imports **shared** contract (`shared.audit_contract` INSERT_SQL/CREATE_TABLE/build_params + `shared.ids`). **Schema ownership moves to the broker** (runs `ensure_schema()` at its own startup; sole RW handle). Protocol mirrors `server.py:99-177`: ThreadingUnixStreamServer, newline-delimited canonical-JSON, MAX_REQUEST_BYTES, socket 0660, dir 2750, `SO_PEERCRED` peer-PID gate (`peer_pid == SMD_GATEWAY_PID`; exec-code/terminal children get a different PID → rejected). Actions: `health` (no PID gate) + **`append` — the ONLY mutating verb. No update/delete/drop verb exists in the IPC surface at all. That absence IS the append-only guarantee** (structural, not a SQL filter). Broker re-derives `id`/`ts` server-side so the agent can't backdate/collide.
- `immutability.D1Executor` retained unchanged as defense-in-depth (schema/migration path only).

**Consumer seam (no silent no-op):**

- New `shared/audit_broker_client.py` `BrokerAuditClient.append(...)` (mirror `shared/workspace_broker.py`); raises `AuditWriteError` on failure; returns broker-stamped ULID.
- `emit.py:101-190 AuditLogWriter.__init__` accepts **either** `D1Client` (direct; legacy/local-dev/tests) **or** `BrokerAuditClient`. Row-construction (`emit.py:146-173`) unchanged; final persist routed through the injected transport.
- `register()` (`__init__.py:295-321`): broker mode selected **only** when `SMD_AUDIT_BROKER_SOCKET` is set; **when set, an unready broker FAILS THE BOOT — never silent fallback** (the #1285 class). When unset, the direct path runs unchanged (648 existing tests pass). No "broker set but quietly fell back" third state.

**Boot fail-closed (three layers; closes #1285):**

1. In-process probe row `AUDIT_SELFTEST` at `register()`; `AuditSelfTestFailed`/`AuditBrokerUnavailable` propagate out of `register()`.
2. **AUTHORITATIVE: `bootstrap.sh` readiness gate** before `:680`, mirroring the existing Google-broker gate at `bootstrap.sh:186-220` — assert socket, health, probe-append, read-back via mode=ro, else `die` (hard exit before `exec hermes gateway run`). Authoritative _because_ whether a `register()` raise hard-fails the boot is **Hermes core loader behavior at the pinned ref, not visible from the overlay** — the wall lives where a hard exit is guaranteed.
3. Broker's own startup `ensure_schema()` → exit non-zero on failure → entrypoint socket-wait `die`.

**Runtime read path unchanged:** `runtime_read.py:151` mode=ro can't write; needs only retained group-read (and group-readable `-wal`/`-shm` under WAL).

**Files:** ss-console NEW `operator/audit_broker/server.py` (+tests); EDIT `Dockerfile:177-181` (+ audit-broker venv after :233), `entrypoint.sh` (dir/perms after :27, broker launch + socket-wait mirroring :44-70, `SMD_AUDIT_BROKER_SOCKET`), `fly.toml.template:75` (path + socket env), `bootstrap.sh` (gate before :680), `tests/operator-dockerfile.test.ts:59` (OVERLAY_REF pin). overlay NEW `shared/audit_broker_client.py`; EDIT `emit.py:101-190`, `__init__.py:295-321`, `schemas.py` (AUDIT_SELFTEST action_type, SYSTEM actor). verification EDIT `operator/bin/boot-smoke-test.sh` (+ `audit-broker-running` pgrep, + `audit-db-not-agent-writable`: as uid 10000, rw-open + DELETE must FAIL — affirmative OP-P1-4 proof at deploy time).

**Open decisions (designer recommendation in parens):**

1. one access group vs **two** (rec two — orthogonal ACLs; Google broker keeps socket-group separate from file ownership).
2. **new `/opt/data/audit/` subdir** vs in-place re-own (rec subdir — setgid belongs on a dir we own, not the hermes-owned volume root re-`chown`ed every boot at `entrypoint.sh:18`).
3. broker venv **pip-installs pinned overlay** vs copy two modules (rec pip-install — single-source the audit-row contract; copies are the drift it was built to kill).
4. in-process self-test vs **bootstrap gate** authoritative (rec bootstrap gate — never rest the guarantee on unverified core loader semantics).
5. **WAL (option A)** vs rollback-journal+busy_timeout (rec A, pending staging).

**Top unknowns (honestly flagged, not papered over):** (1) **WAL across the uid boundary** — separate writer + mode=ro readers + cross-uid `-wal`/`-shm` perms is the highest-uncertainty piece; must be observed on staging, asserted by design only. (2) Hermes plugin-loader exception semantics (mitigated by making the bootstrap gate authoritative). (3) Re-owning a legacy `audit.db` mid-reprovision; (4) reprovision must never drop rows.

---

## WS6 — Machine-level egress allowlist (closes OP-P0-1 network teeth) — FEASIBILITY SPIKE

**Kernel-capability finding (the long pole):** Fly.io does **NOT document** whether `CAP_NET_ADMIN`/nftables is available inside a Machine. The nftables (kernel-firewall) leg is therefore **unproven — must be tested on a throwaway `smd-staging` Machine** before committing.

**Proxy-only fallback (deployable now):** tinyproxy on **loopback 127.0.0.1:3128**, `HTTPS_PROXY` on the gateway (uid 10000), set at entrypoint after broker startup (~~`:70`) before exec to hermes (~~`:77`). Allowlist **auto-derives** from a base set + `customer.yaml.connectors{}` (~100-line python → tinyproxy `allowlist.conf`). Proxy crash → connection refused → agent observes error, no silent exfil (fail-closed).

**Per-connector compatibility matrix:**

| Connector             | Host                          | Proxy honor                                       | Status                      |
| --------------------- | ----------------------------- | ------------------------------------------------- | --------------------------- |
| Anthropic             | api.anthropic.com             | **via WS2c relay base_url, NOT proxy** (see note) | reconcile w/ WS2c           |
| Google (broker)       | googleapis.com                | broker uid 10001 env-i'd, bypasses proxy          | sound                       |
| AgentMail (Node MCP)  | mcp.agentmail.to              | unknown                                           | **MUST test**               |
| Clio (stdio MCP)      | _.clio.com                    | subprocess inherits HTTPS_PROXY?                  | **MUST test**               |
| Sentry / Healthchecks | sentry.io / hc.io             | likely                                            | confirm                     |
| R2 bootstrap fetch    | s3._.r2.cloudflarestorage.com | runs **before** proxy starts                      | **GAP — reorder or accept** |
| Fly internals         | varies                        | unknown                                           | audit entrypoint            |

**Residual without the kernel firewall (proxy-only):** `HTTPS_PROXY` is a _voluntarily-honored env var_ — LD*PRELOAD socket hijack, raw UDP/DNS, and **a raw socket opened by arbitrary `execute_code` all bypass it**. ws6 labels these "acceptable." **REVIEW NOTE for the panel:** proxy-only does NOT contain a malicious code-exec payload; only the kernel firewall does. On customer-zero this is reconciled by Phase-1 leaving `code_execution` \_unauthored/fail-closed* — so the raw-socket vector is already closed there, and proxy-only is defense-in-depth for the well-behaved library paths. The egress allowlist's marginal value is conditional on whether `code_execution` is ever authored.

**Staging tests (lead owns; throwaway box, discard after):** proxy env inheritance (Anthropic/AgentMail/Clio CONNECT logged), kernel-cap check (`nft add rule` → EPERM?), Fly service audit, R2 ordering, allowlist derivation against ≥5 sample customer.yaml, nftables rule load (if cap present). Note: on a _throwaway_ staging box, root-SSH shell probes are acceptable (machine discarded, no overlay python run as root); customer-zero stays no-root-SSH, boot-smoke + runtime-seam only.

**GO/NO-GO:** Proxy-only = **clean GO** for Phase 3a. Nftables = **conditional** on staging proving `CAP_NET_ADMIN`. NO-GO if `HTTPS_PROXY` not honored by a key library or R2 bootstrap can't be reordered.

---

## WS2b/c — Secret-strip generalization + Anthropic broker relay (closes OP-P0-2, OP-P2-1)

### (b) Secret → consumer map (the strip)

Consumers: AGENT = uid 10000 model loop · PRE = pre-agent bootstrap step · SUBPROC = MCP child · BROKER = uid 10001.

| Secret                                                                 | Real consumer                                                                     | Action                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| ANTHROPIC_API_KEY                                                      | AGENT (→ relay, part c)                                                           | MOVE to relay; unset in entrypoint after relay up                                       |
| R2_ACCESS_KEY_ID / \_SECRET_ACCESS_KEY                                 | PRE only (`bootstrap.sh:167-173` `aws s3 cp` customer.yaml fetch)                 | UNSET before gateway exec                                                               |
| R2_ENDPOINT_URL                                                        | PRE (fetch)                                                                       | UNSET (bucket name non-secret can stay)                                                 |
| **R2*SKILL_BODIES*\* **                                                | **SUBPROC/plugin — audit plugin writes SKILL bodies in-process**                  | **KEEP** (agent legitimately needs it; WS2a scopes its blast)                           |
| CLIO_ENCRYPTION_KEY / \_TOKENS_ENC_B64 / \_CLIENT_ID / \_CLIENT_SECRET | PRE seed (`bootstrap.sh:251-267`) + SUBPROC (clio-mcp child) — NOT the agent loop | Pass ONLY into clio-mcp subprocess env; UNSET from gateway env after seed (gated on D2) |
| MACHINE_HEARTBEAT_KEY                                                  | PRE/sidecar ticker (shared fleet key)                                             | UNSET if a non-agent process tickers it — **needs live check (D3)**                     |
| SENTRY_DSN                                                             | AGENT (in-process sentry-sdk)                                                     | KEEP (low-sensitivity)                                                                  |
| OPERATOR_RUNTIME_READ_KEY                                              | webhook-gate process; per-customer self-scoped                                    | KEEP                                                                                    |
| GOOGLE\_\* (6)                                                         | BROKER only                                                                       | already stripped (`entrypoint.sh:72-73`) — the model                                    |

**Ordering is the whole game.** A secret may only be unset AFTER its last pre-agent consumer and BEFORE the gateway exec. R2/CLIO last consumers live in `bootstrap.sh`, which **runs as the gateway process** (`entrypoint.sh:77-82 exec /app/bootstrap.sh`) — so `entrypoint.sh:72-73` is **too early** for them.

- **ANTHROPIC_API_KEY** → strip in `entrypoint.sh` (after relay readiness check), extend the unset block: `unset ANTHROPIC_API_KEY ANTHROPIC_TOKEN CLAUDE_CODE_OAUTH_TOKEN`.
- _*R2*\* and CLIO_\*** → strip at the **END of `bootstrap.sh`, immediately before `exec` at `:680`** (new block, load-bearing comment).
- **R2*SKILL_BODIES*\*** → NOT stripped (agent-reachable; WS2a is its fix).

### (c) Anthropic key behind a broker relay — CORE-FREE seam (verified in cloned hermes-agent @ eeb2fff)

- Hermes resolves the Anthropic endpoint from `config.yaml model.base_url` when `model.provider == anthropic`. Precedence `explicit → model_cfg.base_url → https://api.anthropic.com` (`hermes_cli/runtime_provider.py:827-849` and `1223-1290`; native SDK at `agent/anthropic_adapter.py:621`). Overlay already writes the model block (`hermes-smd-overlay/bootstrap/translate.py:541`).
- **Seam:** emit `model:` as a **dict** `{ default: claude-opus-4-8, provider: anthropic, base_url: http://127.0.0.1:8645 }`. No Hermes core change.
- **Why NOT HTTPS_PROXY (rejected, stated honestly):** the gateway calls the native Anthropic SDK over TLS; a forward proxy can't rewrite the auth header without a MITM CA, and the agent would still hold _some_ key. base_url-redirect to a loopback relay lets the relay terminate cleanly and inject auth — the only clean overlay-only seam.
- **Relay:** new `operator/anthropic_relay/` (mirror `operator/workspace_broker/`), separate restricted uid (D1), `env -i` allowlisting only `ANTHROPIC_API_KEY` + PATH/PYTHONPATH, **loopback TCP 127.0.0.1:8645 only** (never 0.0.0.0). Per request: strip client `x-api-key`/auth, inject real key, passthrough `anthropic-version`/`anthropic-beta`, forward to api.anthropic.com, **byte-exact SSE streaming passthrough**. Agent's api_key = a trivial non-OAuth placeholder ("relay"); relay overwrites it. `entrypoint.sh` starts relay, waits for port, **THEN unsets ANTHROPIC_API_KEY** (fail-closed: relay must be up before strip, else total model-call outage).

**Risks (anything that breaks model calls / a subprocess):**

- **R1 (HIGH): relay on the critical path for EVERY model call on the founder's LIVE business.** A relay bug = total outage. Mitigations: fail-closed if relay socket doesn't come up _before_ the key strip; byte-exact SSE; dependency-light venv.
- **R2 (HIGH): CLIO\_\* strip breaks the connector** if the mcp child inherits env ambiently rather than from the server spec — **D2 must be verified in the overlay mcp launcher before that strip ships.**
- R3: R2 strip placement load-bearing (move it up → first boot breaks).
- R4: heartbeat strip pending D3 live-check.
- R5: auto-detect clobber — `translate.py` must always emit `model.default` (validator assertion).
- R6: placeholder key shape must not look like OAuth (`sk-ant-oat`/JWT) or the SDK adds betas the relay must mirror.

**Open decisions:** D1 **separate relay uid** (rec) vs reuse 10001. D2 **verify clio-mcp child env source** (overlay `mcp_registry.py` + Hermes launcher) before CLIO*\* strip — the one item not closeable from ss-console alone. D3 heartbeat-process live-check. \*\*D4 ship order: relay + ANTHROPIC/R2 strips together (self-contained); CLIO*\* strip rides a follow-on gated on D2.\*\*

---

## Cross-workstream couplings (why review is consolidated)

1. **WS6 proxy vs WS2c relay** both intercept Anthropic egress — and they use _different_ mechanisms (WS6 forward proxy; WS2c base*url loopback relay). The relay's outbound call to api.anthropic.com is what must be allowlisted, made \_by the relay uid*, not the agent. Must compose, not collide.
2. **Three broker principals** after Phase 2: Google (uid 10001), audit (uid 10002), Anthropic relay (separate uid). Three socket-wait gates + three fail-closed boot gates **compound boot fragility on the founder's live business.** The entrypoint boot sequence must stay legible and each gate's failure blast-radius understood.
3. **WS6 "R2 fetch before proxy" gap ∩ WS2b R2 strip:** R2 creds are pre-agent (bootstrap fetch) and stripped before the agent exec — coherent, but proxy-start ordering and strip ordering must be designed once across both.
4. **Shared dependency:** WS5 and WS6 both REQUIRE a throwaway `smd-staging` Machine proof before customer-zero. Stand it up once, run both proofs there.

## Sequencing hypothesis (for the panel to challenge)

- **2.1:** WS2a scoped R2 (closes the crown-jewel; low risk; mostly provisioning) — lands first/standalone.
- **2.2:** WS5 audit broker (gates any future send; staging-proven first).
- **2.3:** WS2b R2/ANTHROPIC strips + WS2c relay together (D4); CLIO\_\* strip follow-on gated on D2.
- **Phase 3:** WS6 proxy-only (after staging), nftables conditional; WS4 broker intent-gate + provenance; then directed send-as-EA.

---

## PANEL REVIEW OUTCOMES (4 reviewers: security, reliability, correctness, pragmatist)

### Consensus

1. **PR-1 first: WS2a scoped R2 + R2/CLIO strips** — highest severity (cross-tenant crown jewel), near-zero outage risk (provisioning + boot-side; nothing on the live model path moves). Land standalone.
2. **PR-2: WS5 audit broker** — staging-proven, with the mandatory fixes below; gates the future send, not the crown jewel.
3. **Relay + egress are lower marginal value on customer-zero** — Phase 1 already fail-closes `code_execution` there (`operator/customers/smd/customer.yaml` authors no `code_execution` ceiling), so the env-exfil vector both defend is already shut on this customer.

### MANDATORY fixes (fold into the designs — not optional)

- **R1 (reliability, highest-leverage):** `entrypoint.sh:18` runs `chown -R hermes:hermes /opt/data` on EVERY boot → re-owns the audit tree back to hermes (silent false-close of OP-P1-4, or a chown-ordering brick). Fix: exclude `/opt/data/audit` from line 18; establish audit-broker ownership after the narrowed chown, while still root; boot-smoke assert `stat -c %U /opt/data/audit/audit.db == audit-broker`.
- **R5 (reliability):** audit.db migration must be **convergent, not conditional** — unconditionally re-assert owner/mode on `audit.db` + `-wal` + `-shm` every boot (idempotent), never "migrate if legacy detected" (skips wrong-owned files from partial prior runs). Never `rm` rows; `die` with path if unreadable.
- **R2 (reliability/security):** the relay has **no supervision** — a mid-day crash = total model outage with the key already stripped. Fix: supervise+respawn with the webhook-gate `while true; sleep 2` pattern (bootstrap.sh ~668-672). Prove byte-exact SSE on a real streamed tool-use turn on staging.
- **R4 (reliability):** three brokers × three socket-waits × three fail-closed gates, each die-on-first-miss on a 5s budget → crash-loop risk on a cold Machine. Fix: bounded retries with a longer ceiling (reinstate the `wait_for()` helper), one legible ordered "principals up" block with per-gate log lines (diagnosable from `fly logs`, no root-SSH), cheapest-gate-first.
- **Security — relay-as-open-proxy:** a loopback-reachable `127.0.0.1:8645` relay is an exfil channel even without the key (a child curls it with a crafted prompt, exfils via the model's own output). Fix: per-turn auth header the child doesn't hold, or a unix socket rather than ambient loopback TCP.
- **Security — crown-jewel close is incomplete without the fallback removal:** `R2_SKILL_BODIES_*` is KEPT in-env and `provision-customer.sh:361-366` falls back to the account-wide `R2_ACCESS_KEY_ID` when unset. Stripping `R2_ACCESS_KEY_ID` alone leaves the account-wide key in-env via the KEEP'd var. Fix: WS2a provisioning must **`die` if `R2_SKILL_BODIES_*` is unset, not fall back**. WS2a and the R2 strip are one coupled unit in PR-1.
- **Rollback (reliability):** Phase 2 is a **two-repo revert** (OVERLAY_REF bump reverts overlay code only; uid/perm/migration live in ss-console) AND the audit.db migration is a one-way volume mutation — a pre-Phase-2 image expecting a hermes-owned audit.db crash-loops on the migrated file. Fix: rollback image carries a convergent "re-own audit.db back to hermes if no audit-broker uid" step (or keep the migrated file group-readable by a group hermes is in). Prove rollback on staging.

### ADJUDICATED contradictions

- **WS5 journal mode — rollback-journal + busy_timeout, NOT WAL** (reliability R3 over designer rec #5). At one-row-per-turn audit frequency the WAL read-concurrency win is negligible, while WAL's cross-uid `-wal`/`-shm` perm surface is the single highest brick-uncertainty in the program. Rollback-journal removes the unknown entirely and lets the fail-closed `die` fire only on a genuine write failure. Revisit only if a future high-write-rate need appears.
- **WS5 broker venv — pip-install pinned overlay vs copy-two-modules → STAGING-MEASURED** (reliability R4 vs designer rec #3). Default pip-install (single-source the row contract); if it adds material boot seconds on a cold Machine, fall to copy. Decide on the staging boot-time measurement, not now.

### CORRECTNESS verdicts (relay seam = buildable)

- **WS2c relay seam CONFIRMED** against source: `runtime_provider.py:827-832` + `1223-1232` (base_url precedence), `:122-130` (`_auto_detect_local_model` needs `is_local && is_fallback && base_url`; `default` set ⇒ no auto-detect), `anthropic_adapter.py:621` (SDK base_url kwarg). The HTTPS_PROXY-rejected / base_url-relay correction is right.
- Impl notes: `translate.py:541` currently passes `customer.get("model")` through — must be rewritten to **emit a dict** `{default, provider, base_url}` when the relay is enabled for that customer (naturally per-customer-toggleable). `register()` does NOT re-raise on `ensure_schema` failure (logs, sets writer=None) — the **bootstrap gate is the authoritative wall** (as designed). **Re-pin every `entrypoint.sh` line ref before implementation** — the file is 83 lines; several design refs (e.g. `:355-366`) resolve to `provision-customer.sh`, and the R1 blocker (line 18) is invisible at the quoted refs.

### REVISED SEQUENCE

- **PR-1 (now, near-zero risk):** WS2a scoped R2 (out-of-band mint → Infisical, `die`-on-missing, no account-wide fallback) + WS2b R2 strip. CLIO\_\* strip splits to a D2-gated follow-on. Closes the cross-tenant crown jewel.
- **PR-2 (staging-proven first):** WS5 audit broker with R1/R5/R4 fixes + rollback-journal + convergent migration + rollback path. Stand up `smd-staging`, prove file-perm behavior + boot-smoke owner/write-fail assertions + rollback, then customer-zero. Closes OP-P1-4; gates send.
- **Phase 3:** WS6 proxy-only (after staging; nftables trigger-gated on any customer authoring `code_execution`); WS4 broker intent-gate + provenance; then directed send-as-EA.

### PENDING CAPTAIN DECISION

- **Relay posture on customer-zero** (the founder's live business): build-now-enable-#2-onward (rec) vs enable-on-customer-zero-this-phase vs defer-entirely. The relay protects SMD's own single-tenant rotatable Anthropic key against a vector already fail-closed on customer-zero, at the highest live-outage risk in the program. See session thread.
