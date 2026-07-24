---
title: Mediated Connector Capability Broker - Credentials Outside the Agent Runtime
date: 2026-06-10
status: accepted
captain: Scott Durgan
amends: 0020-connector-strategy.md, 0021-leverage-hermes-native-primitives.md
related-adr: 0006-capability-adapter-pattern.md, 0010-per-customer-oauth-token-storage.md, 0035-no-imposed-entitlement-defaults.md, 0036-oauth-token-relay-fly-secret-restart.md, 0042-operator-credential-custody.md
---

# ADR 0045 - Mediated Connector Capability Broker

**Status: ACCEPTED. Captain decision, 2026-06-10.**

The architecture is approved. The interim path is Option 2: build the
provisional isolated Workspace proxy as the first production increment of the
broker, not as a parallel or disposable system. Client launch remains blocked
until the complete positive and negative verification contract passes.

This ADR addresses a launch-blocking governance bypass. The current Google
Workspace implementation places a broadly scoped domain-wide delegation
credential inside the Hermes gateway runtime. General-purpose tools can use
that credential without naming the Workspace operation to the trust hook.
Reclassifying a general-purpose tool does not solve that class of failure.

## Context

The live harness correctly classifies and gates first-class tool dispatches.
The guarantee breaks when the classified outer tool is more general than the
privileged operation it performs.

The current Google path has all three conditions required for a bypass:

1. `bootstrap.sh` materializes the service-account key at
   `/opt/data/oauth/google.json`, owned by the same `hermes` user that runs the
   gateway.
2. The gateway and its child processes inherit the DWD impersonation subject
   and full authored scope set.
3. Workspace skills invoke provider CLIs through `execute_code` and `terminal`.
   Trust sees the outer general-purpose tool, not the nested Gmail, Calendar,
   Drive, Docs, or Sheets operation.

The outer tool can therefore be classified `READ` while the nested operation
creates, modifies, shares, sends, or deletes provider state. The same issue
exists for any connector credential available to a general-purpose execution
or file-access surface in the same security principal.

This is also the root of the recurring Google auth durability problem. Raw
credential material has moved through portal exchange, Fly secrets, boot
decode, environment export, volume files, connector loaders, refresh writes,
and gateway restarts because the agent runtime itself owns provider
authentication. Every lifecycle change must preserve that chain.

## Bypass Inventory

### Confirmed model-reachable paths

| Path                                        | How privileged authority is reached                                                                            | Why trust cannot classify the real operation                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `execute_code`                              | Reads the credential file, imports `_google_auth`, invokes a connector CLI, or calls the provider SDK directly | The hook sees `execute_code`, not the nested provider method                                         |
| `terminal`                                  | Runs connector CLIs, Python, shell utilities, or direct HTTP/SDK calls under the gateway user                  | The hook sees one general shell action                                                               |
| Nested `terminal` inside `execute_code`     | Uses Hermes RPC from the child process to invoke shell commands                                                | The nested provider operation is not a first-class dispatch                                          |
| File-access tools                           | Read raw credentials, profile config, token stores, or process environment exposed to the gateway UID          | Reading authority enables later direct provider calls under a separately classified general tool     |
| Agent-authored skills via `skill_manage`    | Persist code or instructions that later invoke the same general tools                                          | Persistence changes when the bypass runs, not whether it is mediated                                 |
| `delegate_task` and auxiliary agents        | Delegate a workflow to another agent with general execution or connector access                                | Delegation preserves the underlying runtime authority while trust sees only the delegated tool calls |
| Cron, bundles, and webhook-triggered skills | Start the same skills without a conversational turn                                                            | Initiation changes, but the skill still reaches raw authority through general tools                  |

### Connector surfaces affected by the same class

The defect is not Google-specific:

- BUILD connector tokens or API keys available in gateway environment variables.
- OAuth token files on the shared per-customer volume.
- MCP subprocess credentials embedded in profile configuration or readable
  token stores when the gateway UID can read them.
- Static secrets injected into the same process environment as general tools.
- Any future connector SDK imported directly by agent-authored Python.

First-class MCP or plugin tools are classified at dispatch, but they do not
close the class if their underlying credential is also readable by the agent
runtime. A model can bypass the first-class tool and call the provider directly.

### Trusted processes that share the custody root

