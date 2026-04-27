/**
 * Failure alerting via Resend email API.
 */

export interface RunSummary {
  queries: number
  discovered: number
  /** Number of businesses sent to Outscraper after applying the per-run cap. */
  reviewChecksAttempted: number
  withReviews: number
  newBusinesses: number
  qualified: number
  belowThreshold: number
  written: number
  errors: number
  errorDetails: string[]
  /** Estimated Outscraper spend for the run (USD). */
  outscraperSpendUsd: number
  /** True if the run stopped early because the per-run budget was exceeded. */
  budgetGuardTripped: boolean
}

export async function sendFailureAlert(summary: RunSummary, resendApiKey: string): Promise<void> {
  const body = [
    `Review Mining pipeline run completed with errors.`,
    ``,
    `Discovery queries: ${summary.queries}`,
    `Businesses discovered: ${summary.discovered}`,
    `Review checks attempted: ${summary.reviewChecksAttempted}`,
    `With recent reviews: ${summary.withReviews}`,
    `New (not deduped): ${summary.newBusinesses}`,
    `Qualified (pain >= 7): ${summary.qualified}`,
    `Below threshold: ${summary.belowThreshold}`,
    `Written to D1: ${summary.written}`,
    `Outscraper spend (est.): $${summary.outscraperSpendUsd.toFixed(2)}`,
    `Budget guard tripped: ${summary.budgetGuardTripped ? 'YES' : 'no'}`,
    `Errors: ${summary.errors}`,
    ``,
    `Error details:`,
    ...summary.errorDetails.map((e) => `  - ${e}`),
  ].join('\n')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: 'SMD Services <noreply@smd.services>',
      to: ['scott@smd.services'],
      subject: `[Review Mining] Pipeline run failed — ${summary.errors} errors, ${summary.written} signals`,
      text: body,
    }),
  })

  if (!response.ok) {
    console.error(`Resend alert failed: ${response.status}`)
  }
}
