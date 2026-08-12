/**
 * R2 key collision resistance (ss#2315, #2280 hardening item 11).
 *
 * Two upload paths used a client-supplied filename as the whole key leaf,
 * sanitized with `replace(/[^a-zA-Z0-9._-]/g, '_')`. That expression is
 * many-to-one — `notes v1.txt`, `notes+v1.txt` and `notes(v1).txt` all become
 * `notes_v1.txt` — so two distinct uploads wrote the same key and the second
 * destroyed the first.
 *
 * Engagement deliverables are the sharp half: they are prefix-listed, not
 * pointer-indexed, and the list renders on the CLIENT portal. Losing one is
 * losing a document a client could see.
 *
 * The fix must not change what anyone reads. Two invariants are pinned here
 * alongside the collision itself: the key stays under the same prefix (so
 * prefix listing and the portal's path-traversal check are unaffected), and
 * the last path segment is still the sanitized filename (so every display
 * site's `key.split('/').pop()` keeps showing the name the client gave).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  uploadTranscript,
  getTranscript,
  getEngagementDocumentKey,
  listDocuments,
} from '../src/lib/storage/r2'

// ---------------------------------------------------------------------------
// Minimal in-memory R2
// ---------------------------------------------------------------------------

interface StoredObject {
  key: string
  body: ArrayBuffer
  customMetadata?: Record<string, string>
}

function makeBucket(): { bucket: R2Bucket; store: Map<string, StoredObject> } {
  const store = new Map<string, StoredObject>()
  const bucket = {
    put(key: string, body: ArrayBuffer, opts?: { customMetadata?: Record<string, string> }) {
      store.set(key, { key, body, customMetadata: opts?.customMetadata })
      return Promise.resolve({ key })
    },
    get(key: string) {
      const hit = store.get(key)
      if (!hit) return Promise.resolve(null)
      return Promise.resolve({
        key,
        customMetadata: hit.customMetadata,
        text: () => Promise.resolve(new TextDecoder().decode(hit.body)),
      })
    },
    list({ prefix }: { prefix: string }) {
      return Promise.resolve({
        objects: [...store.values()]
          .filter((o) => o.key.startsWith(prefix))
          .map((o) => ({ key: o.key, size: o.body.byteLength, uploaded: new Date(0) })),
      })
    },
  } as unknown as R2Bucket
  return { bucket, store }
}

function textFile(name: string, contents: string): File {
  return new File([contents], name, { type: 'text/plain' })
}

const ORG = 'org-r2'
const ASSESSMENT = 'asm-r2'

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

describe('uploadTranscript', () => {
  it('gives two filenames that sanitize identically two distinct keys', async () => {
    const { bucket } = makeBucket()

    const keyA = await uploadTranscript(
      bucket,
      ORG,
      ASSESSMENT,
      textFile('notes v1.txt', 'FIRST CALL')
    )
    const keyB = await uploadTranscript(
      bucket,
      ORG,
      ASSESSMENT,
      textFile('notes+v1.txt', 'SECOND CALL')
    )

    expect(keyA).not.toBe(keyB)

    // Both are still readable — the first was not destroyed by the second.
    const a = await getTranscript(bucket, keyA)
    const b = await getTranscript(bucket, keyB)
    expect(await a?.text()).toBe('FIRST CALL')
    expect(await b?.text()).toBe('SECOND CALL')
  })

  it('is idempotent for a re-upload under the same original filename', async () => {
    const { bucket, store } = makeBucket()
    await uploadTranscript(bucket, ORG, ASSESSMENT, textFile('notes.txt', 'draft'))
    const second = await uploadTranscript(bucket, ORG, ASSESSMENT, textFile('notes.txt', 'final'))

    // Replacing a transcript by re-uploading it stays a replacement, not a
    // second orphan row: one object, latest content.
    expect(store.size).toBe(1)
    expect(await (await getTranscript(bucket, second))?.text()).toBe('final')
  })

  it('keeps the prefix and the displayed filename unchanged', async () => {
    const { bucket } = makeBucket()
    const key = await uploadTranscript(bucket, ORG, ASSESSMENT, textFile('Call Notes.txt', 'x'))

    expect(key.startsWith(`${ORG}/assessments/${ASSESSMENT}/transcript/`)).toBe(true)
    expect(key.split('/').pop()).toBe('Call_Notes.txt')
    // No path-traversal surface introduced by the uniquifier.
    expect(key.includes('..')).toBe(false)
    expect(key.includes('//')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Engagement deliverables — prefix-listed, client-visible
// ---------------------------------------------------------------------------

describe('getEngagementDocumentKey', () => {
  const ENGAGEMENT = 'eng-r2'

  it('gives colliding filenames distinct keys while both stay listable', async () => {
    const { bucket, store } = makeBucket()

    const keyA = await getEngagementDocumentKey(ORG, ENGAGEMENT, 'Scope (final).pdf')
    const keyB = await getEngagementDocumentKey(ORG, ENGAGEMENT, 'Scope [final].pdf')
    expect(keyA).not.toBe(keyB)

    store.set(keyA, { key: keyA, body: new ArrayBuffer(1) })
    store.set(keyB, { key: keyB, body: new ArrayBuffer(2) })

    const listed = await listDocuments(bucket, `${ORG}/engagements/${ENGAGEMENT}/docs/`)
    expect(listed.map((o) => o.key).sort()).toEqual([keyA, keyB].sort())
  })

  it('keeps the last segment as the sanitized name every display site renders', async () => {
    const key = await getEngagementDocumentKey(ORG, ENGAGEMENT, 'Q3 Report.pdf')
    expect(key.startsWith(`${ORG}/engagements/${ENGAGEMENT}/docs/`)).toBe(true)
    expect(key.split('/').pop()).toBe('Q3_Report.pdf')
  })

  it('is stable for the same original filename', async () => {
    const first = await getEngagementDocumentKey(ORG, ENGAGEMENT, 'Q3 Report.pdf')
    const second = await getEngagementDocumentKey(ORG, ENGAGEMENT, 'Q3 Report.pdf')
    expect(first).toBe(second)
  })
})

describe('deliverables upload route', () => {
  it('builds its key through the shared helper rather than its own sanitizer', () => {
    const source = readFileSync(
      resolve('src/pages/api/admin/engagements/[id]/deliverables.ts'),
      'utf-8'
    )
    expect(source).toContain('getEngagementDocumentKey')
    expect(source).not.toContain("replace(/[^a-zA-Z0-9._-]/g, '_')")
  })
})
