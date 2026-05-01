function setupDeliverablesUpload(engagementId: string): void {
  const fileInput = document.getElementById('file-input')
  const uploadBtn = document.getElementById('upload-btn')
  const uploadArea = document.getElementById('upload-area')
  const uploadStatus = document.getElementById('upload-status')

  if (
    !(fileInput instanceof HTMLInputElement) ||
    !(uploadBtn instanceof HTMLButtonElement) ||
    !(uploadArea instanceof HTMLDivElement) ||
    !(uploadStatus instanceof HTMLDivElement)
  ) {
    return
  }

  const uploadStatusEl = uploadStatus

  uploadBtn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => uploadFiles(fileInput.files))

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault()
    uploadArea.classList.add('drag-active')
  })
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-active')
  })
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault()
    uploadArea.classList.remove('drag-active')
    uploadFiles(e.dataTransfer?.files ?? null)
  })

  async function uploadFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    uploadStatusEl.classList.remove('hidden')

    for (const file of files) {
      uploadStatusEl.textContent = `Uploading ${file.name}...`
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await fetch(`/api/admin/engagements/${engagementId}/deliverables`, {
          method: 'POST',
          body: form,
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          uploadStatusEl.textContent = `Failed: ${data.error || res.statusText}`
        } else {
          uploadStatusEl.textContent = `Uploaded ${file.name}`
        }
      } catch (err) {
        uploadStatusEl.textContent =
          err instanceof Error ? `Error: ${err.message}` : 'Error: Upload failed'
      }
    }
    window.setTimeout(() => location.reload(), 800)
  }
}

function setupConsultantPhoto(engagementId: string): void {
  const photoInput = document.getElementById('photo-input')
  const photoChoose = document.getElementById('photo-choose')
  const photoUpload = document.getElementById('photo-upload')
  const photoCancel = document.getElementById('photo-cancel')
  const photoRemove = document.getElementById('photo-remove')
  const photoPreview = document.getElementById('photo-preview')
  const photoStatus = document.getElementById('photo-status')

  if (
    !(photoInput instanceof HTMLInputElement) ||
    !(photoChoose instanceof HTMLButtonElement) ||
    !(photoUpload instanceof HTMLButtonElement) ||
    !(photoCancel instanceof HTMLButtonElement) ||
    !(photoPreview instanceof HTMLCanvasElement) ||
    !(photoStatus instanceof HTMLElement)
  ) {
    return
  }

  const photoPreviewEl = photoPreview
  const photoStatusEl = photoStatus
  const photoRemoveEl = photoRemove instanceof HTMLButtonElement ? photoRemove : null
  let pendingBlob: Blob | null = null
  const TARGET_SIZE = 400
  const PREVIEW_SIZE = 160
  const MAX_BYTES = 5 * 1024 * 1024

  function setStatus(msg: string, isError: boolean): void {
    photoStatusEl.textContent = msg
    photoStatusEl.className = isError
      ? 'mt-2 text-xs text-[color:var(--ss-color-error)]'
      : 'mt-2 text-xs text-[color:var(--ss-color-text-secondary)]'
  }

  async function cropToSquareWebp(file: File): Promise<Blob> {
    if (file.size > MAX_BYTES) {
      throw new Error('Original file exceeds 5 MB. Please pick a smaller image.')
    }
    const bitmap = await createImageBitmap(file)
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = Math.round((bitmap.width - side) / 2)
    const sy = Math.round((bitmap.height - side) / 2)

    const canvas = document.createElement('canvas')
    canvas.width = TARGET_SIZE
    canvas.height = TARGET_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Could not initialize image processing.')
    }
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, TARGET_SIZE, TARGET_SIZE)

    photoPreviewEl.width = PREVIEW_SIZE
    photoPreviewEl.height = PREVIEW_SIZE
    const previewContext = photoPreviewEl.getContext('2d')
    if (!previewContext) {
      throw new Error('Could not initialize preview canvas.')
    }
    previewContext.drawImage(canvas, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE)
    photoPreviewEl.classList.remove('hidden')

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (nextBlob) => (nextBlob ? resolve(nextBlob) : reject(new Error('Encoding failed'))),
        'image/webp',
        0.9
      )
    })
    if (blob.size > MAX_BYTES) {
      throw new Error('Encoded photo still exceeds 5 MB. Try a smaller source image.')
    }
    return blob
  }

  photoChoose.addEventListener('click', () => photoInput.click())

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0]
    if (!file) return
    try {
      setStatus('Processing image...', false)
      pendingBlob = await cropToSquareWebp(file)
      setStatus(`Ready to upload (${(pendingBlob.size / 1024).toFixed(1)} KB WebP)`, false)
      photoUpload.classList.remove('hidden')
      photoCancel.classList.remove('hidden')
    } catch (err) {
      pendingBlob = null
      setStatus(err instanceof Error ? err.message : 'Could not process image', true)
    }
  })

  photoCancel.addEventListener('click', () => {
    pendingBlob = null
    photoInput.value = ''
    photoPreviewEl.classList.add('hidden')
    photoUpload.classList.add('hidden')
    photoCancel.classList.add('hidden')
    setStatus('', false)
  })

  photoUpload.addEventListener('click', async () => {
    if (!pendingBlob) return
    photoUpload.disabled = true
    photoCancel.disabled = true
    setStatus('Uploading...', false)
    const form = new FormData()
    form.append('photo', new File([pendingBlob], 'consultant.webp', { type: 'image/webp' }))
    try {
      const res = await fetch(`/api/admin/engagements/${engagementId}/consultant-photo`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || res.statusText)
      }
      setStatus('Photo uploaded. Reloading...', false)
      window.setTimeout(() => location.reload(), 500)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Upload failed', true)
      photoUpload.disabled = false
      photoCancel.disabled = false
    }
  })

  if (!photoRemoveEl) return

  photoRemoveEl.addEventListener('click', async () => {
    if (!confirm('Remove the current consultant photo?')) return
    photoRemoveEl.disabled = true
    setStatus('Removing...', false)
    try {
      const res = await fetch(`/api/admin/engagements/${engagementId}/consultant-photo`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || res.statusText)
      }
      setStatus('Photo removed. Reloading...', false)
      window.setTimeout(() => location.reload(), 500)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Remove failed', true)
      photoRemoveEl.disabled = false
    }
  })
}

export function initEngagementDetailPage(rootId = 'engagement-page'): void {
  const root = document.getElementById(rootId)
  const engagementId = root instanceof HTMLElement ? root.dataset.engagementId : null
  if (!engagementId) return

  setupDeliverablesUpload(engagementId)
  setupConsultantPhoto(engagementId)
}
