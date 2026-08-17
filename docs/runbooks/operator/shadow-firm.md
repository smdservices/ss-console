# Runbook: the shadow firm (standing adversarial rehearsal)

Issue: [#2389](https://github.com/venturecrane/ss-console/issues/2389) (Track 3 of the hardening program, [#2392](https://github.com/venturecrane/ss-console/issues/2392))
Code: `operator/rehearsal/`
Related: `operator/bin/rehearse-card.py` (ungraded rehearsal), `operator/bin/seat-readiness.py`, `operator/bin/reconcile-sends.py`

## What it is

A suite that plays the client hostile against a rig seat, replaying every
incident class this venture has actually had, and scores each scenario from
artifacts the seat produced rather than from how its answers read. It emits a run
id, and an `OVERLAY_REF` bump PR cites that id.

`rehearse-card.py` deliberately does not grade, and that is still right: it
replays a script whose replies are prose, and prose graded by the same agent that
wrote the prompt is how a mis-designed test once read as a product failure. The
shadow firm grades because it never reads an answer for meaning. Every predicate
is a named audit row appearing or not appearing, a message arriving or not
arriving in a mailbox we own, or a regex over a reply. Nothing in it has an
opinion.

## The hard line

**No scenario may target a client seat, a client-visible address, or a
production tenant.** Probe-harness mailboxes and rig seats only. This is the
ss#2258 incident class, and it is enforced in code (`operator/rehearsal/scope.py`)
rather than written in a comment:

- Every address a scenario speaks as, speaks to, names in a subject, names in a
  body, or claims to observe must be on the harness allowlist. RFC 2606
  reserved-domain addresses (the rig's seeded party contacts) may be named in
  prose but are never drive endpoints.
- The target seat must declare a rig `seat.kind` in its own `customer.yaml`
  (`proving`, `sandbox`, `preprod`). `customer` and `internal` are refused by
  name; an unclassified seat is refused too, because "cannot evaluate" must not
  read as "permitted".

Both gates abort the run with exit 2 before anything is driven. There is no flag
that relaxes either one.

## Running it

```bash
operator/rehearsal/run.py --list                          # the registry; drives nothing
operator/rehearsal/run.py --seat pilot-smokeball          # plan only; sends nothing

infisical run --env=prod --path=/ss -- \
  operator/rehearsal/run.py --seat pilot-smokeball --drive
```

**Arming is explicit.** Without `--drive` the runner prints the plan and sends
nothing. The AgentMail and seam credentials are ambient in any shell that has run
`infisical run`, so a bare invocation would otherwise put live adversarial mail
into a seat with no further confirmation. That happened once during development,
inside a minute, on an invocation meant as a dry run.

Useful flags: `--only <id>[,<id>]`, `--overlay-ref <ref>` (defaults to the ref
pinned in `operator/templates/Dockerfile`), `--inject <fault>` to declare a fault
you have already put in place on the rig, `--out <dir>` (default
`.stitch/shadow-firm/`).

Exit codes:

| Code | Meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| 0    | GREEN. Every scenario passed. Only this run may be cited by a release gate.    |
| 1    | A scenario FAILED.                                                             |
| 3    | Nothing failed, but something was SKIPPED, so the suite is incomplete.         |
| 2    | Refused before driving anything (scope violation, bad registry, unknown seat). |

**SKIPPED is visibly not PASS.** A scenario whose credentials, channel, or
declared fault were absent did not run, so it proves nothing, and the run id it
belongs to ends in `-notgreen`.

## The scenarios

| Scenario                        | Replays                           | Needs                                          |
| ------------------------------- | --------------------------------- | ---------------------------------------------- |
| `direct-api-send-bypass`        | ss#2258                           | seat, AgentMail, audit seam                    |
| `cross-matter-bait`             | ss#2167 / ADR 0086 kill-test pair | seat, AgentMail, audit seam                    |
| `fabrication-bait`              | ss#2168                           | seat, AgentMail                                |
| `inbound-instruction-injection` | ADR 0028                          | seat, AgentMail, audit seam                    |
| `connector-down-mid-task`       | ADR 0080                          | seat, AgentMail, audit seam, an injected fault |
| `unauthored-sender-refusal`     | ss#2222 / ADR 0085                | seat, AgentMail, audit seam                    |

Each scenario file carries its own `hostile_act`, its `falsifier` (what would
make it meaningless), and per-expectation `why` notes. Read the file, not this
table, before trusting a result.

## Adding a scenario

A scenario is a YAML file in `operator/rehearsal/scenarios/`, named for its id.
It must declare the incident it replays, the hostile act, its own falsifier, and
at least one leg with at least one expectation the scorer evaluates. The loader
refuses anything else: a leg with no expectation cannot fail, and a check that
cannot fail measured nothing. Audit action types are checked against
`operator/contracts/audit-action-vocabulary.json`, so a typo cannot become an
expectation that holds forever.

Prefer a PAIR over a single refusal. Asserting only that something was refused
proves nothing about the wiring: a seat with the capability switched off passes
that test. `cross-matter-bait` and `unauthored-sender-refusal` are both pairs for
this reason, and both fail if the control leg does not go through.

## Release gate: OVERLAY_REF bumps

A PR that bumps `ARG OVERLAY_REF` in `operator/templates/Dockerfile` cites the
run id of a green shadow-firm run against the candidate ref. See
`/admin/playbook/deployment-release` (Path B, step 2a) for where this sits in the
deploy flow.

The run id is a digest over the seat, the candidate ref, and every scenario's
outcome, and it ends in `-green` or `-notgreen`. Citing a green id for a red run
therefore takes forgery rather than a typo, and any reader can recompute the
digest from the committed report body.

## Falsifier for the suite itself

`operator/rehearsal/tests/test_falsifier.py` runs the real scorer against
deliberately broken scenarios and hostile observation bundles, and asserts FAIL:
a scenario expecting a row that never comes, a cross-matter gate that refuses the
correct pairing too, a privileged instruction that works for nobody, a send with
no audit row. It also pins the fail-closed direction: an unreadable ledger scores
SKIPPED, never PASS. Run it before trusting a green run:

```bash
cd operator && python3 -m pytest rehearsal/tests -q
```
