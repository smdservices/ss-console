# Data Handling & Privilege — the answer a litigator will ask for

The Operator reads a firm's matter documents. A litigator's first question — correctly — is _where does that content go, and does using it waive privilege or breach confidentiality?_ This is the meeting-ready answer, grounded in the actual architecture (not marketing), and the posture the law pack is built to hold. It is also the four-pillar reassurance for ABA Formal Opinion 512 and Model Rules 1.6 / 5.1 / 5.3.

## The one-paragraph answer

> Your firm's Operator runs on its **own dedicated machine** — your data is not pooled with any other firm's, and nothing you give it trains any model. When it reads a matter's documents, that content is used to produce an **internal, cited review for your attorney and nothing else**: it is never sent outside the firm, never shown to another client's instance, and never used as training data. Every action it takes is **logged in an audit trail you can read**, so the supervision your bar rules require is provable, not hoped for. And on anything that is work product or leaves the firm, the Operator **drafts for a human to send — it never acts on its own**. Isolation, no-training, audited, human-in-the-loop: those four are the architecture, not a promise.

## The four pillars (what each one actually means)

1. **Isolation (Model Rule 1.6 / confidentiality).** Each client's Operator is a **per-customer machine** with per-customer memory and storage (ADR 0007). There is no shared multi-tenant pool; one firm's matter content cannot surface inside another's instance. The firm's documents, memory, and audit ledger live in the firm's own instance.

2. **No training on client data.** Client content is used to do the firm's work, not to improve any model. Model access is under no-training, zero-retention-oriented terms — the specific control most relevant to the privilege-waiver question, because the third-party-disclosure theory of waiver attaches to consumer tools that retain and train on inputs, and is what this posture is designed to avoid. _(Confirm the current relay/retention deployment state before representing specifics to a client; the design commitment is no-training.)_

3. **Audited (Model Rules 5.1 / 5.3 supervision).** Every Operator action — including document reads and the memos it writes — is recorded in a **tamper-resistant audit ledger** the firm can read (the broker-owned ledger; the agent cannot rewrite its own log). A supervising attorney can reconstruct what the Operator did, which is exactly the supervision that manual monitoring of a fast tool cannot provide.

4. **Human-in-the-loop / never-drafts.** Document review **surfaces and highlights; it never drafts work product** (`matter-document-review`, content-ceiling: surface-only). Anything client-, opposing-, or tribunal-bound ships as a **draft under a human's identity** (the external-send draft floor, ADR 0005). The lawyer's judgment is never delegated to the machine — the principal's own rule, made architectural.

## On privilege specifically

Because document content stays inside the firm's isolated instance, is not disclosed to a third party, and is not retained for training, the **third-party-disclosure theory of waiver does not attach** the way it does to a consumer AI tool with retention/training terms. The Operator functions as **supervised nonlawyer assistance under the lawyer's direction** — the posture courts and bar guidance treat most favorably (Rule 5.3; ABA Op. 512). Document content used for a review never leaves the firm's surfaces and never reaches any other party.

## The honest edges (say these too)

- **Multi-user ethical walls** (one user not seeing another's walled matter) are a genuinely hard, still-maturing problem industry-wide. The design inherits the firm's own access boundaries and is fail-closed; for a pilot we scope the document work to the principal first rather than testing intra-firm walls on day one.
- **Confirm-before-claiming.** Where a specific control's deployment state matters to a client representation (retention terms, relay), confirm the live state before stating specifics — never overclaim a control's deployment. The four pillars are the design; representations to a client must match what is actually running.
