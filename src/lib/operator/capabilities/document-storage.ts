/**
 * DocumentStorage capability — store, retrieve, and version documents
 * and folders in the customer's document repository.
 *
 * Distinct from PracticeManagement.list_matter_documents, which lives
 * inside the PM system. This capability is the standalone document
 * store (SharePoint, Google Drive, Dropbox, Box).
 *
 * Writes here are not "outbound" in the draft-for-review external send sense (the
 * agent writes to the customer's own storage, not to an external
 * recipient). Sharing a document with an external party IS outbound;
 * the interface provides `share_document_draft` which, per ADR 0005,
 * surfaces the share-invitation as a draft in the reviewer's flow
 * rather than sending an invite directly.
 */

import type { AdapterBase } from './types'

// ---------------------------------------------------------------------------
// Documents and folders
// ---------------------------------------------------------------------------

export interface StoredDocument {
  id: string
  /** Full path within the storage namespace (forward-slash separated). */
  path: string
  filename: string
  mime_type: string
  size_bytes: number
  /** ISO 8601 timestamps from the source system. */
  created_at: string
  modified_at: string
  modified_by: string | null
  /** Stable version identifier (commit-sha-like or vendor revision ID). */
  current_version: string
}

export interface Folder {
  id: string
  path: string
  name: string
  /** Whether this folder is shared outside the customer's organization.
   * Null when the adapter cannot determine. */
  is_shared_externally: boolean | null
  created_at: string
}

export interface DocumentVersion {
  version_id: string
  document_id: string
  created_at: string
  created_by: string | null
  size_bytes: number
  /** Optional vendor-provided change description. */
  comment: string | null
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface ListFolderQuery {
  folder_path: string
  /** When true, include sub-folder contents. Adapters that cannot
   * recurse return only the immediate folder and document the
   * limitation. */
  recursive?: boolean
  limit?: number
  cursor?: string
}

export interface FolderListing {
  folder: Folder
  documents: StoredDocument[]
  subfolders: Folder[]
  next_cursor: string | null
}

export interface UploadDocumentInput {
  folder_path: string
  filename: string
  mime_type: string
  content: Uint8Array
  /** Whether to overwrite if a file with this name exists. Default false. */
  overwrite?: boolean
  /** Audit correlation. */
  matter_ref?: string | null
  drafted_by_skill: string
}

export interface UpdateDocumentInput {
  document_id: string
  content: Uint8Array
  /** Optional version comment. */
  comment?: string
}

// ---------------------------------------------------------------------------
// External sharing — drafts only per ADR 0005
// ---------------------------------------------------------------------------

export interface ShareDocumentDraftInput {
  /** The reviewer who will send the share invite. */
  reviewer_account_id: string
  document_id: string
  /** Recipients to share with. */
  recipients: string[]
  /** Permission grant. Adapters that cannot honor this return
   * `capability_not_supported`. */
  permission: 'view' | 'comment' | 'edit'
  /** Optional message included with the share invitation. */
  message?: string
  drafted_by_skill: string
}

export interface ShareDraftRef {
  id: string
  document_id: string
  status: 'pending_review' | 'ready_for_send'
  created_at: string
  /** Vendor-specific UI hint for where the reviewer finds the pending
   * share. Helps the dashboard render "go to your SharePoint share
   * panel". */
  reviewer_ui_hint: string | null
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface DocumentStorage extends AdapterBase {
  list_folder(query: ListFolderQuery): Promise<FolderListing>
  get_document(document_id: string): Promise<StoredDocument | null>
  download_document(document_id: string): Promise<Uint8Array>

  upload_document(input: UploadDocumentInput): Promise<StoredDocument>
  update_document(input: UpdateDocumentInput): Promise<StoredDocument>

  list_versions(document_id: string): Promise<DocumentVersion[]>
  download_version(document_id: string, version_id: string): Promise<Uint8Array>

  /**
   * Create a draft share invitation. Per ADR 0005 the agent never
   * sends external share invites; the reviewer reviews the draft and
   * sends from their native UI. Adapters that cannot offer a "draft"
   * concept declare this method unsupported in their CapabilitySet.
   */
  share_document_draft(input: ShareDocumentDraftInput): Promise<ShareDraftRef>

  /** Folders the customer.yaml scope envelope makes readable. */
  get_scoped_folders(): string[]
}
