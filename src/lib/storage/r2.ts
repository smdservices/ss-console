/**
 * R2 storage helpers for file uploads.
 *
 * Uploaded files are stored under a structured, tenant-scoped key:
 *   {orgId}/assessments/{assessmentId}/transcript/{nameHash}/{filename}
 *   {orgId}/engagements/{engagementId}/docs/{nameHash}/{filename}
 *
 * The `{nameHash}` segment exists because `{filename}` is lossy — see
 * `uploadKeyLeaf` — and two different uploads that sanitized to the same
 * string used to write the same key, the second destroying the first
 * (ss#2315).
 */

/** Sanitize a client-supplied filename for use in a key: alphanumerics, dots,
 * hyphens and underscores survive; everything else becomes an underscore.
 * Many-to-one on purpose — the hash segment is what makes the key unique. */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * The two trailing segments of an upload key: a short digest of the ORIGINAL
 * filename, then the sanitized filename.
 *
 * Three properties, each load-bearing:
 *
 * - **Distinct names never collide.** `Scope (final).pdf` and
 *   `Scope [final].pdf` sanitize identically but hash differently, so neither
 *   overwrites the other. For engagement deliverables — prefix-listed and
 *   rendered on the client portal — a collision silently removed a document
 *   the client could see.
 * - **The same name still replaces.** Hashing the name rather than the bytes
 *   keeps re-uploading a corrected file a replacement, not a second entry the
 *   UI has no way to remove.
 * - **Display is unchanged.** The filename stays the LAST segment, so every
 *   reader's `key.split('/').pop()` shows what it always showed, and the key
 *   stays under its existing prefix, so prefix listing and the portal's
 *   path-traversal checks are unaffected.
 *
 * Keys written before this existed are untouched and stay reachable: readers
 * use the key recorded in D1 or the key returned by `list()`, never a
 * recomputed one. No migration, nothing orphaned.
 */
export async function uploadKeyLeaf(originalName: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(originalName))
  const nameHash = Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${nameHash}/${sanitizeFileName(originalName)}`
}

/**
 * Structured key for an engagement deliverable.
 *
 * @param orgId - Organization ID for tenant scoping
 * @param engagementId - Engagement the document belongs to
 * @param originalName - The uploaded file's name, unsanitized
 */
export async function getEngagementDocumentKey(
  orgId: string,
  engagementId: string,
  originalName: string
): Promise<string> {
  return `${orgId}/engagements/${engagementId}/docs/${await uploadKeyLeaf(originalName)}`
}

/**
 * Upload a transcript file to R2.
 *
 * @param r2 - The R2 bucket binding (STORAGE)
 * @param orgId - Organization ID for tenant scoping
 * @param assessmentId - Assessment this transcript belongs to
 * @param file - The File object from form data
 * @returns The R2 key where the file was stored
 */
export async function uploadTranscript(
  r2: R2Bucket,
  orgId: string,
  assessmentId: string,
  file: File
): Promise<string> {
  const key = `${orgId}/assessments/${assessmentId}/transcript/${await uploadKeyLeaf(file.name)}`

  const arrayBuffer = await file.arrayBuffer()

  await r2.put(key, arrayBuffer, {
    httpMetadata: {
      contentType: file.type || 'application/octet-stream',
    },
    customMetadata: {
      originalName: file.name,
      uploadedAt: new Date().toISOString(),
    },
  })

  return key
}

/**
 * Get a transcript URL or key for download.
 *
 * In Phase 1, this returns the R2 key directly. The admin can
 * use an API route to stream the file content.
 *
 * @param key - The R2 key of the stored transcript
 * @returns The key (or presigned URL in future phases)
 * @public Part of the transcript-storage surface, pinned as a contract by
 * tests/assessments.test.ts.
 */
export function getTranscriptUrl(key: string): string {
  return key
}

/**
 * Retrieve a transcript object from R2.
 *
 * @param r2 - The R2 bucket binding
 * @param key - The R2 key of the stored transcript
 * @returns The R2Object or null if not found
 */
export async function getTranscript(r2: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return r2.get(key)
}

// ---------------------------------------------------------------------------
// SOW PDF helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve a PDF object from R2.
 *
 * @param r2 - The R2 bucket binding
 * @param key - The R2 key of the stored PDF
 * @returns The R2Object or null if not found
 */
export async function getPdf(r2: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return r2.get(key)
}

/**
 * Structured key for an immutable unsigned SOW revision artifact.
 */
export function getSowRevisionUnsignedKey(
  orgId: string,
  quoteId: string,
  revisionId: string
): string {
  return `orgs/${orgId}/quotes/${quoteId}/sow/${revisionId}/unsigned.pdf`
}

/**
 * Structured key for the signed artifact produced from an immutable SOW revision.
 */
export function getSowRevisionSignedKey(
  orgId: string,
  quoteId: string,
  revisionId: string
): string {
  return `orgs/${orgId}/quotes/${quoteId}/sow/${revisionId}/signed.pdf`
}

export async function uploadSowRevisionPdf(
  r2: R2Bucket,
  key: string,
  pdf: Uint8Array,
  metadata: Record<string, string>
): Promise<string> {
  await r2.put(key, pdf, {
    httpMetadata: {
      contentType: 'application/pdf',
    },
    customMetadata: metadata,
  })

  return key
}

export async function uploadSignedSowRevisionPdf(
  r2: R2Bucket,
  key: string,
  pdf: Uint8Array,
  metadata: Record<string, string>
): Promise<string> {
  await r2.put(key, pdf, {
    httpMetadata: {
      contentType: 'application/pdf',
    },
    customMetadata: metadata,
  })

  return key
}

// ---------------------------------------------------------------------------
// Document listing and streaming helpers
// ---------------------------------------------------------------------------

/**
 * List all R2 objects under a given prefix.
 *
 * Used to enumerate documents for a client engagement:
 *   {orgId}/engagements/{engId}/docs/*
 *
 * @param r2 - The R2 bucket binding
 * @param prefix - The key prefix to list under
 * @returns Array of R2Object metadata
 */
export async function listDocuments(r2: R2Bucket, prefix: string): Promise<R2Object[]> {
  const listed = await r2.list({ prefix })
  return listed.objects
}

/**
 * Get an R2 object for streaming download.
 *
 * @param r2 - The R2 bucket binding
 * @param key - The R2 key of the document
 * @returns The R2ObjectBody for streaming, or null if not found
 */
export async function streamDocument(r2: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return r2.get(key)
}
