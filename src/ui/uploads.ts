import type { UploadRecord, UploadRef } from '../channel/web/protocol.ts'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
const MAX_THUMBNAIL_BYTES = 256 * 1024
const THUMBNAIL_SIDE = 256

/** The `@` query being typed at the end of the text, or null when no `@` token is open. */
export function mentionQuery(text: string): string | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text)
  return match === null ? null : (match[2] ?? '')
}

/** The text without the open `@` token. */
export function removeMention(text: string): string {
  return text.replace(/(^|\s)@[^\s@]*$/, '$1')
}

/** Library entries whose name contains the query, case-insensitively. */
export function filterUploads(uploads: UploadRecord[], query: string): UploadRecord[] {
  const needle = query.toLowerCase()
  return uploads.filter(upload => upload.name.toLowerCase().includes(needle))
}

export function isPdf(mime: string): boolean {
  return mime === 'application/pdf'
}

export function toRef(upload: UploadRecord): UploadRef {
  return { id: upload.id, name: upload.name, mime: upload.mime, size: upload.size }
}

/** A stored file as the browser loads it; `thumb` asks for the preview. */
export function uploadUrl(id: string, thumb = false): string {
  return `/api/uploads/${encodeURIComponent(id)}${thumb ? '?thumb=1' : ''}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

/** A small WebP preview of an image, or null when the browser cannot make one. */
export async function makeThumbnail(file: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return null
  }
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, THUMBNAIL_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (context === null) {
      bitmap.close()
      return null
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.82))
    return blob === null || blob.size > MAX_THUMBNAIL_BYTES ? null : blob
  } catch {
    return null
  }
}
