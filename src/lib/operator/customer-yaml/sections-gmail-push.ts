/**
 * Optional `gmail_push:` block validator.
 *
 * Gmail push notifications would deliver real-time inbox events via Google Cloud
 * Pub/Sub: a watch subscription on the mailbox, the overlay's `/webhooks/gmail`
 * endpoint receiving Pub/Sub push (OIDC JWT), extracting the historyId, and
 * firing the configured skill on the configured persona.
 *
 * NOT CURRENTLY WIRED. This is validate-only: nothing materializes the block at
 * runtime today. The original implementation renewed the watch via a
 * `crane_gmail_watch.py` connector CLI that authenticated through the legacy
 * `/opt/data/oauth/google.json` path; the ADR 0045 Workspace-broker cutover
 * removed that path and CLI, so the watch was never established and the
 * configured skill was never push-triggered. The validator is retained so the
 * block shape stays enforced for a future rebuild of the watch as a governed
 * Workspace-broker operation. The CustomerYaml type does not carry the block.
 *
 * Fail-closed: disabled by default. ADR 0021 Stream E (webhook_triggers) is NOT
 * used here — Gmail push is a first-class channel (like Telegram), not a generic
 * connector webhook.
 */

import type { ValidationError } from './types'
import { isPlainObject } from './helpers'

const PUBSUB_TOPIC_PATTERN =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[a-zA-Z0-9-_.~+%]{3,255}$/

export function checkGmailPush(root: Record<string, unknown>, errors: ValidationError[]): void {
  const raw = root['gmail_push']
  if (raw === undefined || raw === null) return
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'gmail_push',
      message: 'gmail_push must be an object when present',
    })
    return
  }

  const enabled = raw['enabled']
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    errors.push({
      code: 'TypeMismatch',
      path: 'gmail_push.enabled',
      message: 'gmail_push.enabled must be a boolean',
    })
  }

  if (enabled !== true) return

  checkGmailPushEnabled(raw, errors)
}

function checkGmailPushEnabled(raw: Record<string, unknown>, errors: ValidationError[]): void {
  const subject = raw['subject']
  if (typeof subject !== 'string' || subject.length === 0) {
    errors.push({
      code: 'MissingField',
      path: 'gmail_push.subject',
      message:
        'gmail_push.subject is required when gmail_push.enabled is true (the DWD impersonation subject)',
    })
  }

  const topic = raw['pubsub_topic']
  if (typeof topic !== 'string' || topic.length === 0) {
    errors.push({
      code: 'MissingField',
      path: 'gmail_push.pubsub_topic',
      message:
        'gmail_push.pubsub_topic is required when gmail_push.enabled is true ' +
        '(format: projects/{project}/topics/{name})',
    })
  } else if (!PUBSUB_TOPIC_PATTERN.test(topic)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'gmail_push.pubsub_topic',
      message:
        'gmail_push.pubsub_topic must match "projects/{project}/topics/{name}" ' +
        `— got "${topic}"`,
    })
  }

  const persona = raw['persona']
  if (typeof persona !== 'string' || persona.length === 0) {
    errors.push({
      code: 'MissingField',
      path: 'gmail_push.persona',
      message: 'gmail_push.persona is required when gmail_push.enabled is true',
    })
  }

  const skill = raw['skill']
  if (typeof skill !== 'string' || skill.length === 0) {
    errors.push({
      code: 'MissingField',
      path: 'gmail_push.skill',
      message: 'gmail_push.skill is required when gmail_push.enabled is true',
    })
  }
}
