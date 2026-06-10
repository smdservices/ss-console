---
title: External-Send Identity (Retired)
date: 2026-05-20
status: superseded
superseded-by: 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0035-no-imposed-entitlement-defaults.md
captain: Scott Durgan
related-issue: https://github.com/venturecrane/ss-console/issues/828
---

# ADR 0005 — External-Send Identity (Retired)

**Status:** Retired. The question this ADR once answered — under whose identity an
outbound message ships — is no longer a standalone architectural commitment. It is
subsumed by the configurable entitlement model.

External send is **one action class among several** (alongside read/exposure,
initiation, commitment, destructive, tool access). Like every gate, it is authored
per engagement and enforced in code: fail-closed unless authored, and a vertical
pack may pin it to draft as a non-raisable compliance constraint where regulation
requires a human signer. The disclosure and liability rationale that once justified
a blanket rule — ABA Formal Opinion 512, state AI-disclosure rules — now lives in
[ADR 0035](./0035-no-imposed-entitlement-defaults.md) as the reason an engagement
would author that pin. There is no default posture, and this gate holds no special
status over any other.

See [ADR 0025](./0025-autonomy-ceilings-configurable-exposure-vs-initiation.md)
(entitlement is configurable per action class) and
[ADR 0035](./0035-no-imposed-entitlement-defaults.md) (no imposed defaults;
fail-closed when unauthored).

## References

- [Issue #828](https://github.com/venturecrane/ss-console/issues/828)
