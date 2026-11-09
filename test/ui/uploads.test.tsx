import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UploadRecord } from '../../src/channel/web/protocol.ts'
import { UploadPicker } from '../../src/ui/components/upload-picker.tsx'
import { filterUploads, formatSize, mentionQuery, removeMention, uploadUrl } from '../../src/ui/uploads.ts'

const image: UploadRecord = { id: 'u_1', name: 'diagram.png', mime: 'image/png', size: 2048, createdAt: 1, hasThumbnail: true }
const pdf: UploadRecord = { id: 'u_2', name: 'spec.pdf', mime: 'application/pdf', size: 4 * 1024 * 1024, createdAt: 2, hasThumbnail: false }

test('the @ query is the open token at the end of the text', () => {
  expect(mentionQuery('look @dia')).toBe('dia')
  expect(mentionQuery('@')).toBe('')
  expect(mentionQuery('look at this')).toBeNull()
  expect(mentionQuery('mail me at a@b')).toBeNull()
  expect(mentionQuery('done @dia now')).toBeNull()
})

test('picking removes the open token and keeps the text before it', () => {
  expect(removeMention('look @dia')).toBe('look ')
  expect(removeMention('@')).toBe('')
  expect(removeMention('keep this')).toBe('keep this')
})

test('the picker filters by name, ignoring case', () => {
  expect(filterUploads([image, pdf], 'DIA')).toEqual([image])
  expect(filterUploads([image, pdf], '')).toEqual([image, pdf])
})

test('sizes and upload URLs', () => {
  expect(formatSize(900)).toBe('900 B')
  expect(formatSize(2048)).toBe('2 KB')
  expect(formatSize(4 * 1024 * 1024)).toBe('4.0 MB')
  expect(uploadUrl('u_1', true)).toBe('/api/uploads/u_1?thumb=1')
  expect(uploadUrl('u_1')).toBe('/api/uploads/u_1')
})

test('the picker shows an image preview and a PDF icon without a preview', () => {
  const markup = renderToStaticMarkup(createElement(UploadPicker, {
    uploads: [image, pdf],
    query: '',
    selected: 0,
    note: null,
    onHover: () => {},
    onPick: () => {},
    onDelete: () => {},
    onUploadFiles: () => {},
  }))
  expect(markup).toContain('src="/api/uploads/u_1?thumb=1"')
  expect(markup).not.toContain('/api/uploads/u_2')
  expect(markup).toContain('spec.pdf')
  expect(markup).toContain('aria-label="Delete spec.pdf from the library"')
  expect(markup).toContain('Upload new')
})
