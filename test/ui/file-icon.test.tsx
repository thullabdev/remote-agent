import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileTile, FileTypeIcon } from '../../src/ui/components/file-icon.tsx'

test('the file icon renders the lucide icon for its file, sized by className', () => {
  expect(renderToStaticMarkup(createElement(FileTypeIcon, { name: 'a.csv', mime: 'text/csv', className: 'size-4' }))).toContain('class="lucide lucide-file-spreadsheet size-4"')
  expect(renderToStaticMarkup(createElement(FileTypeIcon, { name: 'shot.png', mime: 'image/png', className: 'size-4' }))).toContain('class="lucide lucide-file-image size-4"')
  expect(renderToStaticMarkup(createElement(FileTypeIcon, { name: 'spec.pdf', mime: 'application/pdf', className: 'size-4' }))).toContain('class="lucide lucide-file-text size-4"')
  expect(renderToStaticMarkup(createElement(FileTypeIcon, { name: 'data.bin', mime: 'text/plain', className: 'size-4' }))).toContain('class="lucide lucide-file size-4"')
})

test('a text file tile shows its icon on a muted square and no image', () => {
  const markup = renderToStaticMarkup(createElement(FileTile, { name: 'page.html', mime: 'text/html' }))
  expect(markup).toContain('size-12')
  expect(markup).toContain('lucide-file-code')
  expect(markup).not.toContain('<img')
})