Bootstrap, credential relay, webhook verification, connector health checks,
and Captain SSH access are not model tool paths. They are not harness bypasses
by themselves. They still demonstrate that credential custody is currently
co-resident with the gateway and must be separated carefully.

## Decision

**Connector authority moves behind a per-customer capability broker. The
Hermes gateway and every general-purpose tool run without raw connector
credentials. Every privileged provider operation is exposed as a first-class,
trust-classified tool and executed only after the broker validates an
operation-bound grant.**

### 1. Security boundary

The broker runs as a separate OS security principal or separately isolated
service within the customer's Machine boundary:

- Provider credentials and token stores are readable only by the broker.
- The gateway runs as a non-root principal with no `sudo`, setuid, Linux
  capability, writable service-definition, container-control, or other path to
  become root or the broker principal.
- The gateway UID cannot read the broker's secret files, environment, memory,
  or refresh-token store.
- `execute_code`, `terminal`, file tools, subagents, skills, cron, and webhook
  turns receive a secretless environment.
- The gateway reaches the broker only through an authenticated local transport,
  preferably a Unix socket whose filesystem permissions allow requests but no
  credential access.
- The broker exposes no arbitrary command, arbitrary URL, arbitrary HTTP
  method, raw token, or generic provider-SDK endpoint.

Process separation is required. Wrapper conventions, file permissions under
the same UID, prompt rules, and hidden paths are not security boundaries.
UID separation is not accepted as a boundary until escalation from the gateway
principal to root or the broker principal is tested and refused.

### 2. First-class operation tools

Every connector operation has:

- A stable Hermes tool name.
- A closed input and output schema.
- A declared capability and action class.
- Reversibility and exposure metadata.
- Resource constraints such as mailbox, calendar, folder, document, range,
  recipient, or tenant scope.
- An explicit provider adapter implementation inside the broker.

Workspace examples include:

| Tool                                                                                        | Action class                                                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `workspace_gmail_search`, `workspace_gmail_get`                                             | `READ`                                                                             |
| `workspace_gmail_modify`, `workspace_gmail_create_draft`                                    | `INTERNAL_WRITE`                                                                   |
| `workspace_gmail_send`                                                                      | `EXTERNAL_SEND`                                                                    |
| `workspace_calendar_list`, `workspace_calendar_get`                                         | `READ`                                                                             |
| `workspace_calendar_create`, `workspace_calendar_update`                                    | `INTERNAL_WRITE` or `COMMITMENT`, according to notification and attendee semantics |
| `workspace_drive_list`, `workspace_drive_get`, `workspace_docs_get`, `workspace_sheets_get` | `READ`                                                                             |
| `workspace_docs_create`, `workspace_docs_append`, `workspace_sheets_update`                 | `INTERNAL_WRITE`                                                                   |
| `workspace_drive_share`                                                                     | `EXTERNAL_SEND` or `COMMITMENT`, according to the approved action-class contract   |
| Delete, ownership transfer, public sharing, and equivalent irreversible operations          | `DESTRUCTIVE`                                                                      |

The final registry is a reviewed contract. No provider verb is inferred from
free-form code, and no operation inherits the classification of a generic
dispatcher.

### 3. Trust decision and broker grant

The gateway performs trust enforcement before calling the broker. An allowed
decision produces a short-lived, single-use capability grant containing:

- Customer and persona identity.
- Connector and exact operation.
- Canonical payload digest.
- Resource constraints.
- Tool-call and trace identifiers.
- Effective action class and ceiling decision.
- Issued-at and expiry timestamps.
- Nonce.

The grant is authenticated with a key unavailable to the model and general
tools. The broker verifies the grant, rejects replay or payload changes, and
executes only the named operation. The broker does not accept a caller-supplied
customer identity outside the authenticated grant.

Trust decision and execution audit rows share the same trace and tool-call
identifiers. A broker execution without a valid decision is impossible. A
decision without execution remains visible as an incomplete pair.

### 4. Credential and token lifecycle

The broker becomes the sole runtime owner of connector authentication:

- DWD service-account keys are mounted or injected only into the broker.
- User OAuth refresh tokens are stored in a broker-only per-customer token
  store.
- The broker mints and refreshes short-lived access tokens.
- The gateway never receives provider tokens, service-account JSON, OAuth
  client secrets, impersonation subjects, or raw scope strings needed to mint
  tokens.
