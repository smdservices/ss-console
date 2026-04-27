/**
 * Admin failure alerts for the public /scan pipeline (#612).
 *
 * Sends a plain-text email to the team distribution list when a module in
 * the pruned diagnostic pipeline throws an unhandled error. Modeled on
 * `workers/review-mining/src/alert.ts` — same Resend-direct-fetch shape,
 * same sender, same recipient — but parameterized for diagnostic scans
 * (one row at a time, not a batch summary).
 *
 * Why a separate alert path instead of the Resend wrapper in
 * `src/lib/email/resend.ts`:
 *
 *   - The wrapper records an `outreach_events` row tied to an entity. An
 *     internal admin alert is not outreach — there's no entity to attribute
 *     it to (the failure may have happened before the entity row was
 *     finalized) and we don't want it polluting funnel telemetry.
 *
 *   - The alert path is best-effort. We never block the pipeline on alert
 *     send: a 500 from Resend during an admin alert should be logged and
 *     swallowed, not propagated.
 *
 * Voice / content rules:
 *   - Internal-only. Recipients are operators, not prospects. Plain text.
 *   - Echo the submitted domain + email so the operator can find the
 *     scan_request row without query gymnastics. These are PII we already
 *     hold and are reading them in clear in the audit table; surfacing
 *     them here is fine.
 *   - Truncate the error message to keep the email body readable. The
 *     full message is stored in `scan_status_reason` for the admin view.
 */

const RESEND_API_URL = 'https://api.resend.com/emails'
const ADMIN_RECIPIENT = 'team@smd.services'
const SENDER = 'SMD Services <noreply@smd.services>'

export interface ScanFailureAlertInput {
  scanRequestId: string
  submittedDomain: string
  requesterEmail: string
  failingModule: string
  errorMessage: string
}

/**
 * Best-effort admin alert for a failed diagnostic scan. Returns true if
 * Resend accepted the request, false otherwise. Never throws — the caller
 * is already in an error path and another error here would mask the real
 * one.
 *
 * Dev/test mode (no API key): logs to console and returns true. Mirrors
 * `sendEmail` in src/lib/email/resend.ts so unit tests don't need to
 * stub Resend.
 */
export async function sendScanFailureAlert(
  apiKey: string | undefined,
  input: ScanFailureAlertInput
): Promise<boolean> {
  const truncated =
    input.errorMessage.length > 500 ? input.errorMessage.slice(0, 500) + '…' : input.errorMessage

  const lines = [
    `A diagnostic /scan run failed unrecoverably.`,
    ``,
    `Scan request id : ${input.scanRequestId}`,
    `Submitted domain: ${input.submittedDomain}`,
    `Requester email : ${input.requesterEmail}`,
    `Failing module  : ${input.failingModule}`,
    ``,
    `Error message:`,
    truncated,
    ``,
    `The pipeline stopped before completion. The scan_request row is`,
    `marked scan_status='failed' with the failing module + error in`,
    `scan_status_reason. The prospect will not receive a report email.`,
    `Investigate via the admin retrospective: filter scan_requests by`,
    `scan_status = 'failed'.`,
  ]
  const text = lines.join('\n')
  const subject = `[/scan FAILED] ${input.failingModule} — ${input.submittedDomain}`

  if (!apiKey) {
    console.log('[scan:admin-alert:dev] Would send admin failure alert')
    console.log(`  To: ${ADMIN_RECIPIENT}`)
    console.log(`  Subject: ${subject}`)
    console.log(text)
    return true
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: SENDER,
        to: [ADMIN_RECIPIENT],
        subject,
        text,
      }),
    })
    if (!response.ok) {
      console.error(`[scan:admin-alert] Resend rejected alert: ${response.status}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[scan:admin-alert] failed to send admin alert:', err)
    return false
  }
}
