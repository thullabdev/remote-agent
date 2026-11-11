import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UploadRecord } from '../../src/channel/web/protocol.ts'
import { UploadPicker } from '../../src/ui/components/upload-picker.tsx'
import type { UploadRef } from '../../src/channel/web/protocol.ts'
import { describeUses } from '../../src/ui/components/library-dialog.tsx'
import { filterUploads, formatSize, insertReference, isReferenced, mentionQuery, pickerOrder, referenceBeforeCaret, referencedAttachments, removeMention, removeReferences, segmentReferences, shortName, uploadUrl } from '../../src/ui/uploads.ts'

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

test('the picker shows an image preview and a PDF icon without a preview, and has no delete', () => {
  const markup = renderToStaticMarkup(createElement(UploadPicker, {
    uploads: [image, pdf],
    query: '',
    selected: 0,
    note: null,
    attachedIds: new Set<string>(),
    attachedCount: 0,
    limit: 5,
    onHover: () => {},
    onPick: () => {},
    onUploadFiles: () => {},
    onManage: () => {},
    onDone: () => {},
  }))
  expect(markup).toContain('src="/api/uploads/u_1?thumb=1"')
  expect(markup).not.toContain('/api/uploads/u_2')
  expect(markup).toContain('spec.pdf')
  expect(markup).not.toContain('Delete')
  expect(markup).toContain('Upload new')
  expect(markup).toContain('Library · 0 of 5 attached')
  expect(markup).toContain('aria-multiselectable="true"')
})

test('an attached file shows a check mark and is marked selected', () => {
  const markup = renderToStaticMarkup(createElement(UploadPicker, {
    uploads: [image, pdf],
    query: '',
    selected: 0,
    note: null,
    attachedIds: new Set(['u_2']),
    attachedCount: 1,
    limit: 5,
    onHover: () => {},
    onPick: () => {},
    onUploadFiles: () => {},
    onManage: () => {},
    onDone: () => {},
    search: { value: '', onChange: () => {} },
  }))
  expect(markup).toContain('aria-label="Attached"')
  expect(markup).toContain('type="search"')
  expect(markup).toContain('Library · 1 of 5 attached')
})

test('attached files come first, in the order they were attached; the rest keep the library order', () => {
  const a = { ...image, id: 'a' }
  const b = { ...image, id: 'b' }
  const c = { ...image, id: 'c' }
  expect(pickerOrder([a, b, c], ['c', 'a']).map(item => item.id)).toEqual(['c', 'a', 'b'])
  expect(pickerOrder([a, b], []).map(item => item.id)).toEqual(['a', 'b'])
})

test('a long name keeps its beginning, its end and its extension', () => {
  expect(shortName('notes.pdf')).toBe('notes.pdf')
  const name = 'Screenshot_20261110_095425_Chrome_profile_draft.png'
  const short = shortName(name)
  expect(short.length).toBeLessThanOrEqual(30)
  expect(short.startsWith('Screenshot_')).toBe(true)
  expect(short.endsWith('_draft.png')).toBe(true)
  expect(short).toContain('…')
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
