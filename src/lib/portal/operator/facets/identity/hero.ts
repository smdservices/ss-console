/**
 * Operator hero — the shared identity + status view model (ADR 0069 Slice 2).
 *
 * The "meet your operator" lead: who the operator is (persona identity, from the
 * config projection) and whether it is alive and in-bounds (the aliveness
 * signal). One shared resolver + one shared component
 * (`components/portal/operator/facets/OperatorHero.astro`), mounted in both
 * portals per Lock 4 — the facet registry points `identity` and `status` here.
 *
 * Identity is authored config (Tier 1, real from `customer_configs`); nothing is
 * fabricated. A missing persona or missing signal renders the honest empty
 * branch, per docs/style/empty-state-pattern.md.
 */

import type { CustomerConfigRow } from '../../../customer-config'
import type { AlivenessSignal } from '../../aliveness'

export interface OperatorHeroModel {
  /**
   * Client-facing operator name. Defaults to the neutral "Operator" — a client
   * never sees an internal persona name (Crane, Quinn). A client-chosen name
   * would override this, but there is no rename mechanism yet, so it is "Operator"
   * whenever a config exists, and null (→ "Your operator") when none does.
   */
  name: string | null
  /** Persona title / role, e.g. "AI Case Coordinator" — the client-facing
   *  disambiguator (NOT a persona name). */
  title: string | null
  /** The live aliveness signal, or null when the customer has no fleet_status
   *  row yet (the component renders the silent empty state — never a fabricated
   *  "healthy" chip). */
  aliveness: AlivenessSignal | null
}

/**
 * Compose the hero view model from the config projection + the resolved
 * aliveness signal. Pure and total: a null config or no-active-persona yields
 * null identity fields; the caller passes the already-resolved signal.
 */
export function resolveOperatorHero(
  config: CustomerConfigRow | null,
  aliveness: AlivenessSignal | null
): OperatorHeroModel {
  // Select the active persona from the already-projected, typed config — no
  // second DB read, no reparse of personas_json (the projection already parsed
  // it). Mirrors the selection in customer-config.ts::getActivePersona.
  const persona = config?.personas.find((p) => p.status === 'active') ?? null
  return {
    // Neutral by rule (Captain 2026-07-08): the client-facing name is "Operator",
    // never the internal persona name. persona?.name is deliberately NOT surfaced.
    name: config ? 'Operator' : null,
    title: persona?.title ?? null,
    aliveness,
  }
}
