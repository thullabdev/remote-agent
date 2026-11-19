import type { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UploadRecord, UploadRef } from './protocol.ts'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_THUMBNAIL_BYTES = 256 * 1024
export const MAX_TEXT_BYTES = 64 * 1024
export const MAX_ATTACHMENTS = 5

const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])
const IMAGE_AND_PDF_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf'])
const THUMBNAIL_MIMES = new Set(['image/jpeg', 'image/webp'])
const THUMBNAIL_FILE = 'thumb'

export class UploadError extends Error {
  constructor(
    readonly status: 400 | 404 | 413 | 415,
    message: string,
  ) {
    super(message)
  }
}

/** The file type, from its leading bytes; null for anything else. The client's Content-Type is never used. */
export function sniffMime(bytes: Uint8Array): string | null {
  const startsWith = (signature: number[], offset = 0): boolean =>
    signature.every((byte, index) => bytes[offset + index] === byte)
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (startsWith([0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  if (startsWith([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return 'image/gif'
  }
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp'
  }
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'application/pdf'
  }
  return null
}

/** The mime label for each known text extension (lowercase). Any other text file is labelled text/plain. */
export const TEXT_UPLOAD_TYPES: ReadonlyMap<string, string> = new Map([
  ['md', 'text/markdown'],
  ['markdown', 'text/markdown'],
  ['html', 'text/html'],
  ['htm', 'text/html'],
  ['txt', 'text/plain'],
  ['log', 'text/plain'],
  ['csv', 'text/csv'],
  ['tsv', 'text/tab-separated-values'],
  ['json', 'application/json'],
  ['yaml', 'application/yaml'],
  ['yml', 'application/yaml'],
  ['xml', 'application/xml'],
])

const TEXT_MIMES: ReadonlySet<string> = new Set(TEXT_UPLOAD_TYPES.values())

/** True for the mime labels of text uploads, which the file route serves as plain text. */
export function isTextMime(mime: string): boolean {
  return TEXT_MIMES.has(mime)
}

/** The lowercase extension after the last dot, or null when the name has no dot. */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? null : name.slice(dot + 1).toLowerCase()
}

/** The mime label for a text file, from its extension. */
function textMimeFor(name: string): string {
  return TEXT_UPLOAD_TYPES.get(extensionOf(name) ?? '') ?? 'text/plain'
}

/**
 * Whether the bytes are text: valid UTF-8 with no NUL byte. A name with an image or PDF extension is never text, so
 * a broken image is refused rather than stored as text. The bytes decide; the extension only sets the label.
 */
export function isTextUpload(name: string, bytes: Uint8Array): boolean {
  const extension = extensionOf(name)
  if (extension !== null && IMAGE_AND_PDF_EXTENSIONS.has(extension)) {
    return false
  }
  if (bytes.includes(0)) {
    return false
  }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    decoder.decode(bytes)
  } catch {
    return false
  }
  return true
}

/** A basename with only safe characters, never starting with a dot, so it cannot escape its folder. */
export function safeFileName(raw: string): string {
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  const base = decoded.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/^\.+/, '').trim().slice(0, 120)
  return cleaned === '' ? 'file' : cleaned
}

