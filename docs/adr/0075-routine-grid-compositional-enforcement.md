# ADR 0075: Routine-grid enforcement is compositional — typed outbound roster, client/vendor send classes, commitment contract tests

- **Status:** Accepted (2026-07-13)
- **Decider:** Captain (plan approved this date)
- **Builds on:** ADR 0072 (recipient-aware proactive send), ADR 0073 (external-send floor removed), ADR 0071 (`confirm` ceiling), ADR 0031 (content-sensitivity floor), ADR 0035 (no imposed defaults, fail-closed)
- **Client commitment implemented:** `operator/customers/ashton-price/correspondence/07_2026-07-09_scott-to-christa_responses-and-routine-matrix.md`

## Context

The 2026-07-09 letter to Ashton & Price commits to a per-routine three-tier dial (auto-handle / prepare-and-route / flag-only) across 19 litigation routines, with permanent caps: nothing touching a deadline or money auto-handles; sends to opposing counsel or the court always take a person's send and never graduate; court-bound work product stays prepare-and-route; and two graduatable outside sends (the client-verification chase to the firm's own client, the records chase to the firm's records vendor) that the firm may raise to auto-handle with a one-line change.

The natural reading — a per-routine ceiling table the trust gate consults — is **unenforceable on this substrate**. The gate's only blocking hook (`pre_tool_call`) receives `tool_name, args, task_id, session_id, tool_call_id`; no Hermes hook carries an active-skill identifier, skills are prompt context rather than sandboxed execution units, and an agent-supplied skill name cannot be trusted as an entitlement input (the same forgery concern that strips `_current_turn_approval` from tool args). A prior per-skill `trust_ceiling` scalar was retired precisely because nothing enforced it. We do not modify Hermes core (ADR 0015).

## Decision

**The routine grid compiles to dimensions the gate already enforces trustworthily.** The grid remains the firm-facing organizing surface (verbatim in `operator/customers/<slug>/routine-grid.yaml`); each row's tier and caps are realized by composing:

| Grid tier / cap                                 | Enforcement composition                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| flag-only                                       | skill contract: reads + internal writes only, no draft/send tool (authored discipline within the persona, verified by audit-journal observation — see Honesty below) |
| prepare-and-route (work product)                | person-invoked `initiation` + `internal_write`                                                                                                                       |
| prepare-and-route (outside send)                | recipient-class ceiling `draft_for_review`                                                                                                                           |
| auto-handle graduation (client / vendor)        | `external_send_client` / `external_send_vendor` ceiling flipped to `autonomous` (one authored line)                                                                  |
| money / deadline never auto                     | content-sensitivity floor (ADR 0031, extended to the typed classes) + banned `payments_*` / trust-write tools + read-not-compute skill contracts                     |
| opposing counsel / court always a person's send | structural: no roster class exists for them (see below) + the commitments contract pins `external_send` below autonomous                                             |
| no e-filing                                     | no e-file tool is mapped; unmapped tools are refused fail-closed                                                                                                     |

