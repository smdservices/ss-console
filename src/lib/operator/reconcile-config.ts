/**
 * Operator live-reconfig — R2 → git reconciler (ADR 0044, ADR 0012 §2).
 *
 * STATUS: v1 STUB. This module names the reconciler, defines its contract, and
 * fails loudly rather than silently no-op'ing. The git write-back itself is
 * DEFERRED — see "What is deferred and why" below.
 *
 * ---------------------------------------------------------------------------
 * Why a reconciler exists
 * ---------------------------------------------------------------------------
 * The console apply path (`apply-config.ts`) makes R2 the source of truth for a
 * RUNNING Operator's live config so reconfiguration is instant and downtime-
 * free. But ADR 0012 §2 holds that the canonical, reviewed record of
 * customer.yaml lives in a git repository. Those two facts create drift: R2 can
 * be ahead of git between an apply and the next reconcile.
 *
 * The reconciler closes that gap. On a schedule it walks customers whose live
 * R2 config digest differs from the last digest committed to git, and commits
 * the reconciled R2 version back to the customer.yaml repo as the reviewed
 * record — then stamps the resulting real commit SHA onto the history row that
 * apply-config wrote with the synthetic `r2apply:<digest>` pointer.
 *
 * ---------------------------------------------------------------------------
 * What is deferred and why (v1)
 * ---------------------------------------------------------------------------
 * The git write-back cannot run inside the Astro/Workers request runtime: a
 * Worker has no filesystem and no git binary (the same constraint ADR 0012 §2
 * records as keeping configs-repo write-back out of scope for the portal). The
 * reconciler must therefore run as either:
 *
 *   (a) a scheduled GitHub Actions job in the customer.yaml configs repo that
 *       pulls each live R2 object via the R2 S3 API and commits changed files; or
 *   (b) a Cloudflare Cron Trigger that calls the GitHub contents API to commit
 *       (no local git, REST commits only).
 *
 * Picking and building that runner is a follow-on. This module ships the
 * pure, runtime-agnostic PLANNING half (`planReconciliation`) that either
 * runner can call, and a `runReconciliation` entry point that THROWS until the
 * runner is wired — so a caller that forgets the deferral gets a hard error,
 * never a silent success.
 *
 * OWNER: operator-live-reconfig team-lead (this is the lead's follow-on, tracked
 * alongside the ADR 0044 amendment task). Do not mark the live-reconfig epic
 * done while runReconciliation still throws.
 */

/** A single customer's live-vs-committed state, as seen by the reconciler. */
export interface ReconcileCandidate {
  customer_slug: string
  /** Digest of the live config currently in R2 (`vaults/<slug>/customer.yaml`). */
  live_digest: string
  /**
   * Digest last committed to the customer.yaml git repo, or `null` when the
   * reconciler has never committed this customer (first reconcile).
   */
  committed_digest: string | null
}

export interface ReconcilePlanItem {
  customer_slug: string
  live_digest: string
  reason: 'never-committed' | 'digest-drift'
}

export interface ReconcilePlan {
  /** Customers whose live R2 config needs a git commit. */
  to_commit: ReconcilePlanItem[]
  /** Customers already in sync — listed for observability, no action. */
  in_sync: string[]
}

/**
 * Pure planning step: decide which customers need a git commit. Runtime
 * agnostic and side-effect free, so it unit-tests and either runner (Actions
 * or Cron) can share it.
 *
 * A customer needs committing when its live R2 digest differs from the digest
 * last committed to git, or when it has never been committed.
 */
export function planReconciliation(candidates: ReconcileCandidate[]): ReconcilePlan {
  const to_commit: ReconcilePlanItem[] = []
  const in_sync: string[] = []
  for (const c of candidates) {
    if (c.committed_digest === null) {
      to_commit.push({
        customer_slug: c.customer_slug,
        live_digest: c.live_digest,
        reason: 'never-committed',
      })
    } else if (c.committed_digest !== c.live_digest) {
      to_commit.push({
        customer_slug: c.customer_slug,
        live_digest: c.live_digest,
        reason: 'digest-drift',
      })
    } else {
      in_sync.push(c.customer_slug)
    }
  }
  return { to_commit, in_sync }
}

/**
 * Entry point for the scheduled runner. DEFERRED — throws until the git
 * write-back runner (GitHub Actions job or Cron + contents API) is wired.
 * Deliberately not a no-op: a silent no-op would let the live-reconfig epic
 * appear "done" while R2 silently diverges from the reviewed git record.
 */
export function runReconciliation(): never {
  throw new Error(
    'reconcile-config: git write-back is deferred (v1 stub). The reconciler must run as a ' +
      'GitHub Actions job in the customer.yaml configs repo or a Cron Trigger using the GitHub ' +
      'contents API — a Worker has no filesystem/git (ADR 0012 §2). Owner: operator-live-reconfig ' +
      'team-lead. Use planReconciliation() for the pure planning step; do not call runReconciliation ' +
      'until the runner lands.'
  )
}