- Scope configuration remains authored in `customer.yaml`, but the broker
  validates requested scopes against provider-authorized scopes at startup.
- Rotation and re-consent update broker custody, not gateway environment or
  gateway-readable volume files.

ADR 0010's per-customer storage and ADR 0042's delegated/self-held custody
choices remain. The amendment is that "operator runtime can use it" means the
broker security principal can use it, not the agent gateway or its tools.

ADR 0036's portal-to-Machine relay remains viable as a transport, but the boot
target changes from a gateway-readable file to the broker's secret store.
Credential activation restarts or reloads the broker only where possible.

This retires the recurring auth-durability root:

- One component owns provider token formats.
- One component owns refresh and persistence.
- One readiness check proves the broker can authenticate.
- Gateway restarts and Hermes profile changes no longer determine credential
  availability.
- Connector auth failures become broker health and lifecycle events, not
  hidden differences between fresh and live agent processes.

### 5. Composition with ADR 0006 and ADR 0020

ADR 0006's capability interfaces remain the authoring and validation model.
Hermes still receives ordinary first-class tools.

ADR 0020's vendor selection order also remains:

- `mcp:` means a vetted provider MCP surface.
- `build:` means an SMD-maintained provider adapter.
- `synthetic:` means an SMD-owned substrate.

The runtime meaning changes:

- A `build:` adapter with privileged credentials runs inside the broker, not
  inside the gateway or an agent shell.
- A local credentialed MCP server runs in the broker boundary, or behind an
  equivalent isolated service boundary. The gateway receives only its
  mediated tool surface.
- A remote vendor MCP must provide an equivalent per-operation authenticated
  boundary. Its access credential must not be exposed to general gateway
  tools.
- Synthetic tools without external credentials may remain in-process when
  their storage authority is already narrowly mediated and classified.

ADR 0020's statement that the Machine is the user's computer and
`execute_code` may call Google at granted scopes is superseded. Scope remains a
provider-side maximum. It is not the harness action boundary.

ADR 0021's use of `execute_code` for local computation remains valid.
`execute_code` may aggregate results from first-class read tools through a
restricted RPC surface, but it cannot inherit connector credentials or invoke
arbitrary provider operations.

This is a portfolio-wide connector re-architecture, not a Google-only patch.
Every credentialed BUILD adapter and local MCP server must cross the same
custody boundary. Every privileged provider operation requires a reviewed,
first-class operation contract and action class. Connector onboarding is not
complete until that contract exists.

### 6. Failure posture

- Broker unavailable: connector operations fail closed and report a connector
  health failure. General local computation remains available without secrets.
- Missing operation classification: the tool does not register.
- Missing authored entitlement: trust refuses per ADR 0035.
- Grant verification, replay, expiry, or payload mismatch: broker refuses and
  audits.
- Credential or scope mismatch: broker refuses startup or marks the connector
  unavailable. It never widens scopes.

### 7. Latency posture

The mediated path adds trust decision, grant creation, local transport, and
grant verification before the provider call. This cost is accepted because the
security boundary is mandatory and the dominant latency should remain the
external provider request.

The implementation must measure mediation overhead separately from provider
latency under both single-call and chatty workloads. Local mediation must stay
bounded and observable; batching is permitted only when each operation retains
its own classification, grant constraints, and audit identity.

## Migration

The build is a separate approved effort:

1. Define the operation registry and action classes for each enabled Workspace
   method.
2. Introduce the isolated broker and grant protocol without changing the
   gateway's current credential path.
3. Move Google credential custody and token refresh into the broker.
4. Register first-class Workspace tools backed by broker operations.
5. Migrate skills from connector CLIs to first-class tools.
6. Remove Google secrets, token files, DWD environment, and connector SDK
   access from the gateway and general tools.
7. Repeat the custody audit for every enabled BUILD and MCP connector.
8. Delete the legacy direct connector path only after positive and negative
   end-to-end verification.

No paying client launches with a raw privileged connector credential reachable
from the gateway.

## Realized — migration step 7 as an enforced guard (2026-07-13, #1841)

