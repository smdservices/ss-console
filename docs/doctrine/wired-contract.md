# The Reachability Contract (Law 9)

Converts an ask into a contract that names what the client can do, where the change must land, and every gate in between. Follow it **before** writing a plan and before `/critique`.

> **Invocation status.** This is a document, not yet a slash command. The enterprise skill triplet (`.claude/commands/`, `.gemini/commands/`, `.agents/skills/`) is gitignored in ss-console and synced from crane-console on every `crane ss` launch, so a skill authored here would be untracked and orphaned by the next sync. Promoting this to an invocable `/wired` means adding it to crane-console, which is a cross-repo change and the Captain's call. Until then it is reached from Law 9 and from CLAUDE.md, at prose tier. The merge gate below is live regardless.

## Why this exists

The 2026-07-28 entitlement-control incident: four PRs, each individually honest, each defining "done" as the artifact it added. One of them wrote "Next slices, unbuilt and not implied here." Nobody lied. The artifacts summed to less than the feature, and the feature was reported built, wired, and tested while a real client could not perform the act.

That is a definition problem, not a diligence problem. More care would not have caught it, because each PR met its own definition. This skill replaces the definition.

Three terms, used precisely:

- **Built** - the code exists and its own tests pass. The weakest of the three and the easiest to mistake for done, because it produces the most visible evidence.
- **Wired** - every gate between a real client's finger and the effect is open **on the deployment that client uses**. Not "would work once configured." Configured. Secrets and config authoring are part of the deliverable, not prerequisites belonging to someone else.
- **Tested** - someone performed the act **as the client, on the real seat**, and observed the far end change. A green unit test against a fake token is not this.

## When it applies

Required when the effect is observable by someone outside this repo: a client, the Captain on a live surface, an Operator seat, a prospect on a marketing page.

Skipped for internal refactors, test-only changes, and documentation. Do not grow a gate table on a typo fix; an obstacle course that fires on everything gets routed around, and then it protects nothing.

## Step 1: The sentence

Rewrite the ask as **an act a named person performs** and **an outcome they observe**. One sentence.

A component noun is not a deliverable. A component can be complete while the feature is dead, which is exactly how the incident happened.

| Rejected                        | Accepted                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| "Build the entitlement control" | "A Named Administrator at Ashton & Price can raise a routine's level and lower it back, and the Operator's next action honors the new level." |
| "Add the pause API"             | "A principal can pause a routine from the portal and the next scheduled run does not fire."                                                   |
| "Wire up webhook ingestion"     | "A SignWell countersignature lands and the engagement's status changes on the client's portal without anyone touching the admin console."     |

If you cannot write the sentence without naming a component, you do not yet know what the work is for. Ask.

## Step 2: The terminal seam

Name the **last place the change must land** for the sentence to be true.

Not a merged PR. Not a green test. Not a row in a ledger. For Operator work it is usually the running Machine's behavior. Whoever takes the work owns the entire distance to that seam.

## Step 3: The gate chain

Enumerate every gate between the finger and the effect, **working backwards from the seam**.

Backwards is not a stylistic preference. Forward enumeration produces the artifacts you already planned to build. Backwards enumeration is what surfaces adoption, roles, secrets, and transport, which are the gates nobody plans because they are not code. Start at "the Operator's next action honors the new level" and ask what must be true immediately before it, then repeat until you reach the client's finger.

Layers, reused from the removal-side list in CLAUDE.md ("Gone means gone"). That section enumerates where an artifact can live so a removal can prove absence at each one. This is its positive twin:

| Layer                        | Runtime? | Typical gates                                |
| ---------------------------- | -------- | -------------------------------------------- |
| git (source, fixtures, docs) | repo     | code exists, tests pass                      |
| D1 projections               | runtime  | row written, `customer_configs` re-projected |
| R2 (skills, vaults, config)  | runtime  | object present at the key the seat reads     |
| Fly volume (`/opt/data`)     | runtime  | profile home, cron store, token on disk      |
| Running Machine              | runtime  | env loaded, config adopted, behavior changed |
| Monitoring                   | runtime  | heartbeat field, alert sink, Sentry          |
| External records             | runtime  | GitHub, mailbox, calendar, vendor dashboard  |

Emit the chain as a table:

| #   | Gate                                          | Layer             | Owner            | Closable now? | Proof |
| --- | --------------------------------------------- | ----------------- | ---------------- | ------------- | ----- |
| 1   | Control renders for that role                 | repo              | agent            | yes           |       |
| 2   | Write persists                                | runtime (D1)      | agent            | yes           |       |
| 3   | Role granted on the real seat                 | runtime (Machine) | ?                | probe         |       |
| 4   | Authority authored on their seat              | runtime (config)  | client / Captain | probe         |       |
| 5   | Secret deployed                               | runtime (Fly)     | agent            | probe         |       |
| 6   | Transport reachable                           | runtime (Machine) | agent            | probe         |       |
| 7   | Running Operator adopts the change            | runtime (Machine) | agent            | probe         |       |
| 8   | Act performed as the client, far end observed | runtime (Machine) | agent            | probe         |       |

**Owner** is resolved per Law 1: agents own execution, the Captain owns spend and external commitments, the client owns their own posture (entitlements, autonomy tiers, risk acceptance). A gate whose owner is not the executing agent is not thereby out of scope; it is a gate you must surface, not silently skip.

## Step 4: The feasibility probe

This is the load-bearing step, and the one an agent will want to skip because it feels like stalling before the real work.

**Before writing any code**, probe every row marked `probe` and record closable-now yes or no. Probing costs minutes. It converts "would work once configured" into a known fact at plan time instead of at delivery time.

Then apply the stop clause, which is pre-registered here so it does not have to be remembered mid-flight:

> If any gate cannot be made true, stop and report which gate and why, **before building the gates that can**.

Not "build my slice and note the rest as unbuilt." That sentence is what turns an honest agent into a producer of honest slices that never reach the client. An unclosable gate is an escalation, and it is due at the top of the work, not at the end.

## Step 5: Emit the contract

Write the gate chain into the tracking issue as acceptance criteria, one per gate, each tagged with its layer:

```markdown
## Acceptance criteria

- [ ] (repo) Entitlement control renders for the Named Administrator role
- [ ] (runtime) Level write persists to D1 and survives re-projection
- [ ] (runtime) Authority authored on the ashton-price seat
- [ ] (runtime) Running Operator adopts the new level without a reprovision
- [ ] (runtime) Level raised and lowered as the client on the real seat, next action observed honoring it
```

The tags are load-bearing, not decoration. `.github/workflows/runtime-ac-proof.yml` blocks any PR that marks a `(runtime)` AC as met without a `crane_verify` ID in the Evidence column. That gate exists because CI otherwise ticks whatever the merging PR declares about itself, which is how four honest PRs closed an epic on a dead feature.

Record the contract's sentence and terminal seam in the issue body above the ACs, so the next agent to pick it up inherits the definition rather than re-deriving one.

## Step 6: Hand off to planning

State the contract, then write the plan against it, then run `/critique`. Critique carries one mandatory added dimension when a contract exists:

> Does this plan close every row of the gate chain, or does it silently defer some? Name any row the plan does not reach.

## Output

```
Sentence:      <act + observed outcome>
Terminal seam: <the last place the change must land>

<gate chain table>

Unclosable now: <rows, owners, and what would unblock them>  |  none
```

If any row is unclosable, that is the whole output. Stop there and escalate.
