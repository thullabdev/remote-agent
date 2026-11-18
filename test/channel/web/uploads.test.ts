import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { MAX_TEXT_BYTES, UploadError, UploadLibrary, safeFileName, sniffMime } from '../../../src/channel/web/uploads.ts'

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
  expect(ref).toMatchObject({ name: 'review.md', mime: 'text/markdown', size: new TextEncoder().encode('# Review\n\nLooks good.').byteLength })
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

test('addText replaces unsafe characters in the name and ends it in .md', () => {
  const library = textLibrary()
  expect(library.addText('chat/comments: final', 'x').name).toBe('chat-comments- final.md')
  expect(library.addText('notes.md', 'y').name).toBe('notes.md')
})

test('addText returns the existing entry for identical text', () => {
  const library = textLibrary()
  const first = library.addText('one', 'same text')
  const second = library.addText('two', 'same text')
  expect(second.id).toBe(first.id)
  expect(library.list()).toHaveLength(1)
})
