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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replaces the open `@` token with a reference to the file, or appends one at the end. */
export function insertReference(text: string, name: string): string {
  const token = `@${name} `
  const open = /(^|\s)@[^\s@]*$/.exec(text)
  if (open !== null) {
    return text.slice(0, open.index) + (open[1] ?? '') + token
  }
  return text === '' || /\s$/.test(text) ? `${text}${token}` : `${text} ${token}`
}

/** Matches `@name` as a whole word, the way the Bridge does when it swaps references for paths. */
function referencePattern(name: string): RegExp {
  return new RegExp(`(?<=^|[\\s([{'"])@${escapeRegExp(name)}(?=$|[\\s.,;:!?)\\]])`, 'g')
}

/** Whether the text still refers to the file. An attachment whose reference was deleted by hand is no longer attached. */
export function isReferenced(text: string, name: string): boolean {
  return referencePattern(name).test(text)
}

/** The attachments the text still refers to; the others were removed from the text and so are detached. */
export function referencedAttachments(text: string, attachments: UploadRef[]): UploadRef[] {
  return attachments.filter(attachment => isReferenced(text, attachment.name))
}

export type TextSegment = { text: string } | { file: UploadRef }

/** Splits a message into plain text and the files it refers to, so each file can show once, inline. */
export function segmentReferences(text: string, files: UploadRef[]): TextSegment[] {
  const matches: { start: number; end: number; file: UploadRef }[] = []
  for (const file of files) {
    for (const match of text.matchAll(referencePattern(file.name))) {
      const start = match.index ?? 0
      matches.push({ start, end: start + match[0].length, file })
    }
  }
  matches.sort((a, b) => a.start - b.start)
  const segments: TextSegment[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start < cursor) {
      continue
    }
    if (match.start > cursor) {
      segments.push({ text: text.slice(cursor, match.start) })
    }
    segments.push({ file: match.file })
    cursor = match.end
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) })
  }
  return segments
}

/**
 * The whole reference the caret is just after, with the space that follows it when there is one, so Backspace can
 * take it out in one step. Null when the caret is not right after a reference.
 */
export function referenceBeforeCaret(text: string, caret: number, attachments: UploadRef[]): { start: number; end: number } | null {
  const before = text.slice(0, caret)
  for (const attachment of attachments) {
    for (const suffix of [' ', '']) {
      const token = `@${attachment.name}${suffix}`
      if (!before.endsWith(token)) {
        continue
      }
      const start = caret - token.length
      if (start === 0 || /\s/.test(before.charAt(start - 1))) {
        return { start, end: caret }
      }
    }
  }
  return null
}

/** Removes every reference to the file, for when it is detached from the message. */
export function removeReferences(text: string, name: string): string {
  return text.replace(new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=\\s|$)\\s?`, 'g'), '$1')
}

/** Library entries whose name contains the query, case-insensitively. */
export function filterUploads(uploads: UploadRecord[], query: string): UploadRecord[] {
  const needle = query.toLowerCase()
  return uploads.filter(upload => upload.name.toLowerCase().includes(needle))
}

/** The picker's order: files already attached to the message first, in the order they were attached; the rest as the library lists them. */
export function pickerOrder(uploads: UploadRecord[], attachedIds: string[]): UploadRecord[] {
  const rank = new Map(attachedIds.map((id, index) => [id, index]))
  return uploads
    .map((upload, index) => ({ upload, index }))
    .sort((a, b) => {
      const left = rank.get(a.upload.id)
      const right = rank.get(b.upload.id)
      if (left !== undefined && right !== undefined) {
        return left - right
      }
      if (left !== undefined) {
        return -1
      }
      if (right !== undefined) {
        return 1
      }
      return a.index - b.index
    })
    .map(entry => entry.upload)
}

/** A long name shortened in the middle, keeping its beginning, its end (where the numbers are) and its extension. */
export function shortName(name: string, max = 30): string {
  if (name.length <= max) {
    return name
  }
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : ''
  const base = name.slice(0, name.length - ext.length)
  const room = max - ext.length - 1
  const head = Math.ceil(room * 0.6)
  const tail = room - head
  return `${base.slice(0, head)}…${tail > 0 ? base.slice(base.length - tail) : ''}${ext}`
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
