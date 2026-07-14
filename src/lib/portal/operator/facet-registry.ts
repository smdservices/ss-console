/**
 * Operator facet registry (ADR 0069 — Lock 2 "complete legibility" + Lock 4
 * "one viewer per facet, two mounts").
 *
 * The CLOSED set of every facet of an operator's configuration and behavior the
 * client-portal / admin-operator surfaces present or deliberately withhold. It
 * is the operator analog of the activity-language allowlist
 * (`activity-language.ts`): an exhaustiveness test
 * (`tests/operator-facet-legibility.test.ts`) asserts every member carries a
 * deliberate surface decision, so a NEW facet forces a legibility call at merge
 * time rather than being silently absent.
 *
 * Each facet declares:
 *   - `plane`   — where its data lives, which decides buildability. See the
 *                 ground-truth matrix
 *                 (docs/design/operator/legibility-ground-truth-matrix.md) for
 *                 the per-plane real/needs-wiring/needs-schema detail.
 *   - `surface` — the deliberate decision: shown now (`has_viewer` → the one
 *                 shared viewer module both portals mount, per Lock 4), planned
 *                 for a specific build slice, or suppressed with a reason.
 *   - `mounts`  — which portals render it.
 *   - `inert`   — authorable-but-no-runtime-effect facets that must NEVER be
 *                 rendered as if they take effect (ADR 0069 Lock 2 note).
 *
 * As each build slice lands it flips a facet's `surface` from `planned` to
 * `has_viewer` and points `viewerModule` at the shared viewer — never a
 * per-portal reimplementation (Lock 4).
 *
 * This registry carries NO vertical vocabulary and NO client business data — it
 * is a map of the operator's own configuration/behavior facets only (Lock 1).
 */

/** Where a facet's data lives — the buildability plane (ground-truth matrix). */
export type FacetPlane =
  /** Central `customer_configs` projection — readable now. */
  | 'config_projection'
  /** Authored in customer.yaml but DROPPED from the projection — needs a
   *  projection extension or an R2/git read before a viewer is real. */
  | 'config_unprojected'
  /** Central console table fed by Machine heartbeat push (fleet_status,
   *  operator_runtime_summary) — readable now. */
  | 'central_runtime'
  /** Per-customer Machine D1, reachable only through the ADR 0043 runtime read
   *  seam, which is unwired today (some also need a resolver / new read-kind). */
  | 'runtime_seam'
  /** No config facet exists yet; a schema must be designed first. */
  | 'no_schema'
  /** Admin-only by doctrine (ADR 0052 §8) — the client never operates, and for
   *  `cost` never even reads. */
  | 'smd_only'

/** The deliberate legibility decision for a facet. */
export type FacetSurface =
  /** Shown now, by the one shared viewer module both portals mount (Lock 4). */
  | { kind: 'has_viewer'; viewerModule: string }
  /** Not shown yet; scheduled for a specific epic slice. */
  | { kind: 'planned'; slice: number }
  /** Deliberately not a client surface, with a reason (Lock 2). */
  | { kind: 'suppressed'; reason: string }

export type FacetMount = 'client' | 'admin'

export interface OperatorFacet {
  /** Stable id (kebab); the registry key. */
  id: string
  /** Human label for the facet. */
  label: string
  plane: FacetPlane
  surface: FacetSurface
  mounts: readonly FacetMount[]
  /** Authorable but no runtime effect today — must not be rendered as effective. */
  inert?: boolean
  note?: string
}

/**
 * THE closed facet set. Adding or removing an entry is a deliberate legibility
 * decision — the snapshot test forces this file to be edited consciously.
 */
