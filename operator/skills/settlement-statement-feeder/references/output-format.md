# Settlement Statement Feeder - Output Format

Derived from
`operator/verticals/law-firm/addons/pi/references/_shared-assembler-output-format.md`.
The assembler collates authored components into the mechanical structure a settlement
statement requires; it never authors substance. Every value comes from a matter read.
Smokeball runs the trust accounting and the authoritative math; the artifact is staged
for a person to verify and execute in Smokeball.

The situation determines the shape.

## Shape A - Statement assembled (all inputs read; staged for a person to execute)

```markdown
# Settlement Statement - <plaintiff> - matter <id> - YYYY-MM-DD

**Decision:** assembled from the matter's recorded figures; staged for <responsible attorney> to verify and execute in Smokeball.
**Not done by this skill:** no money moved, no disbursement authorized, no figure computed by the Operator. Smokeball runs the trust accounting and the math.
**Source components:** each figure below is traceable to the read named in its row.

## Breakdown (every figure sourced to a matter read)

| Line                             | Amount        | Read from                            |
| -------------------------------- | ------------- | ------------------------------------ |
| Gross recovery                   | $<amount>     | <settlement task / matter memo>      |
| Less: attorney fee               | ($<amount>)   | `get_fees` (Smokeball AR)            |
| Less: case costs                 | ($<amount>)   | `get_expenses` (Smokeball AR)        |
| Less: lien - <holder> (<status>) | ($<amount>)   | lien task, `list_tasks`              |
| Less: lien - <holder> (<status>) | ($<amount>)   | lien task, `list_tasks`              |
| **Net to <plaintiff>**           | **$<amount>** | arithmetic laydown of the rows above |

**Net note:** the net is the plain sum of the read figures above, shown for a person
to verify and execute in Smokeball. Smokeball's trust accounting is authoritative.

## Trust context (read-only)

> Trust `availableBalance` for the matter: $<amount> (`get_matter_balances`, read-only).
> <"Funds are in trust." | "⚠ availableBalance is below the gross; funds may not be in trust yet.">

## Gaps / needs a human

<anything missing, unconfirmed, or requiring judgment - surfaced, never guessed. If empty, say "none.">

## Internal log (create_memo body)

> Settlement statement assembled for matter <id> from recorded figures; staged for <attorney> to verify and execute. Net shown is an arithmetic laydown of the read figures; Smokeball runs the math. Gaps: <...>. No funds moved.
```

## Shape B - Cannot finalize the net (a core figure is missing or unconfirmed)

```markdown
# ⚠ Settlement Statement - cannot finalize the net - matter <id> - YYYY-MM-DD

**Situation:** <which figure is missing or unconfirmed - e.g. no recorded gross; the Medi-Cal lien payoff is not confirmed>
**Decision:** surfaced for a person; the net is not produced from partial or invented data. No money moved.

## Partial breakdown (what was readable)

| Line                             | Amount                                         | Read from      |
| -------------------------------- | ---------------------------------------------- | -------------- |
| Gross recovery                   | $<amount or "not recorded - GAP">              | <read>         |
| Less: attorney fee               | ($<amount or "GAP">)                           | `get_fees`     |
| Less: case costs                 | ($<amount or "GAP">)                           | `get_expenses` |
| Less: lien - <holder> (<status>) | ($<amount or "payoff not confirmed - GAP">)    | lien task      |
| **Net to <plaintiff>**           | **not computed - one or more inputs is a gap** | -              |

## Gaps to resolve (never filled in by the skill)

<each gap, what read it should come from, and who resolves it>
```

## Shape C - Refuse a fund-movement request (surface and hold)

```markdown
# ⚠ Settlement - fund movement refused - matter <id> - YYYY-MM-DD

**Request received:** <"disburse the net" / "pay the liens" / "cut the check" / "move the funds" - quote the source>
**Decision:** refused. This skill never moves trust money and never authorizes a disbursement. Smokeball plus a person execute the disbursement.
**What it can do instead:** assemble and surface the breakdown (Shape A) or the gaps (Shape B) for a person to execute in Smokeball.
```

## Rules

1. **No figure is authored** - no fee percentage computed, no lien estimated, no gross
   inferred from a trust balance. Every value is a read; a value that cannot be sourced
   is a gap (Shape B), never a fill-in.
2. **The net is an arithmetic laydown of read figures**, labeled for a person to verify
   and execute in Smokeball. The Operator never presents it as authoritative and never
   authorizes a disbursement.
3. **A fund-movement request is Shape C** - refused and surfaced, never performed. The
   trust-account write tools are hard-banned.
4. **The artifact is always staged for a person to execute in Smokeball**, never
   executed, sent, or relied on as final.
5. The decision and its reason are always stated, so the assembly is auditable.
