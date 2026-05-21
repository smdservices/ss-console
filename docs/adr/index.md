---
title: Architecture Decision Records
sidebar:
  order: 0
---

Architecture Decision Records (ADRs) capturing strategic and technical decisions made during the SMD Services platform build.

> **Looking for the substantive decision corpus?** The 43+ numbered go-to-market decisions (buy box, scope, pricing, assessment, distribution, delivery) live in [decision-stack.md](./decision-stack.md). The numbered ADRs below capture narrower architectural choices.

## Files

- [decision-stack.md](./decision-stack.md) - SMD Services Decision Stack - complete reference across all 6 go-to-market layers
- [0001-taxonomy-two-layer-model.md](./0001-taxonomy-two-layer-model.md) - Taxonomy two-layer model (5-cat observation, 6-cat delivery)
- [0002-outside-view-unified-diagnostic.md](./0002-outside-view-unified-diagnostic.md) - Outside View unified diagnostic (**superseded 2026-05-04** — product retired in PR #702 and #703)
- [0003-lead-gen-pivot-actor-identity.md](./0003-lead-gen-pivot-actor-identity.md) - Lead-gen pivot: actor identity, drafting decoupled, statewide, no revenue gate
- [0004-productized-ai-employee-offering.md](./0004-productized-ai-employee-offering.md) - Productized AI Employee offering: flat-rate retainer SKU, second front door, Hermes-leaning stack (supersedes Decision #12)
- [0005-reviewer-as-sender.md](./0005-reviewer-as-sender.md) - Reviewer-as-sender: every customer-bound message ships under the human reviewer's identity (architectural, not configurable)
- [0006-capability-adapter-pattern.md](./0006-capability-adapter-pattern.md) - Capability-adapter pattern: skills bind to abstract capability interfaces; vendor adapters implement them; customer.yaml binds the wiring
- [0007-per-customer-machine-isolation.md](./0007-per-customer-machine-isolation.md) - Per-customer Machine isolation: one Fly.io Machine per customer; multi-tenancy via deployment isolation, not runtime tenancy
- [0008-customer-owned-memory-artifact.md](./0008-customer-owned-memory-artifact.md) - Customer-owned memory artifact: voice samples, rules, draft history in customer-specific R2/Vectorize namespaces; portable on offboarding
- [0009-cross-machine-query-prohibition.md](./0009-cross-machine-query-prohibition.md) - Cross-Machine query prohibition: boot-time storage-binding check + shared-catalog merge gate; no runtime data path between customers
- [0010-per-customer-oauth-token-storage.md](./0010-per-customer-oauth-token-storage.md) - Per-customer OAuth token storage location (Infisical vs. Fly volume)
- [0011-multi-persona-per-customer.md](./0011-multi-persona-per-customer.md) - Multi-persona per customer: schema-locked at v1 (`personas: []` array length=1), runtime deferred to Phase 2
- [0012-customer-yaml-storage.md](./0012-customer-yaml-storage.md) - customer.yaml storage: git as source of truth, portal D1 + per-customer R2 as materialized replicas
