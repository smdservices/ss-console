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
  /** Base64-encoded file content */
  file_base64?: string
  /** Public URL to the file (alternative to file_base64) */
  file_url?: string
  /** Original filename */
  original_filename?: string
  /** Signer details */
  signers: {
    id: string
    name: string
    email: string
  }[]
  /** Webhook callback URL for completion events */
  callback_url?: string
  /** Field placements for signature blocks */
  fields: (SignWellField & { signer_id: string })[]
  /** Whether to send the signing request via email immediately */
  draft?: boolean
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
 * The primary event we handle is `document_completed`.
 */
export interface SignWellWebhookPayload {
  event: 'document_completed' | 'document_expired' | 'document_cancelled'
  data: {
    id: string
    name: string
    status: string
    signers: SignWellSigner[]
    completed_at: string | null
  }
}
