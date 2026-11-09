import type { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UploadRecord } from './protocol.ts'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_THUMBNAIL_BYTES = 256 * 1024
export const MAX_ATTACHMENTS = 5

const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])
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

  /** Stores a file. The same bytes uploaded again return the existing entry. */
  add(rawName: string, bytes: Uint8Array): UploadRecord {
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new UploadError(413, 'File is larger than 10 MB.')
    }
    const mime = sniffMime(bytes)
    if (mime === null || !ALLOWED_MIMES.has(mime)) {
      throw new UploadError(415, 'Only PNG, JPEG, GIF, WebP and PDF files can be uploaded.')
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const existing = this.db.query<UploadRow, [string]>('SELECT id, name, mime, size, thumb_mime, created_at FROM uploads WHERE sha256 = ?').get(sha256)
    if (existing !== null) {
      return toRecord(existing)
    }
    const id = `u_${randomUUID()}`
    const name = safeFileName(rawName)
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
