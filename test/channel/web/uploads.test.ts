import { expect, test } from 'bun:test'
import { safeFileName, sniffMime } from '../../../src/channel/web/uploads.ts'

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
