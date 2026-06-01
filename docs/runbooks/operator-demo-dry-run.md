# Operator demo dry-run rehearsal script

**Audience:** Captain.
**Scope:** Captain's pre-meeting solo rehearsal of the live Operator demo flow. Run end-to-end against the same Hermes Machine that will be on screen during the customer meeting. Not a substitute for [`docs/runbooks/pi-firm-demo-prep.md`](./pi-firm-demo-prep.md) (the 24-48 hour pre-provisioning runbook); this runbook picks up _after_ `prepare-demo-firm.sh` exits 0, in the window where Captain walks the demo end-to-end alone before the partner sees it.
**Source:** law-firm-prd.md §11 (Walk-In-Cold Demo Strategy); pi-firm-demo-prep.md §7 (pre-meeting walk-through); issue [#889](https://github.com/venturecrane/ss-console/issues/889).
**Companion runbooks:** [`pi-firm-demo-prep.md`](./pi-firm-demo-prep.md) (#819) for the 24-48 hour pre-provisioning. [`operator-customer-onboarding.md`](./operator-customer-onboarding.md) for what happens after the meeting closes signed.

> **What this runbook is.** A scene-by-scene script Captain reads at the Hermes Machine the morning of the meeting (or the night before). Names each scene, names what is on screen, names the expected partner reaction, names the failure recovery, captures what happened after the meeting. Run it twice if the meeting carries unusual stakes.

> **What this runbook is not.** The customer-facing pitch. The demo _script_ is the substrate; this runbook is the _rehearsal_. The partner never reads any of the text below.

---

## When to run this rehearsal

| Trigger                                      | When                                          |
| -------------------------------------------- | --------------------------------------------- |
| First customer meeting for a new firm        | Twice: 24 hours before, and 60 minutes before |
| Repeat meeting with a previously-demoed firm | Once, 60 minutes before                       |
| Demo flow itself has changed since last run  | Twice, regardless of meeting history          |
| Captain is rusty (>30 days since last demo)  | Twice, regardless of meeting type             |

If `prepare-demo-firm.sh --firm-slug {slug}` did not exit 0 within the last 24 hours, stop and re-run it before starting the rehearsal. Do not rehearse against a yellow readiness report; the per-scene failure recovery below covers in-meeting surprises, not known-broken state.

---

## Pre-meeting checklist (T - 60 minutes)

Run through this at the Hermes Machine that will be on screen during the meeting. Every item is verifiable in under 5 minutes. The full list takes 20-30 minutes start to finish.

### Auth and connector state

- [ ] `prepare-demo-firm.sh --firm-slug {firm-slug}` exits 0. (Re-run from [pi-firm-demo-prep.md §6](./pi-firm-demo-prep.md#section-6-run-the-readiness-checks).)
- [ ] Filevine OAuth: open the matter list in the dashboard. The fixture matters render. If Filevine OAuth has expired (token rotated, refresh failed per [`docs/specs/operator/oauth-lifecycle.md`](../specs/operator/oauth-lifecycle.md)), the matter list shows the empty-state stub per [`docs/style/empty-state-pattern.md`](../style/empty-state-pattern.md) and Captain has 60 minutes to re-auth or pivot to the synthetic-adapter no-PM angle (per [pi-firm-demo-prep.md recovery paths](./pi-firm-demo-prep.md#recovery-paths)).
- [ ] AgentMail per-persona inbox is reachable. The internal-comms surface renders the persona's display name correctly. (AgentMail is internal-facing only per platform-prd.md §7.8; external sends route through reviewer identity per ADR 0005 and issue [#870](https://github.com/venturecrane/ss-console/issues/870).)
- [ ] DocuSign / SignWell signing-page status is queryable. The "signing-page-stalled" fixture (per law-firm-prd.md §11.2 pre-loaded scenario set) shows as stalled-5-days.
- [ ] Composio gateway reachable. The dashboard does not surface a connector-error banner.
- [ ] Anthropic API budget under the per-customer-per-day cap. (Hard caps enforced in code per [operator-pricing-2026-05-13.md](../strategy/operator-pricing-2026-05-13.md) risk: "Token spend escalation under bad agent loops.")

### Fixture state

- [ ] Demo fixtures loaded. If issue [#890](https://github.com/venturecrane/ss-console/issues/890) (demo-fixture loader) has shipped, run `ai-employee/bin/load-demo-fixtures.sh {firm-slug} law-firm`. If #890 is still open, hand-seed per [pi-firm-demo-prep.md §6](./pi-firm-demo-prep.md#section-6-run-the-readiness-checks) `06_synthetic_matter` check.
- [ ] At least one fresh draft is in the queue, authored by the persona, within the last 4 hours. The draft references a real fixture matter. (If no fresh draft exists, the demo opens cold and Scene 2 has no draft to show; pause and trigger a fixture-driven draft generation before continuing.)
- [ ] The "What Marcus used to write this" sourcing block (per issue [#807](https://github.com/venturecrane/ss-console/issues/807)) renders on the chosen demo draft. Open the draft detail view and confirm at least one matter record, one memory rule, and one voice sample line in the block.
- [ ] Voice gate state is Pass or Near-pass (per [`docs/specs/operator/voice-gate-fallback.md`](../specs/operator/voice-gate-fallback.md)). If Fail, the Approve & Send affordance is disabled for external-send skills; the demo loses Scene 4 and Captain must pivot to a structural narration (per the Scene 4 failure recovery below).

### Identity and reviewer setup

- [ ] Reviewer identity for the Approve & Send scene is configured. Per ADR 0005 and issue [#870](https://github.com/venturecrane/ss-console/issues/870), external sends route under the reviewer's email account. For the rehearsal, use a Captain-owned address that lands the test send in an inbox Captain monitors, never the partner's address. Confirm the Sent folder writes to the reviewer's account.
- [ ] The Approve & Send button is visible in the draft detail view. (If invisible, the reviewer identity is unbound; re-bind before continuing.)
- [ ] Audit log is writing. Open the audit tab and confirm the most recent entry timestamps within the last 4 hours, with action types from the d1-schema.md vocabulary (`DRAFT_CREATED`, `DRAFT_APPROVED`, `EXTERNAL_SEND_QUEUED`, etc.).
- [ ] Settings page (trust ceiling controls, voice samples, skill toggles) loads without errors.

### Environment and hygiene

- [ ] Browser tabs unrelated to the demo are closed. Notifications silenced (Slack, Mail, calendar pop-ups). Screen-share mode set up if remote.
- [ ] Hermes Machine running the latest released image; no in-flight deploys.
- [ ] Hostname in the URL bar is `portal.smd.services`, not a localhost or preview build. (A demo run from `localhost:4321` reads as unprofessional and breaks the subdomain-routing illusion.)
- [ ] Captain has the pricing conversation primer open in a separate window or printed: the $5K/mo flat tier, 6-month initial term + 90-day evaluation window, 10 hrs/week support cap, per [operator-pricing-2026-05-13.md](../strategy/operator-pricing-2026-05-13.md) and issue [#794](https://github.com/venturecrane/ss-console/issues/794). Pricing is for the post-demo conversation; the dashboard never shows a price.

When every checkbox is green, proceed to the scene-by-scene walk-through below. If any item is yellow or red, fix it before continuing or defer the meeting per [pi-firm-demo-prep.md recovery paths](./pi-firm-demo-prep.md#recovery-paths). Never demo from a partially-broken state.

---

## Scene-by-scene walk-through

The customer demo runs the partner through eight scenes in roughly 35-45 minutes inside the larger 60-90 minute meeting structure from law-firm-prd.md §11.1. The opener, discovery, catalog browse, and order-taking moments wrap around the scenes; the scenes are the live-product portion.

Each scene below names its **target duration**, **what is on screen**, **expected partner reaction**, **common partner questions and canned answers**, and **failure recovery** if the dashboard or a connector misbehaves mid-scene.

> **Pacing rule.** If a scene runs 50% over its target duration, abbreviate the next scene or skip a sub-step rather than push past the meeting's outer time budget. The order-taking moment (per law-firm-prd.md §11.7) is non-negotiable; everything else flexes.

---

### Scene 1: Operator landing (≈3 minutes)

**Target duration:** 2-3 minutes.

**On screen:** The portal landing surface for Operator. Persona card (Marcus, AI Associate, signature preview, avatar). Configured-for-{firm-name} confirmation. Connector status row (Outlook green, Filevine green or synthetic, DocuSign green). Skill set (4 enabled). Voice gate state badge (Pass or Near-pass).

**Captain narrates:** "This is what your Operator landing looks like. Marcus is configured for {firm-name}, the connectors are green, four skills are running. Today I'll show you what he's doing, what he's drafted, what he used to write it, how you approve and send, where the audit trail lives, and how you control any of it from settings. Then we'll talk about what would change for your firm specifically."

**Expected partner reaction:** Calibration moment. The partner is reading the persona name, the signature, the firm-name confirmation. Expect a quiet 10-second scan. Some partners will say nothing; others will say "okay, that's us." Either is a green signal.

**Common questions and canned answers:**

| Partner question                  | Canned answer                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Who decided on the name Marcus?" | "That's a placeholder. You name your Operator anything you want; it'd live on every draft and the internal inbox display."                                                                                                                                                                                           |
| "Is this our actual data?"        | "No, this is synthetic data shaped like your practice. Real data goes through the onboarding setup after sign, with your supervision and your paralegal in the room."                                                                                                                                                |
| "Is Marcus an AI or a person?"    | "An AI persona. The compliance frame is: Marcus works like Sarah the paralegal would. Drafts internally, you review, you send, you sign. Bar rules under Models 5.1 and 5.3 governing your paralegals govern him. We'll get to the compliance moment around Scene 7." (Per law-firm-prd.md §11.6 compliance script.) |

**Failure recovery:**

- **Landing surface hangs (white screen >10 seconds).** Refresh once. If the second load also hangs, narrate over: "The landing's slow today; let me jump straight to the drafts list." Skip to Scene 2 by typing the drafts URL directly. Note the hang for the post-meeting capture form.
- **Persona card renders empty-state stub.** Means customer.yaml `personas[]` was unpopulated at provision time (per [day-1-onboarding.md](../specs/operator/day-1-onboarding.md) Screen 2 prerequisite). This should have been caught in the pre-meeting checklist; if it surfaces in front of the partner, acknowledge openly: "The persona card isn't rendering; let me show you the drafts list and we'll come back to settings later." Move to Scene 2.
- **Connector status shows red.** Acknowledge openly: "{Connector} is red right now; this is a status I'd want you to see in real operation. Let me show you what Marcus does when a connector goes down later in the audit log." Proceed to Scene 2; cover the red connector as a teaching moment when reaching Scene 6 (audit log).

---

### Scene 2: Drafts list with fresh draft (≈3 minutes)

**Target duration:** 2-3 minutes.

**On screen:** The drafts queue surface (per platform-prd.md §12.1 V1 dashboard surface). Cards listed newest-first. The fresh draft from the pre-meeting checklist sits at the top. Each card shows: matter the draft belongs to, recipient cohort (client / opposing counsel / vendor / internal), short preview line, age, status pill (draft / approved / sent).

**Captain narrates:** "This is the queue. Every draft Marcus produces lands here. He doesn't send anything externally on his own; he drafts, you decide. The freshest draft is at the top. Let me open it."

**Expected partner reaction:** This is where partners orient on volume. They will look at the count, scan the recipients, and form their first opinion on whether the agent is doing recognizable work or generic AI work. The fresh draft must be recognizable as a thing their firm would handle; if it isn't, the credibility hit lasts the rest of the meeting.

**Common questions and canned answers:**

| Partner question                         | Canned answer                                                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "How many drafts a day would we expect?" | "Depends on inbox volume. A PI firm with 80-150 active matters typically generates 5-15 draft suggestions a day for partner review. Routine triage runs higher; partner-level drafts run lower."               |
| "What happens to drafts I don't review?" | "They stay in the queue. Each day's morning digest summarizes pending drafts so nothing rots silently. You can also configure auto-archive at N days; we'd talk through that in the onboarding configuration." |
| "Can we filter or sort?"                 | "Yes; by matter, by recipient cohort, by skill, by age. Let me show you in the settings page." (Defer detailed filter walkthrough to Scene 7.)                                                                 |

**Failure recovery:**

- **Drafts list is empty.** Pre-meeting checklist failed to seed a fresh draft. Acknowledge: "The queue's empty in this fixture; let me show you the draft detail surface against an older draft." Click into the most recent draft regardless of age. Continue Scene 3 from there.
- **Drafts list shows stale drafts only (>24 hours old).** Same pivot as above. Note for post-meeting capture: fixture-refresh discipline failed.
- **A draft card shows a fabrication-filter rejection** (per [`docs/specs/operator/fabrication-filter.md`](../specs/operator/fabrication-filter.md)). This is actually a teaching moment if it appears organically: "Here's an example of what Marcus does when a draft would have invented a fact. He doesn't ship it; he flags it. Let me show you the audit log entry for this later." Continue with a different draft.

---

### Scene 3: Draft detail (voice, sourcing block, "What Marcus used") (≈5 minutes)

**Target duration:** 4-6 minutes. This is the longest scene; this is where the agent earns or loses trust.

**On screen:** Full draft detail view. The draft body in the firm's voice (the calibrated structural-diff per [`docs/specs/operator/voice-ingestion.md`](../specs/operator/voice-ingestion.md)). Recipient identity (named, real-looking). Subject line. Below the body, the "What Marcus used to write this" sourcing block (per issue [#807](https://github.com/venturecrane/ss-console/issues/807)): matter record cited (e.g., Filevine #M-2026-0142 Smith v. Acme Insurance), memory rules invoked, voice samples consulted. To the right or below: the Approve & Send button (visible per ADR 0005 reviewer-identity binding) and Flag for Edit / Reject options.

**Captain narrates:** "Here's the draft body. Notice the voice; this is calibrated against {firm-name}'s published writing. Below that is what we call the sourcing block: every input that fed this draft. The matter record from Filevine, the firm memory rules Marcus invoked, the voice samples he consulted. If your ethics counsel ever asks what Marcus saw before he wrote a draft, this answer is right here. It's expandable, exportable, and lives in the compliance evidence packet."

**Expected partner reaction:** Voice scrutiny first ("does this sound like us?"). Then sourcing-block scrutiny ("how does it know that?"). Some partners read the draft body verbatim and form a yes/no judgment in 30 seconds; others want to expand the sourcing block and ask which memory rule fired. Both are positive engagement; lean in.

**Common questions and canned answers:**

| Partner question                       | Canned answer                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "How did you get our voice?"           | "Public writing from your website; Recent Verdicts narratives, partner-authored posts. Production calibration adds ~30 of your sent emails post-engagement, with your supervision. The blind-test passed at {X}% on the bootstrap voice." (Insert actual gate result from [voice-gate-fallback.md](../specs/operator/voice-gate-fallback.md).) |
| "Where do the memory rules come from?" | "We seed them during onboarding with your firm patterns; case-acceptance criteria, people-mappings, things you've said 'we don't do' or 'we always do.' You and the paralegal author them; Marcus surfaces what fired."                                                                                                                        |
| "Can it cite a case it made up?"       | "No. The citation-refusal substrate is architectural per the v1 platform; Marcus refuses to cite case law. If you ask for a motion citing Smith v. Jones, you get a refusal, not a fabrication. We'll demonstrate this in the adversarial set later." (Per law-firm-prd.md §11.2 set-pieces and §9 citation-refusal substrate.)                |
| "What if it gets a fact wrong?"        | "Two layers. The fabrication filter (#825) catches drafts the system can't ground in evidence; they don't make it to the queue. Anything that does reach the queue, you review before it leaves your account; the reviewer-as-sender architecture means external sends carry your signature, not Marcus's."                                    |

**Failure recovery:**

- **Voice reads off (generic AI tone, not firm voice).** Acknowledge openly: "This draft is closer to platform-default voice than your firm voice. That tells me the bootstrap voice samples were thin; in production calibration with your real outbox, this would tighten significantly. Want me to show you the voice tab and how calibration works?" Pivot to Scene 7 (settings page voice samples panel) early, treat as a teaching moment, defer Scene 4 (Approve & Send) until voice is re-anchored. If voice gate state was Pass and the draft _still_ reads off, write it up for the post-meeting capture form and discuss with the partner whether to defer the demo or proceed against synthetic-only.
- **Sourcing block is empty or missing.** Means the draft was generated against a capability adapter that didn't disclose field-coverage (per platform-prd.md §6 adapter base contract). Acknowledge: "The sourcing block isn't populated on this draft; this is the production behavior we'd never accept. Let me show you a different draft where it does render." Pick another draft from the queue.
- **Fabrication filter flagged the draft mid-scene.** If a card in the queue updates to a flagged state during the scene, narrate it: "This is interesting; the fabrication filter just caught something on this draft. The system pulled it from the queue. We're seeing what Marcus does when he can't ground a claim in evidence. Let me show you the flag detail." This is a positive teaching moment if Captain handles it cleanly.
- **Draft detail surface fails to load.** Refresh once. If it fails twice, narrate: "The detail surface is sluggish; let me describe what would be on screen and we'll come back to it." Walk through the conceptual structure (body, sourcing block, Approve & Send) while attempting a reload in another tab. If the reload succeeds, return to the live surface; if not, write up for the post-meeting capture form and continue to Scene 5 (matter detail), skipping Scene 4 entirely.

---

### Scene 4: Approve & Send under reviewer identity (≈3 minutes)

**Target duration:** 2-3 minutes. This is the trust moment; partners feel reviewer-as-sender architecturally rather than reading about it.

**On screen:** The draft detail view from Scene 3, with the Approve & Send button highlighted. After click: confirmation modal naming the reviewer's email account ("Send as {reviewer-email}? This will appear in your Sent folder."). After confirmation: the queue card status transitions from draft to sent; the audit log surface (visible in a separate panel or below) writes a `DRAFT_APPROVED` and `EXTERNAL_SEND_QUEUED` event with the reviewer identity and a timestamp.

**Captain narrates:** "I'm going to approve and send this draft. Watch where it sends from. Click. The modal confirms it'll send under {reviewer-email}, not under Marcus's identity. I confirm. The status pill flips to sent. Open the reviewer's Sent folder; the message lives there exactly the way it would if {reviewer} had written it. The reviewer-as-sender architecture is non-negotiable; Marcus never holds a send token of his own."

**Expected partner reaction:** This is the moment partners realize the agent is operationally embedded under their authority rather than under its own. The reaction is usually subdued recognition; sometimes a question about how they can revoke. Both are positive.

**Common questions and canned answers:**

| Partner question                                | Canned answer                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "What stops Marcus from sending without me?"    | "Architecture. Marcus has no external-send capability of his own; it's an interface gap, not a setting. The capability contract (Pattern A only at v1) routes every external send through a reviewer's account. There's no toggle to disable; the affordance doesn't exist." (Per [capability-contracts.md](../specs/operator/capability-contracts.md).) |
| "Can a paralegal approve, or only a partner?"   | "Configurable per skill in settings. By default for the law-firm vertical pack, anything client-facing, settlement-touching, or court-bound requires the partner; routine internal coordination can be configured for paralegal-approves. We'll walk through this in Scene 7."                                                                           |
| "What if I approve something I shouldn't have?" | "It's in your Sent folder under your identity; you'd treat it like a regrettable email anyone could send. The audit log captures who approved, when, and what sourcing fed the draft. You'd recall or follow up the way you would with any sent message."                                                                                                |
| "Does Marcus's name appear anywhere external?"  | "No. The compliance frame is internal-supervision, external-opacity. The recipient sees the firm; the firm sees Marcus."                                                                                                                                                                                                                                 |

**Failure recovery:**

- **Reviewer identity unbound (Approve & Send button missing).** Acknowledge: "The reviewer identity isn't bound on this fixture; the Approve & Send affordance hides itself rather than letting an unbound send happen. Let me show you the binding flow in settings, then we'll come back." Pivot to Scene 7 early; show the reviewer-identity panel; then return.
- **Voice gate state is Near-pass or Fail.** Per [voice-gate-fallback.md](../specs/operator/voice-gate-fallback.md), external-send affordances are disabled until the gate returns Pass. If Fail, Approve & Send is hidden entirely. Narrate the structural reason rather than the live click: "On this fixture the voice gate hasn't passed yet, so the system blocks external send by design. Let me describe what the live click would do." Walk through the conceptual flow; defer to a future demo run for the live click.
- **Send queues but never delivers (`EXTERNAL_SEND_QUEUED` written, no Sent-folder confirmation).** AgentMail or the reviewer-identity SMTP path is timing out. Acknowledge: "The send is queued; delivery's lagging. Let me show you where the queued send shows up in the audit log." Pivot to Scene 6 (audit log) early. Write up for post-meeting capture; check AgentMail status before next rehearsal.
- **Modal does not appear after click.** UI regression. Refresh once; if the regression persists, narrate the conceptual flow rather than re-clicking. Don't blind-click multiple times; partners read it as fumbling.

---

### Scene 5: Matter detail with draft in flight (≈3 minutes)

**Target duration:** 2-3 minutes.

**On screen:** The matter detail surface for the matter the Scene 4 draft was attached to. The matter's communication thread (or activity feed) shows the just-sent draft as the most recent entry, with reviewer identity. Other entries from the fixture's history: prior client emails, opposing counsel correspondence, intake notes. To the side: matter metadata (case type, jurisdiction, partner-of-record, status). If Filevine is the bound PM connector, the matter ID matches `M-2026-0142` (or the seeded fixture ID).

**Captain narrates:** "This is the matter detail. The draft we just sent shows up in the communication thread under {reviewer-email}'s identity, exactly the way it would if {reviewer} had sent it directly from Outlook. The matter metadata is pulled from Filevine; the thread is the audit-supported sequence of everything Marcus and the firm have done on this matter."

**Expected partner reaction:** Partners orient on matter coherence. Does the draft fit the matter context? Does the communication thread look like a real matter's communication thread? If both yes, partners move on quickly. If either feels off, expect questions.

**Common questions and canned answers:**

| Partner question                                     | Canned answer                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Does Marcus see every matter?"                      | "Scope is configurable per skill in customer.yaml. The default for the law-firm pack: triage and intake skills see active matters; settlement and litigation-strategy work stays partner-only. We'd lock the scope in your SOW per [#794](https://github.com/venturecrane/ss-console/issues/794)." |
| "How does Marcus know it's the Smith matter?"        | "The skill's input includes the matter ID from the originating email's Filevine thread tag, or from an inbox-rule mapping you configure during onboarding. If a draft's matter inference is uncertain, Marcus surfaces the ambiguity rather than guessing."                                        |
| "Can we filter the matter feed by Marcus's actions?" | "Yes; the audit log filters by skill, by action type, by date range. Let me show you in Scene 6."                                                                                                                                                                                                  |

**Failure recovery:**

- **Matter detail fails to load.** The Filevine adapter timed out or returned an error. If the synthetic adapter is bound (no-PM angle per [pi-firm-demo-prep.md recovery paths](./pi-firm-demo-prep.md#recovery-paths)), the matter detail should render from synthetic fixtures regardless; failure here means the synthetic fixture wasn't seeded properly. Acknowledge: "The matter detail isn't pulling on this fixture; let me show you the audit log directly." Skip to Scene 6.
- **The just-sent draft does not appear in the thread.** AgentMail-to-PM-thread write-back lag. Wait 5 seconds, refresh once. If still absent, narrate: "The thread write-back is lagging; in production this would land within a minute. Let me show you the audit log where the send event is captured." Skip to Scene 6.
- **Wrong matter loads.** Matter ID mismatch between the draft and the fixture matter database. Acknowledge openly, navigate to the correct matter manually, continue.

---

### Scene 6: Audit log (≈4 minutes)

**Target duration:** 3-4 minutes. This is the compliance hook; the audit log is the artifact behind the §11.6 compliance moment.

**On screen:** The audit log surface, default view. Most recent entries at the top: `DRAFT_CREATED`, `DRAFT_APPROVED`, `EXTERNAL_SEND_QUEUED` from Scene 4. Filter chips visible: skill, action type, date range, actor. If a Scene 1-5 connector failure occurred, the corresponding `CONNECTOR_ERROR` or `ADAPTER_HEALTH_DEGRADED` entry is visible too. Expandable rows show metadata (sourcing inputs, actor identity, capability contract used).

**Captain narrates:** "Every action Marcus takes writes here. Every action the firm takes on Marcus writes here. The audit log is append-only and hash-chained per the immutability spec; nothing rewrites history. This is the artifact your ethics counsel asks for. The compliance evidence packet bundles this with the firm's customer.yaml, the safety-substrate boot logs, and a plain-language README. Susan reads it end-to-end without a technical background."

**Expected partner reaction:** Partners who think in compliance terms (most senior partners) light up here. The audit log is the unforgeable answer to "how do you know what it did?" Expect filter-driven questions: "show me everything from the last 24 hours that touched a settlement." Lean in; the filters are the demo.

**Common questions and canned answers:**

| Partner question                              | Canned answer                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "How long do you retain audit logs?"          | "Indefinitely while you're a customer; export-and-purge on decommission per the per-customer decommission spec. Compliance evidence packets are generated on demand and exportable to PDF or structured CSV." (Per [`docs/specs/operator/compliance-evidence-packet.md`](../specs/operator/compliance-evidence-packet.md).)                                          |
| "Can audit log entries be edited or deleted?" | "No. Append-only with hash-chaining per the audit-log-immutability spec; an attempted edit would break the chain and be detectable on the next compliance packet generation. Captain countersigns the hash set on the packet." (Per [audit-log-immutability.md](../specs/operator/audit-log-immutability.md).)                                                       |
| "What if you (SMD) are subpoenaed?"           | "Per the DPA and the customer's customer.yaml isolation invariants, your data lives in your isolated D1 and R2 namespace. A subpoena to SMD is responded to with notice to you and standard outside-counsel coordination; we don't unilaterally release customer data." (Per [r2-vectorize-naming.md](../specs/operator/r2-vectorize-naming.md) isolation contract.) |

**Failure recovery:**

- **Audit log is empty.** Means D1 audit table wasn't seeded by the fixture loader, or the table itself was just created and no events have written. Acknowledge: "The log is empty in this fixture; in production every event in Scenes 1-5 would be visible here. Let me describe a representative entry and we'll move on." Sketch the structure verbally; pivot to Scene 7.
- **Audit log entry from a prior scene's failure is visible.** Treat as a teaching moment, not a failure. "Notice this `CONNECTOR_ERROR` entry from the connector hiccup earlier; this is what the system records when a connector goes down. Captain or a watchdog picks it up; the partner sees a banner on the dashboard. The log captures the recovery action too."
- **Hash-chain verification fails when generating a packet.** Acknowledge briefly: "The packet generator is flagging a verification anomaly on this fixture; in production this would be a P0 incident I'd page myself on. Let me describe the packet structure instead." Skip the live packet generation; describe per [compliance-evidence-packet.md](../specs/operator/compliance-evidence-packet.md).

---

### Scene 7: Settings page (trust ceilings, voice samples, skill toggles) (≈4 minutes)

**Target duration:** 3-5 minutes.

**On screen:** The settings surface for Operator. Sub-tabs: Persona, Voice (samples + gate state + cohort histogram), Skills (4 enabled rows with trust-ceiling controls), Connectors, Reviewers (identity binding), Memory (rules + seed-time provenance), Digest (cadence). For the rehearsal, open Skills first.

**Captain narrates:** "This is where you control everything. Let me start with skills." Click into Skills. "Four skills enabled. Each has a trust ceiling: `draft_for_review`, `autonomous`, or `refused`. Today every external-send skill is at `draft_for_review`; client-touching, settlement-touching, and court-filing work stays here forever by design per the safety invariants. Internal skills like the morning digest can promote to `autonomous` once trust is built. Let me click into one." Open a skill drawer. "Scope config, trust ceiling toggle, operator-may-approve toggle per the dashboard-roles spec."

Then click into Voice. "Voice samples and gate state. The cohort histogram shows which recipient types Marcus is calibrated against. The blind-test gate runs after every batch of new samples; the badge here is the current state."

Then click into Reviewers. "Reviewer identity binding. This is where you authorize an email account for Approve & Send. Multiple reviewers can be bound; each skill can route to a specific reviewer per the SOW configuration."

**Expected partner reaction:** Partners orient on control. The settings page is where they ask "can I turn off X?" The answer is usually yes for behavior, no for safety architecture (citation refusal, reviewer-as-sender, fabrication filter). Distinguish carefully; partners respect honest limits.

**Common questions and canned answers:**

| Partner question                                                  | Canned answer                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Can we add a skill mid-engagement?"                              | "Yes. New skills land via SOW scope expansion; the skill registry is per-customer. Customers requesting beyond the v1 pack get a scope conversation, not a quiet expansion." (Per pricing doc service-contract implications.)                                                                          |
| "Can we change the trust ceiling on a settlement-touching skill?" | "No. Architecturally fixed. Settlement-touching, client-facing, and court-filing skills are locked at `draft_for_review` per the safety invariants. This is not a setting; it's a guarantee. Same logic that blocks Marcus from holding a send token of his own."                                      |
| "Who can change settings?"                                        | "Per the dashboard-roles spec: principal users (partners) can change anything. Operator users (paralegals) can adjust queue and memory, view settings but not promote trust ceilings. Compliance users have read-only audit access." (Per [dashboard-roles.md](../specs/operator/dashboard-roles.md).) |
| "Can we delete voice samples we don't want Marcus to use?"        | "Yes; the voice tab lets you mark samples deprecated. The structural-diff regenerates on the next ingestion run; you see the cohort histogram update."                                                                                                                                                 |

**Failure recovery:**

- **Settings page renders empty for a sub-tab.** Likely the customer.yaml field wasn't populated at provision time. Acknowledge per [day-1-onboarding.md](../specs/operator/day-1-onboarding.md) per-screen gating: "The {sub-tab} is empty on this fixture; in production it'd be populated from your customer.yaml configuration. Let me show you the next sub-tab." Skip to the next working sub-tab.
- **Trust-ceiling toggle clicks but doesn't persist on refresh.** Server-side write failed silently. Acknowledge: "The toggle isn't persisting on this fixture; in production this would be a hard error, not a silent fail. Let me show you Reviewers instead." Pivot. Note for post-meeting capture; surface to the engineering team before next demo.
- **Voice tab shows Fail gate state and Captain hasn't acknowledged it yet in this rehearsal.** Means voice gate state changed since the pre-meeting checklist. Stop the rehearsal; re-run the pre-meeting checklist; if the partner is already in the room and this surfaces live, narrate honestly: "The voice gate just transitioned to Fail; this is the safety substrate refusing to ship external sends until calibration tightens. In production this would page me and pause external sends until I re-calibrated. Let me describe what re-calibration looks like." Refer to [voice-gate-fallback.md](../specs/operator/voice-gate-fallback.md) Path A / Path B disclosure script.

---

### Scene 8: Pricing conversation (≈8 minutes)

**Target duration:** 5-10 minutes. This is the close-adjacent conversation, not a slide. Captain runs it as a conversation; the dashboard stays on whatever was last on screen (typically the audit log or the matter detail; never the settings page, which reads as cluttered).

**On screen:** Whatever was last on screen from Scene 7, ideally the audit log or the matter detail. The dashboard never shows a price; pricing is verbal per the no-dollar-amounts-published rule.

**Captain narrates:** "Let me talk through how this works commercially. The Operator is a single flat tier at {monthly-price-from-pricing-doc}. Six-month initial term for our first five customers with a ninety-day evaluation window; you can exit at day ninety with thirty days notice, no penalty. After day ninety the six-month commitment carries to term. The retainer covers ten hours a week of my time on your account; if you need more than that on a sustained basis, we have a scope conversation, not a quiet expansion. Onboarding is bounded at eighty hours of my time; above that we quote scope expansion at the named rate. The trust ceiling for each skill is enumerated in your SOW; we never quietly promote a skill to autonomous outside what's in writing."

Then: "What I want from this meeting is your read; what would be most useful to your firm, what we didn't show that you'd want, what tools you use that we didn't pre-build for, what your ethics counsel would want answered. Per the order-taking moment, this conversation shapes the SOW we'd send next week."

**Expected partner reaction:** Pricing is rarely a surprise at this stage. Partners who got to Scene 7 with engaged questions are signaling buying intent; their reaction here is usually a clarifying question about scope or a "let me think about it." Hard-pass partners typically signal earlier; if they made it through eight scenes engaged and then hard-pass at pricing, the pricing model needs revisiting, not the demo.

**Common partner questions and canned answers:**

| Partner question                                                           | Canned answer                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "What's included in the ten hours a week?"                                 | "Per the support-hours allocation: customer success check-in, skill iteration and customization, incident response, reporting and dashboard maintenance, vendor coordination, and ad-hoc escalations. Detail breakdown is in the SOW." (Per [pricing doc support-labor model](../strategy/operator-pricing-2026-05-13.md#support-labor-model).) |
| "What happens if we want to add a skill outside the v1 pack?"              | "We quote it as a scope expansion. New skill builds run roughly two to six weeks depending on complexity and connector availability; pricing is the named rate. We'd write it into a SOW amendment, not a quiet add."                                                                                                                           |
| "Can we go month-to-month?"                                                | "Not for the standard SKU; the six-month initial term and ninety-day evaluation window is the structure. The reasoning's transparent: customer success engineering is heavy in the first ninety days, and we make that investment in good faith because the term commits both directions."                                                      |
| "What if the Operator isn't producing value at day ninety?"                | "You exit clean. Thirty-day notice, no penalty, no balance-of-contract payment. The evaluation window is the explicit place that decision happens; we want it to be a real choice, not a stuck-in-a-bad-fit problem."                                                                                                                           |
| "What if we want to bring an Operator for a different vertical (not law)?" | "Each vertical pack is a separate engagement at the same flat tier; you'd have two Operators, two retainers, two customer.yaml configurations. We'd discuss whether vertical-pack overlap (e.g., compliance, audit) lets one persona serve multiple business areas, but the default is one persona per vertical."                               |

**Failure recovery:**

- **Pricing doc is mid-revision.** If the launch pricing has been revised since this runbook was last touched, fall back to the most recent [operator-pricing-2026-05-13.md](../strategy/operator-pricing-2026-05-13.md) state on main; do not quote a number that isn't in the source document. Pricing is the one place fabrication is unforgivable.
- **Partner asks for a number not in the pricing doc** (e.g., "what would a custom three-vertical engagement cost?"). Honest deferral: "That's outside our productized SKU; we'd quote it as a custom scope. I'd want to take the conversation back to my team and come back with a scoped number rather than guess in the meeting." Note the question for follow-up.
- **Partner hard-asks for month-to-month or a discounted first month.** Hold the line per [pricing-doc revision triggers](../strategy/operator-pricing-2026-05-13.md#revision-triggers); document the request, do not concede live. The price-value equation is what we revise across customers, not what we negotiate in a single meeting.

---

## After the demo flow

The pricing conversation transitions naturally into the order-taking moment from law-firm-prd.md §11.7. That portion of the meeting is conversational, not scripted; Captain takes the order rather than pitching. The questions to ask are enumerated in §11.7 and not duplicated here.

When the meeting closes:

- If the partner signaled interested: send the engagement letter draft within 24 hours per [`docs/runbooks/operator-customer-onboarding.md`](./operator-customer-onboarding.md) §0.
- If the partner signaled lukewarm: send a brief follow-up within 48 hours with a 12-minute video walkthrough link (per [day-1-onboarding.md](../specs/operator/day-1-onboarding.md) Captain-led path); leave the door open without re-pitching.
- If the partner signaled hard pass: thank them, ask if you may follow up in six months, capture the conversation in the post-meeting form below.

Per [pi-firm-demo-prep.md decommissioning section](./pi-firm-demo-prep.md#decommissioning-a-demo-firm-that-did-not-convert), demo firms that don't convert within the agreed window are decommissioned via `decommission-customer.sh`. The dossier is preserved in the tombstone for future re-engagement.

---

## Post-meeting capture form

Captain fills this in within 24 hours of the meeting closing. Structured so a follow-on engagement (a fix, a re-rehearsal, a different opening, a different pricing position) can be triggered from the data.

> Save the completed form to `ai-employee/customers/{firm-slug}/demo-debrief-{YYYY-MM-DD}.md`. The customer directory persists in the dossier per [pi-firm-demo-prep.md](./pi-firm-demo-prep.md) and survives the decommission tombstone.

### Section A: Meeting metadata

- Firm: {firm-name}
- Slug: {firm-slug}
- Date / time: {YYYY-MM-DD HH:MM}
- Duration: {actual minutes} (target 60-90 per law-firm-prd.md §11.1)
- Attendees on firm side: {names + roles}
- Attendees on SMD side: Captain {+ any}
- Format: in-person / video / phone
- Meeting #: 1st / 2nd / 3rd+ for this firm

### Section B: What worked

Free-text. Specific scenes that landed; specific partner reactions that signaled positive engagement; specific canned answers that resonated; specific moments where the substrate (citation refusal, sourcing block, audit log, reviewer-as-sender) earned trust.

### Section C: What didn't work

Free-text. Specific scenes that ran long or short; specific partner questions Captain didn't have a clean answer for; specific dashboard surfaces that misbehaved; specific moments where Captain felt the room cool. Be specific; "Scene 3 didn't land" is less useful than "Scene 3 voice read off; partner remarked it sounded generic; I pivoted to the structural narration."

### Section D: Per-scene customer reactions

For each scene, capture one line:

| Scene                                   | Reaction code        | Note                   |
| --------------------------------------- | -------------------- | ---------------------- |
| Scene 1 (Landing)                       | green / yellow / red | {one-line description} |
| Scene 2 (Drafts list)                   | green / yellow / red | {one-line description} |
| Scene 3 (Draft detail / sourcing block) | green / yellow / red | {one-line description} |
| Scene 4 (Approve & Send)                | green / yellow / red | {one-line description} |
| Scene 5 (Matter detail)                 | green / yellow / red | {one-line description} |
| Scene 6 (Audit log)                     | green / yellow / red | {one-line description} |
| Scene 7 (Settings)                      | green / yellow / red | {one-line description} |
| Scene 8 (Pricing)                       | green / yellow / red | {one-line description} |

Reaction codes:

- **Green** = partner engaged, asked clarifying questions, signaled positive recognition
- **Yellow** = partner neutral, scanned without reacting, neither positive nor negative signal
- **Red** = partner pushed back, looked skeptical, signaled negative reaction or disengagement

### Section E: Failure recovery invoked

For each in-meeting failure that triggered a per-scene recovery path, capture:

- Scene number
- Failure description (what broke)
- Recovery path used (per the playbook above, or improvised)
- Whether the recovery preserved the demo flow (yes / partial / no)
- Whether the failure is fixed-before-next-demo (yes / no / under investigation)

If no failures: write "No failures."

### Section F: Sign-on signal

Captain's read on partner engagement, captured the same day to preserve calibration:

- **Strong interested**: partner explicitly asked to see the SOW or named a start date or asked who they could refer this to. Send engagement letter within 24 hours.
- **Interested**: partner engaged through Scene 8, asked clarifying questions on pricing or scope, did not commit. Follow up within 48 hours with the video walkthrough.
- **Lukewarm**: partner attentive but not engaged, asked few questions, ended on "let me think about it" without naming a follow-up timing. Follow up at 7 days; if no response at 14 days, defer.
- **Hard pass**: partner signaled "not for us" before Scene 8, declined the SOW conversation, or ended early. Send a thank-you, ask for a six-month re-engagement window, capture the disqualification reason.

### Section G: Next steps

- Action: {what Captain does in the next 24 hours}
- Owner: Captain
- Due: {YYYY-MM-DD}
- If SOW going out: SignWell envelope ID once sent
- If video walkthrough going out: link sent, follow-up date scheduled
- If hard pass: decommission timer started per pi-firm-demo-prep.md decommissioning section

### Section H: Learnings for the runbook itself

Free-text. Anything Captain noticed that would change this runbook for the next rehearsal: a scene that needs a different target duration, a partner question that needs a new canned answer, a failure mode that needs a new recovery path. These get rolled into the next revision of this document.

---

## Cross-references

- [`pi-firm-demo-prep.md`](./pi-firm-demo-prep.md) (#819): 24-48 hour pre-provisioning runbook. This rehearsal runbook starts after `prepare-demo-firm.sh` exits 0.
- [`operator-customer-onboarding.md`](./operator-customer-onboarding.md): what happens after sign.
- [`docs/specs/operator/day-1-onboarding.md`](../specs/operator/day-1-onboarding.md) (#803): Day-1 screen sequence; Captain-led walk-through cadence section.
- [`docs/specs/operator/voice-gate-fallback.md`](../specs/operator/voice-gate-fallback.md): voice gate Pass / Near-pass / Fail behavior referenced in Scenes 3, 4, 7.
- [`docs/specs/operator/capability-contracts.md`](../specs/operator/capability-contracts.md): Pattern A reviewer-as-sender architecture referenced in Scene 4.
- [`docs/specs/operator/audit-log-immutability.md`](../specs/operator/audit-log-immutability.md): hash-chained append-only log referenced in Scene 6.
- [`docs/specs/operator/compliance-evidence-packet.md`](../specs/operator/compliance-evidence-packet.md): packet structure referenced in Scene 6.
- [`docs/specs/operator/dashboard-roles.md`](../specs/operator/dashboard-roles.md): principal / operator / compliance role visibility referenced in Scene 7.
- [`docs/specs/operator/fabrication-filter.md`](../specs/operator/fabrication-filter.md): pre-queue fabrication rejection referenced in Scene 3.
- [`docs/strategy/operator-pricing-2026-05-13.md`](../strategy/operator-pricing-2026-05-13.md) (#794): pricing structure for Scene 8.
- [`docs/pm/operator/law-firm-prd.md`](../pm/operator/law-firm-prd.md) §11: walk-in-cold demo strategy; structure, set-pieces, compliance moment, order-taking moment.
- Issue [#807](https://github.com/venturecrane/ss-console/issues/807): "What Marcus used to write this" sourcing block; referenced in Scene 3.
- Issue [#870](https://github.com/venturecrane/ss-console/issues/870): Approve & Send reviewer-as-sender flow; referenced in Scene 4.
- Issue [#890](https://github.com/venturecrane/ss-console/issues/890): demo-fixture loader; referenced in pre-meeting checklist.
