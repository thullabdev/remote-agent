import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UploadRecord } from '../../src/channel/web/protocol.ts'
import { UploadPicker } from '../../src/ui/components/upload-picker.tsx'
import type { UploadRef } from '../../src/channel/web/protocol.ts'
import { describeUses } from '../../src/ui/components/library-dialog.tsx'
import { filterUploads, formatSize, insertReference, isReferenced, mentionQuery, referenceBeforeCaret, referencedAttachments, removeMention, removeReferences, segmentReferences, uploadUrl } from '../../src/ui/uploads.ts'

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
    onManage: () => {},
  }))
  expect(markup).toContain('src="/api/uploads/u_1?thumb=1"')
  expect(markup).toContain('>Manage<')
  expect(markup).not.toContain('/api/uploads/u_2')
  expect(markup).toContain('spec.pdf')
  expect(markup).toContain('aria-label="Delete spec.pdf from the library"')
  expect(markup).toContain('Upload new')
})

test('picking writes a reference in place of the open token, or at the end', () => {
  expect(insertReference('look @dia', 'diagram.png')).toBe('look @diagram.png ')
  expect(insertReference('@', 'spec.pdf')).toBe('@spec.pdf ')
  expect(insertReference('compare', 'diagram.png')).toBe('compare @diagram.png ')
  expect(insertReference('compare ', 'diagram.png')).toBe('compare @diagram.png ')
})

test('detaching a file removes all its references and leaves other text alone', () => {
  expect(removeReferences('see @diagram.png and @diagram.png.bak, then @diagram.png', 'diagram.png')).toBe('see and @diagram.png.bak, then ')
  expect(removeReferences('plain text', 'diagram.png')).toBe('plain text')
})


const diagram: UploadRef = { id: 'u_1', name: 'diagram.png', mime: 'image/png', size: 2048 }
const notes: UploadRef = { id: 'u_3', name: 'notes.pdf', mime: 'application/pdf', size: 900 }

test('a file is attached while its reference stays in the text', () => {
  expect(isReferenced('compare @diagram.png and', 'diagram.png')).toBe(true)
  expect(isReferenced('compare diagram.png', 'diagram.png')).toBe(false)
  expect(referencedAttachments('just words', [diagram])).toEqual([])
  expect(referencedAttachments('@diagram.png', [diagram, notes])).toEqual([diagram])
})

test('the message text splits into plain text and each file it names, in order', () => {
  expect(segmentReferences('see @diagram.png, then @notes.pdf again', [diagram, notes])).toEqual([
    { text: 'see ' },
    { file: diagram },
    { text: ', then ' },
    { file: notes },
    { text: ' again' },
  ])
  expect(segmentReferences('no files here', [diagram])).toEqual([{ text: 'no files here' }])
})

test('Backspace right after a reference takes the whole reference and its space', () => {
  const text = 'compare @diagram.png '
  expect(referenceBeforeCaret(text, text.length, [diagram])).toEqual({ start: 8, end: text.length })
  expect(referenceBeforeCaret('@diagram.png', 12, [diagram])).toEqual({ start: 0, end: 12 })
  expect(referenceBeforeCaret('x@diagram.png', 13, [diagram])).toBeNull()
  expect(referenceBeforeCaret('compare @diagram.png', 10, [diagram])).toBeNull()
})

test('the library says how many messages use each file', () => {
  expect(describeUses(0)).toBe('Not used yet')
  expect(describeUses(1)).toBe('Used in 1 message')
  expect(describeUses(4)).toBe('Used in 4 messages')
})
