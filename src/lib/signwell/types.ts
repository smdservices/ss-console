/**
 * TypeScript types for the SignWell e-signature API.
 *
 * Based on the SignWell API v1 documentation.
 * These types cover the subset of the API used by the SMD Services portal:
 * document creation, document retrieval, and webhook payloads.
 */

/**
 * Signer details for a signature request.
 */
export interface SignWellSigner {
  id: string
  name: string
  email: string
  signed_at: string | null
}

/**
 * Field placement on a document for signature collection.
 */
export interface SignWellField {
  type: 'signature' | 'date' | 'text' | 'initials'
  required: boolean
  page: number
  x: number
  y: number
  width?: number
  height?: number
  api_id?: string
}

/**
 * Request body for POST /documents to create a signature request.
 *
 * Supports either file_url (R2 presigned URL) or file (base64-encoded PDF).
 * We use file (base64) since R2 objects are not publicly accessible.
 */
export interface SignWellCreateDocumentRequest {
  /** Display name for the document in SignWell */
  name: string
  /** Document files — each with file_base64 or file_url */
  files: {
    file_base64?: string
    file_url?: string
    name?: string
  }[]
  /** Recipients (signers) */
  recipients: {
    id: string
    name: string
    email: string
  }[]
  /** Webhook callback URL for completion events */
  callback_url?: string
  /**
   * Field placements — 2D array: outer = per file, inner = fields.
   * Each field uses recipient_id to link to a recipient.
   */
  fields: (SignWellField & { recipient_id: string })[][]
  /** Whether to send the signing request via email immediately */
  draft?: boolean
  /** Enable test mode (no real signatures) */
  test_mode?: boolean
  /** Custom message to include in the signing email */
  custom_requester_name?: string
  custom_requester_email?: string
  /** Subject line for signing email */
  subject?: string
  /** Message body for signing email */
  message?: string
}

/**
 * SignWell document object returned by the API.
 */
export interface SignWellDocument {
  id: string
  name: string
  status: 'draft' | 'pending' | 'completed' | 'cancelled' | 'expired'
  signers: SignWellSigner[]
  completed_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Webhook payload sent by SignWell when a document event occurs.
 *
 * SignWell wraps event metadata (type, timestamp, HMAC hash) in an
 * `event` object and the document data in `data.object`.
 *
 * Ref: https://developers.signwell.com/reference/event-data
 */
export interface SignWellWebhookPayload {
  event: {
    type:
      | 'document_completed'
      | 'document_expired'
      | 'document_cancelled'
      | 'document_created'
      | 'document_sent'
      | 'document_viewed'
      | 'document_signed'
      | 'document_declined'
      | 'document_bounced'
      | 'document_error'
      | 'document_in_progress'
      | 'document_recipients_updated'
    /** Unix timestamp of the event */
    time: number
    /** HMAC-SHA256 hex digest for verification (key = webhook ID) */
    hash: string
    /** Present on view/sign/decline events */
    related_signer?: { email: string; name: string }
  }
  data: {
    /** Full document object (matches GET /documents/:id response) */
    object: {
      id: string
      name: string
      status: string
      signers?: SignWellSigner[]
      completed_at: string | null
    }
    account_id: string
  }
}