export const OPERATOR_FACETS: readonly OperatorFacet[] = [
  // ---- Behavior (observation, not config) ----
  {
    id: 'status',
    label: 'Status / aliveness',
    plane: 'central_runtime',
    surface: {
      kind: 'has_viewer',
      viewerModule: 'src/lib/portal/operator/facets/identity/hero.ts',
    },
    mounts: ['client'],
    note: 'Co-rendered with identity in the shared OperatorHero (Slice 2). Admin mount + running-state marker are follow-ups; running never renders today (no in-flight marker pushed).',
  },
  {
    id: 'activity',
    label: 'Activity / audit',
    plane: 'runtime_seam',
    surface: { kind: 'planned', slice: 8 },
    mounts: ['client', 'admin'],
    note: 'Read-only lens (ADR 0052 §4). Resolver exists; seam unwired (OPERATOR_RUNTIME_READ_URL).',
  },

  // ---- Direct: what it is / can do / does / how / remembers / sounds / allowed ----
  {
    id: 'identity',
    label: 'Identity / persona',
    plane: 'config_projection',
    surface: {
      kind: 'has_viewer',
      viewerModule: 'src/lib/portal/operator/facets/identity/hero.ts',
    },
    mounts: ['client'],
    note: 'Active-persona name/title in the shared OperatorHero (Slice 2). Admin mount is a follow-up.',
  },
  {
    id: 'skills',
    label: 'Skills (authored)',
    plane: 'config_projection',
    surface: {
      kind: 'has_viewer',
      viewerModule: 'src/lib/portal/operator/facets/skills/skills.ts',
    },
    mounts: ['client', 'admin'],
    note: 'Inventory (humanized slug) + initiation, in authored order. Now the DETAIL/FALLBACK of The work (ADR 0076, structure doc §3.2): implementing-skill rows within a grid routine, and the whole-page gridless fallback for seats with no routine-grid. Skills page stays routable, loses its landing door. enabled/version/cost dropped from projection and deliberately not shown.',
  },
  {
    id: 'agent-skills',
    label: 'Agent-authored skills inventory',
    plane: 'runtime_seam',
    surface: { kind: 'planned', slice: 9 },
    mounts: ['client', 'admin'],
    note: 'ADR 0017. Machine D1 only; no runtime-read kind yet.',
  },
  {
    id: 'entitlements',
    label: 'Entitlements / exposure',
    plane: 'config_projection',
    surface: { kind: 'planned', slice: 3 },
    mounts: ['client', 'admin'],
    note: "Persona-level exposure × per-skill initiation; vertical floors non-raisable. Rendered on The work (ADR 0076) from the routine grid: each row's start/ceiling tier is the authored per-routine autonomy dial, with permanent caps read verbatim. Coarse-vs-rich matrix is an open decision.",
  },
  {
    id: 'schedule',
    label: 'Schedule / recurring jobs',
    plane: 'config_unprojected',
    surface: { kind: 'planned', slice: 7 },
    mounts: ['client', 'admin'],
    note: 'The "starts on a schedule" signal is rendered on The work (ADR 0076) from each grid row\'s initiation. The concrete cron detail (personas[].cron[]) is authored but dropped from the projection — still pending a projection extension before the recurring-job specifics can show.',
  },
  {
    id: 'bundles',
    label: 'Skill bundles',
    plane: 'config_unprojected',
    surface: { kind: 'planned', slice: 7 },
    mounts: ['client', 'admin'],
    note: 'personas[].bundles[] — dropped from projection, same extension as schedule.',
  },
  {
    id: 'workflow',
    label: 'Workflows / process',
    plane: 'config_projection',
    surface: {
      kind: 'has_viewer',
      viewerModule: 'src/lib/portal/operator/facets/work/work.ts',
    },
    mounts: ['client', 'admin'],
    note: 'The work chapter (ADR 0076, console structure doc §3.2). The routine grid (routine-grid.yaml, ADR 0075) is the schema that "no config facet exists" once anticipated — plane no_schema → config_projection now that the grid projects into customer_configs. Renders the lifecycle-grouped routine matrix; a seat with no grid degrades to the skills inventory fallback.',
  },
  {
    id: 'memory',
    label: 'Memory (learned + authored)',
    plane: 'runtime_seam',
    surface: { kind: 'planned', slice: 9 },
    mounts: ['client', 'admin'],
    note: 'Honcho conclusions in Machine D1; memory_export kind exists, no resolver. Never grants capability.',
  },
  {
    id: 'voice',
    label: 'Voice',
    plane: 'config_projection',
    surface: { kind: 'planned', slice: 5 },
    mounts: ['client', 'admin'],
    note: 'Authored library projected (real); runtime samples are a stub.',
  },
  {
    id: 'connections',
    label: 'Connections / connectors',
    plane: 'config_projection',
    surface: { kind: 'planned', slice: 4 },
    mounts: ['client', 'admin'],
    note: 'Health is authored-static, not live. Channels (telegram) fold in here.',
  },
  {
    id: 'scope',
    label: 'Scope',
    plane: 'config_projection',
    surface: {
      kind: 'has_viewer',
      viewerModule: 'src/lib/portal/operator/facets/scope/scope.ts',
    },
    mounts: ['client', 'admin'],
    note: 'Boundaries chapter (ADR 0076): folders seen/blind, the ADR 0055 roster, and the three block lists, separately labeled. Admin mount is a follow-up.',
  },
  {
    id: 'business-hours',
    label: 'Business hours',
    plane: 'config_projection',
    surface: { kind: 'planned', slice: 5 },
    mounts: ['client', 'admin'],
    note: 'Only timezone materializes; days/start/end sub-fields are INERT — the viewer must not imply they take effect (Lock 2).',
  },
  {
    id: 'escalation',
    label: 'Escalation contacts',
    plane: 'config_projection',
    surface: { kind: 'planned', slice: 5 },
    mounts: ['client', 'admin'],
  },

  // ---- Administer: relationship + governance posture ----
  {
    id: 'authority',
    label: 'Authority (managed↔self-managed)',
    plane: 'config_projection',
    surface: { kind: 'planned', slice: 6 },
    mounts: ['client', 'admin'],
    note: 'The spectrum itself (ADR 0041). Built as data+resolver; needs write-back + client self-manage view.',
  },
  {
    id: 'people',
    label: 'People / roles',
    plane: 'config_projection',
    surface: { kind: 'planned', slice: 6 },
    mounts: ['client', 'admin'],
    note: 'A working client write path already exists (settings/users); consolidate to the shared viewer.',
  },
  {
    id: 'compliance',
    label: 'Compliance (retention / evidence)',
    plane: 'config_projection',
    surface: { kind: 'planned', slice: 11 },
    mounts: ['client', 'admin'],
    note: 'Fold into Activity, role-scoped. Evidence packet needs backend (#878).',
  },

  // ---- SMD-only overlays (ADR 0052 §8) ----
  {
    id: 'provisioning',
    label: 'Provisioning / lifecycle',
    plane: 'smd_only',
    surface: { kind: 'planned', slice: 2 },
    mounts: ['admin'],
    note: 'Admin observe-to-operate overlay; client watches status only, never operates.',
  },
  {
    id: 'cost',
    label: 'Cost / economics',
    plane: 'smd_only',
    surface: {
      kind: 'suppressed',
      reason: 'SMD cost basis; the one domain the client never even reads (ADR 0041/0052 §8).',
    },
    mounts: ['admin'],
  },

  // ---- Deliberately suppressed from the client surface ----
  {
    id: 'observability',
    label: 'Observability (Sentry/health)',
    plane: 'smd_only',
    surface: {
      kind: 'suppressed',
      reason: 'Ops telemetry; surfaces as admin health, not a client config facet.',
    },
    mounts: ['admin'],
  },
  {
    id: 'safety-sticky-stop',
    label: 'Cost breaker / sticky-stop',
    plane: 'smd_only',
    surface: {
      kind: 'suppressed',
      reason:
        'Integrity control; ladder thresholds are platform-fixed, not customer-authorable (ADR 0062).',
    },
    mounts: ['admin'],
  },
  {
    id: 'mcp-connector',
    label: 'Operator⇄Claude MCP endpoint',
    plane: 'config_projection',
    surface: {
      kind: 'suppressed',
      reason: 'Console-side endpoint config (ADR 0057); not a client-portal surface.',
    },
    mounts: ['admin'],
  },
  {
    id: 'digest',
    label: 'Digest routing',
    plane: 'config_unprojected',
    surface: {
      kind: 'suppressed',
      reason: 'Routing plumbing (where the daily digest lands); no standalone client surface.',
    },
    mounts: ['admin'],
  },
  {
    id: 'relationship',
    label: 'Relationship behavioral lane',
    plane: 'config_unprojected',
    surface: {
      kind: 'suppressed',
      reason:
        'Authored behavioral lane (ADR 0048); informational, never grants capability — folds into Memory when surfaced.',
    },
    mounts: ['admin'],
  },
  {
    id: 'webhook-triggers',
    label: 'Webhook triggers',
    plane: 'config_unprojected',
    surface: {
      kind: 'suppressed',
      reason: 'source×event routing plumbing; folds into Connections when surfaced.',
    },
    mounts: ['admin'],
  },
  {
    id: 'addons',
    label: 'Vertical-pack addons',
    plane: 'config_projection',
    surface: {
      kind: 'suppressed',
      reason:
        'Structural (which pack is attached); Captain-gated provisioning concern, not a client config surface.',
    },
    mounts: ['admin'],
    inert: true,
    note: 'Validated but not materialized (no runtime effect today).',
  },
  {
    id: 'practice-areas',
    label: 'Practice areas',
    plane: 'config_projection',
    surface: {
      kind: 'suppressed',
      reason: 'Authoring/validation only; not rendered anywhere today.',
    },
    mounts: ['admin'],
    inert: true,
  },
  {
    id: 'gmail-push',
    label: 'Gmail push',
    plane: 'config_unprojected',
    surface: {
      kind: 'suppressed',
      reason: 'Validator live, materializer pending; no effect and no surface today.',
    },
    mounts: ['admin'],
    inert: true,
  },
] as const

/** Facets currently intended for the client portal (surfaced or planned). */
export function clientFacets(): OperatorFacet[] {
  return OPERATOR_FACETS.filter(
    (f) => f.mounts.includes('client') && f.surface.kind !== 'suppressed'
  )
}

/** Lookup by id. */
export function facetById(id: string): OperatorFacet | undefined {
  return OPERATOR_FACETS.find((f) => f.id === id)
}
