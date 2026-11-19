import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { MAX_TEXT_BYTES, MAX_UPLOAD_BYTES, TEXT_UPLOAD_TYPES, UploadError, UploadLibrary, isTextUpload, safeFileName, sniffMime } from '../../../src/channel/web/uploads.ts'

test('the type comes from the leading bytes, not from the name', () => {
  expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
  expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
  expect(sniffMime(new TextEncoder().encode('GIF89a....'))).toBe('image/gif')
  expect(sniffMime(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
  expect(sniffMime(new TextEncoder().encode('%PDF-1.4'))).toBe('application/pdf')
  expect(sniffMime(new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).toBeNull()
  expect(sniffMime(new TextEncoder().encode('plain text'))).toBeNull()
})

test('file names keep their basename and safe characters only', () => {
  expect(safeFileName('../../etc/passwd')).toBe('passwd')
  expect(safeFileName('..\\..\\boot.ini')).toBe('boot.ini')
  expect(safeFileName('.hidden.png')).toBe('hidden.png')
  expect(safeFileName('report%20final.pdf')).toBe('report final.pdf')
  expect(safeFileName('weird<>:*?name.png')).toBe('weird_name.png')
  expect(safeFileName('..')).toBe('file')
  expect(safeFileName('   ')).toBe('file')
  expect(safeFileName('a'.repeat(300)).length).toBe(120)
})

function textLibrary(): UploadLibrary {
  return new UploadLibrary(new Database(':memory:'), mkdtempSync(`${tmpdir()}/ra-text-uploads-`))
}

test('addText stores the text and reads it back through filePath', () => {
  const library = textLibrary()
  const ref = library.addText('review', '# Review\n\nLooks good.')
  expect(ref).toMatchObject({ name: 'review.txt', mime: 'text/plain', size: new TextEncoder().encode('# Review\n\nLooks good.').byteLength })
  expect(readFileSync(library.filePath(library.get(ref.id)!), 'utf8')).toBe('# Review\n\nLooks good.')
})

test('addText refuses a blank name, a name over 120 characters, blank text, and text over 64 KB', () => {
  const library = textLibrary()
  expect(() => library.addText('   ', 'text')).toThrow(UploadError)
  expect(() => library.addText('a'.repeat(121), 'text')).toThrow(UploadError)
  expect(() => library.addText('review', '  \n\t ')).toThrow(UploadError)
  expect(() => library.addText('review', 'a'.repeat(MAX_TEXT_BYTES + 1))).toThrow(UploadError)
  expect(library.list()).toEqual([])
})

test('addText accepts text of exactly 64 KB', () => {
  expect(textLibrary().addText('full', 'a'.repeat(MAX_TEXT_BYTES)).size).toBe(MAX_TEXT_BYTES)
})

test('addText replaces unsafe characters in the name and adds .txt when there is no known extension', () => {
  const library = textLibrary()
  expect(library.addText('chat/comments: final', 'x').name).toBe('chat-comments- final.txt')
  expect(library.addText('notes', 'y')).toMatchObject({ name: 'notes.txt', mime: 'text/plain' })
  expect(library.addText('notes.md', 'z')).toMatchObject({ name: 'notes.md', mime: 'text/markdown' })
})

test('addText keeps a known text extension and labels the file from it', () => {
  const library = textLibrary()
  expect(library.addText('a.csv', 'x,y\n1,2')).toMatchObject({ name: 'a.csv', mime: 'text/csv' })
  expect(library.addText('report.pdf', 'text')).toMatchObject({ name: 'report.pdf.txt', mime: 'text/plain' })
})

test('addText returns the existing entry for identical text', () => {
  const library = textLibrary()
  const first = library.addText('one', 'same text')
  const second = library.addText('two', 'same text')
  expect(second.id).toBe(first.id)
  expect(library.list()).toHaveLength(1)
})

function uploadLibrary(): UploadLibrary {
  return new UploadLibrary(new Database(':memory:'), mkdtempSync(`${tmpdir()}/ra-file-uploads-`))
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('add stores text files under the label of their extension', () => {
  const library = uploadLibrary()
  expect(library.add('data.csv', new TextEncoder().encode('a,b\n1,2'))).toMatchObject({ name: 'data.csv', mime: 'text/csv' })
  expect(library.add('config.json', new TextEncoder().encode('{"a": 1}'))).toMatchObject({ mime: 'application/json' })
  expect(library.add('notes.md', new TextEncoder().encode('# Notes'))).toMatchObject({ mime: 'text/markdown' })
  expect(library.add('page.html', new TextEncoder().encode('<p>hi</p>'))).toMatchObject({ mime: 'text/html' })
  expect(library.add('plain.txt', new TextEncoder().encode('plain text'))).toMatchObject({ mime: 'text/plain' })
  expect(library.list()).toHaveLength(5)
})

test('the extension map labels each text type, and other text files get text/plain', () => {
  expect(TEXT_UPLOAD_TYPES.get('tsv')).toBe('text/tab-separated-values')
  expect(TEXT_UPLOAD_TYPES.get('yaml')).toBe('application/yaml')
  expect(TEXT_UPLOAD_TYPES.get('yml')).toBe('application/yaml')
  expect(TEXT_UPLOAD_TYPES.get('xml')).toBe('application/xml')
  expect(TEXT_UPLOAD_TYPES.get('markdown')).toBe('text/markdown')
  expect(TEXT_UPLOAD_TYPES.get('htm')).toBe('text/html')
  expect(TEXT_UPLOAD_TYPES.get('log')).toBe('text/plain')
  expect(uploadLibrary().add('unknown.cfg', new TextEncoder().encode('key = value')).mime).toBe('text/plain')
})

test('add refuses bytes with a NUL byte or invalid UTF-8 with the 415 error', () => {
  const library = uploadLibrary()
  const nul = () => library.add('blob.txt', new Uint8Array([0x61, 0x00, 0x62]))
  const invalid = () => library.add('bad.txt', new Uint8Array([0x61, 0xff, 0xfe]))
  expect(nul).toThrow(UploadError)
  expect(invalid).toThrow(UploadError)
  expect(() => library.add('blob.bin', new Uint8Array([0x00, 0x01]))).toThrow('Only images, PDFs and text files can be uploaded.')
  expect(library.list()).toEqual([])
})

test('add refuses a text file over 10 MB', () => {
  const library = uploadLibrary()
  const big = new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(0x61)
  expect(() => library.add('big.txt', big)).toThrow(UploadError)
  expect(library.list()).toEqual([])
  expect(library.add('exact.txt', new Uint8Array(MAX_UPLOAD_BYTES).fill(0x61)).size).toBe(MAX_UPLOAD_BYTES)
})

test('add still stores a PNG with its image type', () => {
  expect(uploadLibrary().add('shot.png', PNG_SIGNATURE)).toMatchObject({ name: 'shot.png', mime: 'image/png' })
})

test('add refuses a file named as an image or PDF whose bytes are text', () => {
  expect(() => uploadLibrary().add('fake.png', new TextEncoder().encode('just words'))).toThrow(UploadError)
  expect(isTextUpload('fake.pdf', new TextEncoder().encode('just words'))).toBe(false)
  expect(isTextUpload('notes.txt', new TextEncoder().encode('just words'))).toBe(true)
})
