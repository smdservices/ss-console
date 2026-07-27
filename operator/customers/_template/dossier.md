# Engagement Dossier: [Firm Name]

> **Context, never quotable.** Nothing in this file may appear in client-facing output. The dossier primes judgment, not copy. Sentinel phrases from this file are gated out of correspondence by `tests/forbidden-strings.test.ts`; when you add a new sensitive shorthand here, add its sentinel there in the same PR.

**What this file is.** The single place an agent loads before touching this engagement: who the humans are, why the commercial terms are what they are, which documents the engagement answers to, and what the Captain knows that the repo otherwise would not. The read gate (`.claude/hooks/engagement-guard.mjs`, Law 2 of `docs/doctrine/agent-operating-doctrine.md`) blocks engagement writes until this file has been read this session.

**Maintenance contract.** New correspondence, a new decision, or a new fact stated by the Captain updates this file in the same session. A dossier that lags its engagement is the failure it exists to prevent.

## Relationship map

| Person | Role                         | How the Captain knows them | Posture notes                           |
| ------ | ---------------------------- | -------------------------- | --------------------------------------- |
| [Name] | [Principal / decision-maker] | [relationship]             | [what moves them, what to never do]     |
| [Name] | [Operational contact]        | [relationship]             | [champion? skeptic? spine of the firm?] |

**Engagement posture:** [one paragraph: what kind of deal this is, what the real risk is (persuasion? a slip? scope?), and what the Captain has said about how to play it, dated.]

## Commercial rationale

| Term          | Value        | Why (source, dated)                |
| ------------- | ------------ | ---------------------------------- |
| Monthly       | [$]          | [ADR / statement from the Captain] |
| Stand-up      | [$ / waived] | [rationale and its source]         |
| Billing start | [trigger]    | [source]                           |
| Termination   | [terms]      | [source]                           |

**Pricing-presentation posture:** [how the Captain wants the number framed to THIS client, dated. If not yet stated: TBD, ask before drafting pricing copy.]

## Firm research

[Pre-meeting research: firm profile (size, offices, practice areas), systems stack with tiers, buying process, who signs. Bracketed fields are pre-meeting blockers. Public-record citations only; no privileged material (see README).]

## Canonical documents

[Which files this engagement answers to and their status. Mirror the correspondence README's canonical-vs-stale ledger; name the proposal the build is measured against, the scope-defining inbound letters, and the active plan. Point, do not duplicate.]

## Recorded absences

[Things verified NOT to exist, so nobody reconstructs them from vibes: "X was never put in writing", "no signed Y exists". Date each entry. An absence recorded here is a fact; an absence assumed is an invention.]

## Captain-only facts

[Dated entries of things the Captain has said that live nowhere else in the repo. Each entry: date, the fact, and the conversation it came from. These are the facts whose absence caused the 2026-07-26 incident.]
