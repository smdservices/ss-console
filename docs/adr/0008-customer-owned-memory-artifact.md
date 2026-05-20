---
title: Customer-Owned Memory Artifact — Voice Samples, Rules, Draft History in Customer-Specific R2/Vectorize Namespaces, Portable on Offboarding
date: 2026-05-20
status: accepted
captain: Scott Durgan
supersedes: none
related-prd: docs/pm/ai-employee/platform-prd.md §10, §13.3, §3 (P3, P9)
related-issue: https://github.com/venturecrane/ss-console/issues/828
---

# ADR 0008 — Customer-Owned Memory Artifact

**Status:** Accepted (Captain decision; embedded in the AI Employee PRDs since first draft; recorded here as a standalone ADR per [#828](https://github.com/venturecrane/ss-console/issues/828)).

**Source:** Platform PRD principles P3 ("Memory is the customer's, readable and editable") and P9 ("No lock-in. Exit is easy by design"). Architecture §10 (Memory Model & Learning Loop) is the implementation; this ADR captures the data-ownership and portability rationale.

---

## Context

The AI Employee gets better at the customer's business over time. It accumulates:

- Hard rules the customer set ("we don't take medmal under $1M," "always CC paralegal Sarah on new intake")
- Person-mappings (who's who at the firm, key counterparties)
- Process knowledge (how the firm handles common workflows)
- Voice samples (real sent communications that anchor the agent's writing)
- Past corrections (draft-vs-sent diffs the agent learned from)
- An immutable audit log

Per PRD §10, this is the single most differentiated product surface. The trust mechanism is that the customer can read it, edit it, and delete from it. The product is a relationship, not a query.

The architectural questions this ADR resolves:

1. Where does this data live?
2. Who owns it legally and operationally?
3. What happens to it when the customer offboards?

Three patterns were available:

1. **Platform-owned memory in a shared store.** Memory lives in SMD's general-purpose database. SMD owns it; customer access is granted via the dashboard. Offboarding deletes the records.
2. **Platform-owned memory in customer-scoped tables.** Same as above but with logical partitioning. Offboarding still deletes; the customer's data was never separable.
3. **Customer-owned memory in per-customer namespaces.** Memory lives in storage bound to the customer's Machine (D1, R2, Vectorize). The customer's contract grants them ownership of every artifact in their namespace. Offboarding produces a portable export and then deletes the source.

Patterns 1 and 2 contradict the platform's competitive positioning. Per PRD §9 (Exit is easy by design): "the selling line is 'month to month; if it stops being worth what it costs, leaving is easy.'" That is a contractual promise; it must be backed by an architectural fact.

Pattern 3 makes the promise architectural. The customer's memory artifact is theirs by design, not by SMD's continued goodwill.

## Decision

**Customer memory lives in customer-specific D1, R2, and Vectorize namespaces bound to the customer's Hermes Machine. The customer owns the artifact contractually and operationally. The platform supports portable export and verifiable deletion on offboarding.**

The structure (per PRD §7.6 and §10.1):

| Layer | What it holds | Storage |
| --- | --- | --- |
| Hard rules | Customer-set constraints | D1 (per-customer namespace), structured rows |
| Person-mappings | Customer's firm + counterparty directory | D1 (per-customer), structured rows |
| Process knowledge | How the firm handles workflows | R2 (per-customer), markdown vault |
| Voice samples | Real sent examples | R2 (per-customer) + Vectorize-indexed |
| Past corrections | Draft-vs-sent deltas (structural-diff only per PRD §10.4) | R2 (per-customer) + Vectorize-indexed |
| Audit log | Immutable record of every agent action | D1 (per-customer), append-only rows |

Per ADR 0007 (Per-customer Machine isolation), each customer's bindings are scoped to that customer's Machine. No cross-customer query path exists.

Contractually, the customer owns:

- Every memory rule they authored or that the agent learned from their edits
- Every voice sample they uploaded
- The audit log of their agent's actions
- Drafts the agent produced and the customer reviewed (sent or not)

Operationally, the customer can:

- **Read.** Memory is exposed in the Memory tab (PRD §10.3) as a human-readable, versioned artifact.
- **Edit.** Hard rules editable directly. Voice samples deletable. Person-mappings editable.
- **Delete.** Removed items are removed from memory immediately; the audit log retains the deletion event but not the content.
- **Export.** On request, the customer receives a portable export package: D1 rows as JSON, R2 markdown as a tarball, audit log as append-only JSONL, voice samples as their original sanitized form. Exports include a manifest with cryptographic hashes for integrity verification.
- **Demand deletion.** On offboarding (or earlier), the customer can require deletion. SMD deletes the per-customer namespaces (D1, R2, Vectorize) and confirms deletion in writing. The Machine is decommissioned.

The persona signature, the agent's email identity (AgentMail or equivalent), and the dashboard avatar are not customer-owned in the same sense — they are platform property leased to the customer for the duration of the engagement. On offboarding, the persona identity is released (the customer may take the name; the email address and avatar are platform property and are decommissioned). This boundary is documented in the service contract.

## Consequences

**Positive.**

- The "no lock-in" claim is architecturally backed. The customer's continuation with the platform is a continuation decision, not an extraction problem.
- GDPR / CCPA / state-privacy-law compliance is structurally cleaner. Right-to-export and right-to-erasure map onto operations the platform already performs.
- Customer compliance counsel can satisfy themselves before signing that the firm's data is the firm's data. This is the answer to the "what if SMD goes out of business" question and to the "what if SMD gets subpoenaed" question (SMD has audit-log visibility but the customer holds the substantive content).
- The Memory tab as a trust surface (PRD §10.3) is honest. The customer is not viewing a snapshot they have no power over; they are viewing the live artifact they own.
- Customer-owned memory composes with reviewer-as-sender (ADR 0005), per-customer Machine isolation (ADR 0007), and cross-Machine query prohibition (ADR 0009). The four decisions reinforce each other.

**Negative / accepted.**

- Export tooling has real engineering cost. Per-customer export pipelines for D1, R2, Vectorize with provenance metadata are filed as the portable-export follow-on.
- Deletion verification in distributed storage requires auditable evidence (storage backend acknowledgements, audit-log entries). Filed as the deletion-attestation follow-on.
- Cross-customer learning is impossible from runtime memory. Platform-level patterns must be SMD-curated, source-controlled, and reviewed before merge (per ADR 0009). The institutional learning rate is bounded by SMD's human throughput. We accept this as the price of the customer-ownership claim.
- Customers requesting post-offboarding retention "in case we come back" get a paused state (Machine decommissioned, namespaces archived encrypted, no compute cost) for an explicit period, then hard-delete. Retention period signed off at offboarding.

**Out of scope.**

- Platform-level voice patterns. Author-controlled, source-controlled, never derived from runtime data; not memory in the per-customer sense.
- Dashboard audit log access controls (PRD §11.6 multi-user role model). Customer-ownership does not mean every user sees everything.
- AgentMail / persona email identity. The address itself is platform property; signature, avatar, and name selection are customer-chosen configurations.

## References

- Platform PRD principle P3 (`docs/pm/ai-employee/platform-prd.md` §3)
- Platform PRD principle P9 (Exit is easy by design)
- Platform PRD §10 Memory Model & Learning Loop
- Platform PRD §10.3 The Memory tab (the trust mechanism)
- Platform PRD §10.4 Mechanics: how the agent knows what got sent (sent-folder watching opt-in posture)
- Platform PRD §10.5 Memory isolation
- Platform PRD §13.3 Privacy and data handling
- [ADR 0007 Per-customer Machine isolation](./0007-per-customer-machine-isolation.md)
- [ADR 0009 Cross-Machine query prohibition](./0009-cross-machine-query-prohibition.md)
- [Issue #828](https://github.com/venturecrane/ss-console/issues/828)
