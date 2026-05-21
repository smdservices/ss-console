# AI Employee — Product Component Inventory

**Locked vocabulary:** 10 components. Every backlog item, spec, PR description, and conversation references one of these.

For each component below: **Have** (defined in PRD/spec or built in code, with reference) and **Yet to define/build** (the gap that turns into backlog).

Nothing AI-Employee is on main yet. PR references: #812 (substrate), #813 (PRDs), #829 (Hermes runbook), #831 (specs), #832 (ADRs + corpus).

---

## 1. Agent

The Hermes runtime per-customer Machine. The brains.

**Have:**

- Hermes upstream `NousResearch/hermes-agent v2026.5.7` exists and is bootable (PR #829 runbook)
- Boot path: `bin/provision-customer.sh` (PR #812) — Fly app, volume, secrets, deploy, smoke test
- `bootstrap.sh` runtime init (PR #812)
- Dockerfile + fly.toml templates (PR #812)
- `pause-customer.sh`, `rollback-skill.sh` (PR #812)

**Yet to define/build:**

- AIEmployee adapter wiring — `aie_adapter.register()` is a stub; needs hook into Hermes `agent/tool_guardrails.py` (technical-pm risk #1)
- Per-tool audit emission points
- Sticky-stop mechanism
- Decision: Hermes fork vs upstream PR if seam isn't findable cleanly

---

## 2. Skills

The recipes the agent runs. The customer-value layer.

**Have:**

- 11 skills in PR #812:
  - `inbox-triage` (full SKILL.md, complete)
  - `law-pi-intake-triage`, `law-conflict-check`, `law-client-status-update` (PI-vertical scaffolds)
  - `proposal-drafter`, `ar-chaser`, `scope-creep-flagger`, `asset-collection-follower`, `retainer-hours-reconciler`, `paid-media-anomaly-watcher`, `status-report-assembler` (marketing-agency scaffolds)
- Skill versioning + content-hash pinning (`adapter/resolve_skill_pins.py`)
- Skill validation in `customer.yaml` validator
- Grading matrix at `ai-employee/grading/matrix.md`

**Yet to define/build:**

- 10 currently-scaffolded skills need full authoring (only inbox-triage is complete)
- Demand-letter draft skill (PI core)
- Discovery-response draft skill (PI core)
- Opposing-counsel response skill (PI core)
- Settlement-negotiation prep skill (PI core)
- Skill regression test CI surface (issue #825)
- Inline "teach the agent a new rule" affordance (#810)

---

## 3. Connectors

How the agent reaches the customer's tools.

**Have (built):**

- LawPay (BUILD wrapper, PR #812)
- Clio (BUILD wrapper, PR #812)
- Dotloop (BUILD wrapper, PR #812)
- ShipStation (BUILD wrapper, PR #812)

**Have (config-bound only — wiring not done):**

- Gmail, Google Calendar, Google Drive, QuickBooks, Slack, GitHub, DocuSign (Composio)
- CourtListener (MCP)

**Yet to define/build:**

- MS Graph (Outlook + Calendar + OneDrive) — required for most PI firms (#822)
- Filevine (PI-specific PM)
- Fishbowl, Spark-MLS, Acumatica, Adobe-Sign, SPS-Commerce (named in PRD as future Tier-1 BUILDs)
- Composio per-connection isolation enforcement (cross-customer leakage vector — technical-pm risk #2)
- Connector smoke-test framework operationalized (`run_prod_smoke_test.py` is a scaffold)
- "No PM system" demo configuration (business-analyst — most target firms have no working PM)

---

## 4. Voice

How the agent communicates in the customer's writing style.

**Have:**

- Voice Layer 1 (structural style markers — no em dashes, AI-tell ban, sign-off rules) embedded in skill SKILL.md frontmatter
- inbox-triage skill has explicit voice rules (PR #812)
- Voice doctrine in `CLAUDE.md` (no-em-dash, plainspoken, "we" voice)

**Yet to define/build:**

- Voice Layer 2 — sample-driven draft transformation
- Voice sample ingestion pipeline (from customer's sent folder)
- Per-recipient cohort voice variation
- Voice quality gate / blind-test harness (#823, ≥80% threshold)
- Voice quality gate failure fallback path (#797)
- Voice sample storage schema (lives in Memory)
- Multi-voice handling for multi-user customers (associate vs partner, ux-lead flagged)

---

## 5. Memory

What the agent knows about this customer's business.

**Have:**

- Memory namespace config in customer.yaml (D1, R2 vault path, Vectorize index)
- ADR 0008 customer-owned memory artifact (PR #832)

**Yet to define/build:**

- D1 schema (drafts, audit, voice samples, recipient cohorts, sent-folder cursor) — spec #800
- D1 migrations
- R2 per-customer vault structure — spec #801
- Vectorize per-customer index provisioning — spec #801
- Memory ingestion pipeline (sent folder → samples; matters → vault; documents → embeddings)
- Per-customer namespace isolation enforcement (ADR 0009 is verbal — technical-pm flagged)
- Memory export / portability (offboarding requirement per ADR 0008)
- Memory retention + decommission cleanup

---

## 6. Trust Ceiling

How much autonomy the agent has, per skill. Includes calibration.

**Have:**

- `trust_ceiling.py` enforcement code (PR #812)
- Levels: `autonomous` / `draft_for_review` / `refused`
- Per-skill ceiling in SKILL.md frontmatter
- Per-customer override in customer.yaml
- ADR 0005 reviewer-as-sender (PR #832)
- 5 base safety invariants implemented (#1-#5)
- Citation filter in safety-substrate (PR #812)

**Yet to define/build:**

- Adapter wiring so trust ceiling actually intercepts tool calls (depends on Agent #1 work)
- Trust ceiling decision logging (every allow/draft/refuse with reason)
- Invariants #6, #7, #8 (3 of 8 still spec-only per #796)
- Fabrication-discipline runtime pre-output filter (#798)
- Refusal handling — what happens when refused (error / silent / escalation)
- Calibration session workflow (PRD §11.9 — business-analyst flagged calibration fatigue: 4-6hr → 4×90min sessions)
- Trust ceiling promotion mechanism (#811)
- "Teach Marcus" inline rule-add affordance (#810)

---

## 7. Dashboard

The human interface — configure + monitor + interact.

**Have:**

- Three-subdomain architecture in CLAUDE.md (smd.services, admin.smd.services, portal.smd.services)
- Existing portal infrastructure on Astro/Cloudflare Workers + D1

**Yet to define/build:**

- Astro routing for AI Employee surface (under portal subdomain or per-customer subdomain)
- Today tab — draft queue + activity feed (spec #803 partial)
- Drafts list view
- Draft detail view + sourcing block ("What Marcus used to write this", #807)
- Approve & Send flow (reviewer-as-sender)
- Matters tab + matter detail
- Calendar tab
- Audit log viewer + evidence packet export
- Settings page (trust ceiling controls, voice samples management, skills toggle)
- `customer.yaml` editor UI
- Mobile approval flow (60-second partner loop, #799)
- Day-1 onboarding screens (#803 — ux-lead recommends collapse principal walkthrough from 9 screens to 2)
- Aliveness signal ("where is the agent right now")
- In-app notification surface

---

## 8. Identity & Access

Accounts, OAuth, role-gating, "send as" identity.

**Have:**

- OAuth scopes manifest in customer.yaml
- Per-customer Fly secrets via `pbpaste` flow in provision script
- Existing ss-console auth infrastructure on the portal

**Yet to define/build:**

- OAuth token storage decision (Infisical vs Fly-volume — spec-author flagged ambiguity)
- OAuth callback endpoint on admin/portal subdomain
- Token refresh handling (#789)
- Re-consent flow (#789)
- Per-user accounts within a customer's dashboard
- Role-gating enforcement: Principal / Operator / Compliance (#788)
- "Send as" identity wiring for outgoing drafts (ADR 0005)
- Multi-user-per-customer handling (target-customer flagged multi-paralegal firms)
- MS Graph OAuth flow (#822)
- Customer-side user management UI

---

## 9. Operations

Captain-side infrastructure — provisioning, fleet, cost, decommission.

**Have:**

- `provision-customer.sh` (PR #812)
- `pause-customer.sh`, `rollback-skill.sh` (PR #812)
- `run_prod_smoke_test.py` scaffold (PR #812)
- 8 synthetic PI matter fixtures (PR #832)

**Yet to define/build:**

- Decommission script end-to-end (D1+R2+Vectorize+Composio+AgentMail+Fly cleanup) (#820)
- Cost event emission spec exists (#804); data path undefined (#824)
- Per-customer cost attribution rollup
- Cost dashboard (Captain-only)
- Anomaly alerting (per-customer daily cost vs 7-day avg)
- Customer onboarding runbook
- Pre-meeting dossier pre-provisioning workflow (#819)
- Bus-factor backup operator structure
- Demo dry-run rehearsal script
- Skill regression test CI surface (#825)
- Captain CLI for per-customer ops time-logging (#806)
- Demo-fixture loader (inject fixtures as if live customer data)

---

## 10. Audit & Compliance

What's been done, by whom, when. Evidence packets. Immutability.

**Have:**

- ADR 0008 customer-owned memory artifact (PR #832)
- ADR 0009 cross-Machine query prohibition (PR #832) — verbal only
- Compliance evidence packet content spec (#802)

**Yet to define/build:**

- Audit log persistence (D1 table + writers)
- Per-tool action logging emission (depends on Agent adapter wiring)
- Trust ceiling decision audit emission
- Audit log immutability enforcement (D1 lacks per-role permissions — spec-author flagged; Worker-layer enforcement + Logpush mirror is one path)
- Audit log retention policy
- Evidence packet generation runtime
- Compliance role view in Dashboard
- Audit log query UI

---

## Roll-up

| Component              | Have              | Yet to define/build |
| ---------------------- | ----------------- | ------------------- |
| 1. Agent               | 5                 | 4                   |
| 2. Skills              | ~15               | 7                   |
| 3. Connectors          | 4 built + 8 bound | 7+                  |
| 4. Voice               | 3                 | 7                   |
| 5. Memory              | 2                 | 8                   |
| 6. Trust Ceiling       | 6                 | 8                   |
| 7. Dashboard           | 1                 | 14                  |
| 8. Identity & Access   | 3                 | 9                   |
| 9. Operations          | 4                 | 12                  |
| 10. Audit & Compliance | 3                 | 8                   |

**Biggest gaps by surface area:** Dashboard (almost entirely undefined), Operations (12 unbuilt), Identity & Access (9 unbuilt), Memory (8 unbuilt), Trust Ceiling (8 unbuilt).

**Most leverage to close first:** Agent adapter wiring (#1) unlocks Trust Ceiling enforcement, Audit emission, and Cost telemetry in one stroke. Dashboard infrastructure (#7) is the largest single greenfield surface. MS Graph OAuth (#8) is the most common PI firm tool stack.
