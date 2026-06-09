/**
 * Home / Today runtime feeds (client-portal §5.1). The Home surface answers
 * "what's happening" with four elements: aliveness (resolved separately via the
 * summary mirror), recent activity, what-needs-you, and escalations. The latter
 * three are fed by the live runtime read path (ADR 0043 path A).
 *
 * Until OPERATOR_RUNTIME_READ_URL is wired, the read path fails closed, so this
 * returns empty feeds — the design's documented honest empty state
 * (foundations §6: "until built, runtime surfaces render honest empty states").
 *
 * `needsAttentionCount` stays 0 by construction here. The Home must never
 * fabricate a review queue the entitlements did not author (ADR 0035 /
 * client-portal §5.1): a "what needs you" entry exists only when a skill was
 * authored to route to a human AND the runtime switch hands it to the client.
 * Absent that authored routing, there is nothing — not a zeroed queue implying
 * one exists, but no surface at all.
 *
 * PR2 (Activity & Audit) wires the actual readMachineRuntime call + payload
 * parse into this function; the Home page consumes this typed shape and does
 * not change when that lands.
 */

import { isRuntimeReadConfigured, type RuntimeReadEnv } from '../../operator/runtime-read-transport'

export interface HomeActivityItem {
  id: string
  summary: string
  at: string
}

export interface HomeEscalationItem {
  id: string
  summary: string
  at: string
}

export interface HomeFeeds {
  /** Whether the live runtime read path is wired. When false, every feed is empty. */
  runtimeConfigured: boolean
  /** Recent completed actions, plain-language. Empty until the read path is wired. */
  recentActivity: HomeActivityItem[]
  /** Count of items routed to a human for THIS client. 0 unless authored + switched on. */
  needsAttentionCount: number
  /** Items the operator flagged to a human per the escalation config. */
  escalations: HomeEscalationItem[]
}

/**
 * Assemble the Home/Today feeds for the signed-in client's own operator.
 * Currently returns honest empty feeds (the runtime read path is not wired);
 * `runtimeConfigured` reflects whether it is, so the surface can distinguish
 * "wired but quiet" from "not wired" if it ever needs to.
 */
export function loadHomeFeeds(env: RuntimeReadEnv): HomeFeeds {
  return {
    runtimeConfigured: isRuntimeReadConfigured(env),
    recentActivity: [],
    needsAttentionCount: 0,
    escalations: [],
  }
}