type UploadRow = { id: string; name: string; mime: string; size: number; thumb_mime: string | null; created_at: number }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE, thumb_mime TEXT, created_at INTEGER NOT NULL
);
`

function toRecord(row: UploadRow): UploadRecord {
  return { id: row.id, name: row.name, mime: row.mime, size: row.size, createdAt: row.created_at, hasThumbnail: row.thumb_mime !== null }
}

/** The shared library of uploaded images and PDFs. Files live under `dir`, one folder per upload. */
export class UploadLibrary {
  constructor(
    private readonly db: Database,
    readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(SCHEMA)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  /**
   * Stores a file. Images and PDFs keep the type their bytes show; any other file that is text (see isTextUpload)
   * is stored under its extension's label. The same bytes uploaded again return the existing entry.
   */
  add(rawName: string, bytes: Uint8Array): UploadRecord {
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new UploadError(413, 'File is larger than 10 MB.')
    }
    const name = safeFileName(rawName)
    const mime = sniffMime(bytes)
    if (mime !== null && ALLOWED_MIMES.has(mime)) {
      return this.save(bytes, name, mime)
    }
    if (isTextUpload(name, bytes)) {
      return this.save(bytes, name, textMimeFor(name))
    }
    throw new UploadError(415, 'Only images, PDFs and text files can be uploaded.')
  }

  /**
   * Stores text written by the server, such as the comments attached to a chat. The bytes are not sniffed: the text
   * comes from the server, never from a client file. A name without a known text extension gets .txt.
   */
  addText(rawName: string, text: string): UploadRef {
    const trimmedName = rawName.trim()
    if (trimmedName === '') {
      throw new UploadError(400, 'The file needs a name.')
    }
    if (trimmedName.length > 120) {
      throw new UploadError(400, 'The file name is longer than 120 characters.')
    }
    if (text.trim() === '') {
      throw new UploadError(400, 'The text is empty.')
    }
    const bytes = new TextEncoder().encode(text)
    if (bytes.byteLength > MAX_TEXT_BYTES) {
      throw new UploadError(400, 'The text is larger than 64 KB.')
    }
    const withoutUnsafe = trimmedName.replace(/[^A-Za-z0-9._ -]/g, '-')
    const hasKnownExtension = TEXT_UPLOAD_TYPES.has(extensionOf(withoutUnsafe) ?? '')
    const name = hasKnownExtension ? withoutUnsafe : `${withoutUnsafe}.txt`
    const record = this.save(bytes, name, textMimeFor(name))
    return { id: record.id, name: record.name, mime: record.mime, size: record.size }
  }

  /** Writes the bytes under a new id, or returns the entry already holding the same bytes. */
  private save(bytes: Uint8Array, name: string, mime: string): UploadRecord {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const existing = this.db.query<UploadRow, [string]>('SELECT id, name, mime, size, thumb_mime, created_at FROM uploads WHERE sha256 = ?').get(sha256)
    if (existing !== null) {
      return toRecord(existing)
    }
    const id = `u_${randomUUID()}`
    mkdirSync(join(this.dir, id), { recursive: true })
    writeFileSync(join(this.dir, id, name), bytes)
    const createdAt = this.now()
    this.db.query('INSERT INTO uploads (id, name, mime, size, sha256, thumb_mime, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)').run(id, name, mime, bytes.byteLength, sha256, createdAt)
    return { id, name, mime, size: bytes.byteLength, createdAt, hasThumbnail: false }
  }

  /** Stores a small preview for an image. The browser makes it; only its size and type are checked here. */
  addThumbnail(id: string, bytes: Uint8Array): void {
    const record = this.get(id)
    if (record === undefined) {
      throw new UploadError(404, 'No such file.')
    }
    if (bytes.byteLength > MAX_THUMBNAIL_BYTES) {
      throw new UploadError(413, 'Thumbnail is too large.')
    }
    const mime = sniffMime(bytes)
    if (mime === null || !THUMBNAIL_MIMES.has(mime) || !record.mime.startsWith('image/')) {
      throw new UploadError(415, 'A thumbnail must be a JPEG or WebP image of an image upload.')
    }
    writeFileSync(join(this.dir, id, THUMBNAIL_FILE), bytes)
    this.db.query('UPDATE uploads SET thumb_mime = ? WHERE id = ?').run(mime, id)
  }

  list(): UploadRecord[] {
    return this.db
      .query<UploadRow, []>('SELECT id, name, mime, size, thumb_mime, created_at FROM uploads ORDER BY created_at DESC, id')
      .all()
      .map(toRecord)
  }

  get(id: string): UploadRecord | undefined {
    const row = this.db.query<UploadRow, [string]>('SELECT id, name, mime, size, thumb_mime, created_at FROM uploads WHERE id = ?').get(id)
    return row === null ? undefined : toRecord(row)
  }

  /** Where the file is on disk; this is the path given to the Session. */
  filePath(record: UploadRecord): string {
    return join(this.dir, record.id, record.name)
  }

  /** The stored preview's type and path, or undefined when there is none. */
  thumbnail(id: string): { mime: string; path: string } | undefined {
    const row = this.db.query<{ thumb_mime: string | null }, [string]>('SELECT thumb_mime FROM uploads WHERE id = ?').get(id)
    if (row === null || row.thumb_mime === null) {
      return undefined
    }
    return { mime: row.thumb_mime, path: join(this.dir, id, THUMBNAIL_FILE) }
  }

  remove(id: string): void {
    const record = this.get(id)
    if (record === undefined) {
      throw new UploadError(404, 'No such file.')
    }
    this.db.query('DELETE FROM uploads WHERE id = ?').run(id)
    rmSync(join(this.dir, id), { recursive: true, force: true })
  }
}
