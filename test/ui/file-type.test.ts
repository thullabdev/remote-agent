import { expect, test } from 'bun:test'
import { fileIconKey } from '../../src/ui/file-type.ts'
import { TEXT_UPLOAD_EXTENSIONS } from '../../src/ui/uploads.ts'

test('images and PDFs are chosen by their mime', () => {
  expect(fileIconKey('shot.png', 'image/png')).toBe('image')
  expect(fileIconKey('scan.jpg', 'image/jpeg')).toBe('image')
  expect(fileIconKey('spec.pdf', 'application/pdf')).toBe('document')
})

test('each text extension maps to its icon key', () => {
  expect(fileIconKey('a.md', '')).toBe('document')
  expect(fileIconKey('a.markdown', '')).toBe('document')
  expect(fileIconKey('a.txt', '')).toBe('document')
  expect(fileIconKey('a.log', '')).toBe('document')
  expect(fileIconKey('a.html', '')).toBe('web')
  expect(fileIconKey('a.htm', '')).toBe('web')
  expect(fileIconKey('a.csv', '')).toBe('table')
  expect(fileIconKey('a.tsv', '')).toBe('table')
  expect(fileIconKey('a.json', '')).toBe('json')
  expect(fileIconKey('a.yaml', '')).toBe('code')
  expect(fileIconKey('a.yml', '')).toBe('code')
  expect(fileIconKey('a.xml', '')).toBe('code')
})

test('every accepted text extension has an icon other than the generic one', () => {
  for (const extension of TEXT_UPLOAD_EXTENSIONS) {
    expect(fileIconKey(`file.${extension}`, '')).not.toBe('file')
  }
})

test('an unknown extension, or no extension, maps to the generic file icon', () => {
  expect(fileIconKey('archive.zip', 'application/zip')).toBe('file')
  expect(fileIconKey('README', 'text/plain')).toBe('file')
  expect(fileIconKey('data.dat', 'text/plain')).toBe('file')
})

test('extensions match in any case', () => {
  expect(fileIconKey('SHOT.PNG', '')).toBe('image')
  expect(fileIconKey('Data.CSV', '')).toBe('table')
  expect(fileIconKey('Page.HTML', 'text/html')).toBe('web')
  expect(fileIconKey('Notes.Md', 'text/markdown')).toBe('document')
})
