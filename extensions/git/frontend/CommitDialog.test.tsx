import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FileChange } from '../backend/parse.ts'
import { StagedFileList } from './CommitDialog.tsx'

function change(path: string, added: number, removed: number): FileChange {
  return { path, oldPath: null, status: 'modified', added, removed, binary: false }
}

describe('StagedFileList', () => {
  test('lists each staged path with its added and removed counts', () => {
    const markup = renderToStaticMarkup(<StagedFileList staged={[change('src/a.ts', 3, 1), change('README.md', 0, 2)]} />)
    expect(markup).toContain('src/a.ts')
    expect(markup).toContain('+3')
    expect(markup).toContain('README.md')
    expect(markup).toContain('+0')
  })

  test('marks a binary file as binary instead of counts', () => {
    const binary: FileChange = { path: 'logo.png', oldPath: null, status: 'modified', added: null, removed: null, binary: true }
    expect(renderToStaticMarkup(<StagedFileList staged={[binary]} />)).toContain('binary')
  })
})