The full broker migration of every connector is a large build; step 7 ("repeat
the custody audit for every enabled connector") is realized now as a
**config-time guard** plus a per-connector disposition record, so the bright
line is enforced instead of trusted:

- **Disposition record.** `operator/contracts/connector-custody-dispositions.md`
  carries the ADR-required "behind the broker vs accepted-in-gateway with
  rationale" verdict for every connector/channel. Google is behind the broker;
  Smokeball and MS Graph are client-data connectors that must move behind the
  broker before any seat pairs them with `code_execution`; AgentMail, Telegram,
  and web-search are identity-channel/no-client-data surfaces eligible for an
  authored exception.
- **The guard.** A seat may author non-refused `code_execution` only if every
  gateway-held credential surface is broker-mediated or listed in a top-level
  `custody_exceptions`. Eligibility is enum-limited to identity-channel adapters
  (`telegram`, `agentmail`, `brave`); **client-data connectors can never be
  excepted**. Enforced in both validators (console
  `sections-custody-guard.ts`, on-box `bootstrap/validate.py`
  `_validate_custody_guard`), parity-pinned by the fixtures contract. This is
  the config-time realization of ADR 0044 Decision 8's launch-blocker.
- **Live state.** Only the `smd` (Crane) seat authors `code_execution` today;
  its sole gateway surfaces are its own Telegram bot and AgentMail inbox, both
  authored in `custody_exceptions` — so the guard passes and no client-data
  credential is in play. The paying law seats leave `code_execution` unauthored
  (fail-closed), which is why the Smokeball-in-gateway credential is not yet a
  live exposure; the guard makes it an authoring-time blocker the instant that
  changes. Verification items 1–3 and 10 (the live negative read / env scan)
  remain the runtime backstop this guard front-runs.

## Verification

The broker is complete only when:

1. A secretless `execute_code` process cannot read connector credentials,
   mint a token, import an authenticated provider client, or call a connector
   CLI with ambient authority.
2. The gateway principal cannot become root or the broker principal through
   `sudo`, setuid binaries, Linux capabilities, writable supervisor/container
   controls, or equivalent escalation paths.
3. `terminal`, file tools, delegated agents, scheduled skills, and
   agent-authored skills fail the same negative test.
4. Every enabled Workspace operation has a first-class tool and explicit
   action class. No unknown privileged tool defaults to `READ`.
5. An authorized read and write execute end to end and produce paired trust
   decision and broker execution audit rows.
6. An unauthorized write, external send, commitment, and destructive action
   each fail before provider execution.
7. A valid grant cannot be replayed, widened, used for another payload, or
   used for another customer.
8. Broker unavailability fails connector operations closed without exposing a
   fallback raw credential path.
9. Credential rotation, OAuth refresh, re-consent, broker restart, gateway
   restart, and Machine restart each preserve the documented lifecycle.
10. A source and live-runtime custody scan confirms no connector secret is
    present in gateway environment, gateway-readable files, profile config, or
    child-process environment.
11. Mediation overhead is measured separately from provider latency and stays
    within the implementation budget approved with the build plan.

## Alternatives Rejected

### Reclassify `execute_code`

Rejected. It can perform reads, writes, sends, commitments, and destructive
actions. One static class is necessarily wrong, and blocking it globally
removes legitimate local computation without mediating connector authority.

### Inspect or parse arbitrary code before execution

Rejected. Static inspection cannot reliably infer runtime provider behavior,
indirect imports, subprocesses, generated code, network calls, or obfuscation.

### Narrow DWD scopes only

Rejected as the durable fix. Least privilege reduces blast radius but does not
make individual operations visible to trust. Broad features still require
write scopes that cover multiple action classes.

### Keep credentials in the gateway and require wrapper CLIs

Rejected. A convention is bypassable whenever the credential or token is
available to general code.

### File permissions under the gateway UID

Rejected. `0600` protects against other users, not against the agent process
and child processes running as the owner.

## Interim Decision

Captain selected Option 2 on 2026-06-10:

**Build the provisional isolated Workspace proxy as the first broker slice.**
Move the Google credential to a non-root broker principal and expose only the
reviewed current operations over an authenticated local socket. Customer-zero
keeps Workspace capability while the raw credential path is removed from the
gateway.

This increment must use the final broker boundary and protocol direction. It
must not create a second proxy architecture that later requires replacement.
If the broker slice cannot begin immediately, the fallback is to remove Google
credentials from the gateway and pause customer-zero Workspace operations.

Disabling general tools while retaining co-resident credentials and accepting
the bypass on customer-zero are rejected. No client launch is authorized before
the durable broker verification passes.