**The recipient axis is enriched** (overlay #156 / ss #1856, following ADR 0072's `external_send_internal` precedent exactly):

- `RecipientClass` gains `CLIENT` and `VENDOR`; `ActionClass` gains `EXTERNAL_SEND_CLIENT` / `EXTERNAL_SEND_VENDOR`, each with its own authored ceiling in `personas[].entitlements.exposure`.
- A new human-authored `scope.outbound_roster` maps exact addresses or `@domain` grants to a **closed class vocabulary: `client` | `records_vendor`**. Validators (both repos) reject duplicates across roster classes and against `inbound_allow_from`, and reject whole-`@domain` grants at public-mail providers while allowing exact consumer addresses (a PI client on gmail is rosterable; all of gmail is not).
- Mixed-recipient sends resolve by a homogeneity rule: any UNKNOWN wins, then any OUTSIDE; internal CCs ride along under the counterparty class; a client+vendor mix resolves to OUTSIDE (draft). No ceiling shopping.
- The taint gate, content-sensitivity floor, and voice live-gate all cover the new classes. Only `external_send_internal` remains floor-exempt (deliberate, ADR 0072).
- **Voice-gate decision:** an autonomous client- or vendor-bound send requires the voice transform when a voice binding exists, exactly like an outside send. pilot-smokeball has no voice binding (gate silent there); the A&P go-live checklist carries a voice-binding parity probe so graduation cannot silently degrade to drafts at production.

**Permanence is structural at the class level, procedural at the identity level — stated honestly.** Opposing counsel and the court are deliberately NOT roster classes; an autonomous outside send requires rostering, and the validator vocabulary offers no class that could ever roster them, so "never graduates" has no configuration path. What remains procedural: nothing mechanical distinguishes an opposing-counsel firm domain from a client business domain, so mis-rostering is prevented by review, not code. The per-customer **commitments contract test** (`operator/customers/<slug>/commitments.json` + `tests/customer-commitments.test.ts`) makes that review mechanical-adjacent: it pins the exact roster entries (any roster change fails CI without a same-PR commitments bump), pins `external_send` below autonomous on A&P-lineage seats, pins grid-to-config value traceability, and rejects any `PLACEHOLDER` marker under `operator/customers/ashton-price/` so the client's unanswered numbers (verification escalation count, treatment-gap days) are a hard go-live gate.

**No vertical floor returns.** ADR 0073 stands: outside-send is the firm's authored dial. The cap on this engagement is the firm's own authored posture plus the commitments contract, not a vertical-wide pin.

## Honesty boundaries (what this does NOT claim)

1. **flag-only is not a gate.** Within one persona, a flag-only routine's session has the same tool surface as any other; separation is authored skill discipline verified by detective controls (audit-journal tripwire: zero draft/send tool calls in those runs). If drift is ever observed, the named hardening path is persona-partitioned tiers (flag-only crons under a persona whose exposure authors no send classes — persona is a native Hermes profile, ADR 0011, resolved from trusted env).
2. **Graduation covers proactive sends only.** The reply relay (ADR 0055) still auto-relays only to `inbound_allow_from`; a rostered client's in-thread reply is held. Chase skills therefore pin proactive `send_message` and never `reply_to_message`. Extending the reply relay to roster classes is a follow-on decision, not an accident to back into by dumping clients into `inbound_allow_from`.
3. **Taint starvation is designed around, not wished away.** Fenced reads (message bodies, document text) taint the session and forfeit that turn's autonomous send. Chase skills pin their state checks to matter-metadata reads (signature detection via `get_files_on_matter`), recorded per grid row.
4. **Tool-level narrowings of the letter are recorded in the grid rows**, not hidden: `create_matter` stays commitment-gated even at auto-handle; the Smokeball e-sign leg of client verification is human-sent (graduation covers the chase emails).

## ADR 0073 proof supersession

The `*/17` proof cadence (ss #1854) awaited an in-gateway autonomous **outside** send. Under the grid posture the commitments contract forbids authoring `external_send: autonomous` on this seat, so that exact proof is unprovable here by design. The mechanism it targeted — an authored autonomous send actually SENDS through the gateway's clean-trust scheduled path — is proven instead through `external_send_client` / `external_send_vendor`, which run the identical ceiling semantics in the identical enforcement path (probes 3, 6, and 15 of the verification ladder). The proof cron is removed with this ADR; the production weekly slot stands.

## Consequences

- A&P go-live inherits `routine-grid.yaml` + `commitments.json` + the probe ladder; Christa's two numbers and the grid-delta review swap the placeholders (config-only).
- Follow-ons filed rather than silently absorbed: reply-relay roster-class extension; zero-delta wake suppression (gated on verifying Smokeball's `updated_since` wire format at connect, per `pre_run_gate.py`); the smokeball-surface.md dependency-map row for the deadline skill's new confirm-gated memo write.
- Every future vertical inherits the pattern: grid as client surface, composition as enforcement, commitments contract as the review gate.
