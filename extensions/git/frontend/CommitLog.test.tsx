import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Commit, FileChange } from '../backend/parse.ts'
import { CommitLog, commitLogRows } from './CommitLog.tsx'

function file(path: string): FileChange {
  return { path, oldPath: null, status: 'modified', added: 1, removed: 0, binary: false }
}

function commit(sha: string): Commit {
  return { sha, shortSha: sha.slice(0, 7), author: 'Ada', at: 1700000000, subject: `Subject ${sha}`, pushed: true }
}

describe('commitLogRows', () => {
  test('a closed commit is one row', () => {
    const rows = commitLogRows([commit('aaa1111')], new Set(), new Map(), new Set())
    expect(rows.map((row) => row.kind)).toEqual(['commit'])
    expect(rows[0]?.kind === 'commit' && rows[0].open).toBe(false)
  })

  test('an open commit shows its files inline after it, indented by the tree', () => {
    const rows = commitLogRows(
      [commit('aaa1111'), commit('bbb2222')],
      new Set(['aaa1111']),
      new Map([['aaa1111', { status: 'ready', files: [file('src/a.ts'), file('z.md')] }]]),
      new Set(),
    )
    expect(rows.map((row) => row.key)).toEqual([
      'commit:aaa1111',
      'aaa1111/folder:src',
      'aaa1111/file:src/a.ts',
      'aaa1111/file:z.md',
      'commit:bbb2222',
    ])
  })

  test('an open commit whose files are loading or failed shows a note', () => {
    const loading = commitLogRows([commit('aaa1111')], new Set(['aaa1111']), new Map(), new Set())
    expect(loading.map((row) => row.kind)).toEqual(['commit', 'note'])
    expect(loading[1]?.kind === 'note' && loading[1].text).toBe('Loading files…')

    const failed = commitLogRows([commit('aaa1111')], new Set(['aaa1111']), new Map([['aaa1111', { status: 'error' }]]), new Set())
    expect(failed[1]?.kind === 'note' && failed[1].tone).toBe('error')
  })

  test('a collapsed folder inside an open commit hides its files', () => {
    const rows = commitLogRows(
      [commit('aaa1111')],
      new Set(['aaa1111']),
      new Map([['aaa1111', { status: 'ready', files: [file('src/a.ts')] }]]),
      new Set(['aaa1111/folder:src']),
    )
    expect(rows.map((row) => row.key)).toEqual(['commit:aaa1111', 'aaa1111/folder:src'])
  })
})

describe('CommitLog markup', () => {
  test('renders only a window of a long log', () => {
    const commits = Array.from({ length: 1000 }, (_, index) => commit(`sha${String(index).padStart(4, '0')}`))
    const markup = renderToStaticMarkup(<CommitLog commits={commits} cwd="/repo" onOpen={() => {}} />)
    const rendered = markup.match(/role="listitem"/g)?.length ?? 0
    expect(rendered).toBeGreaterThanOrEqual(5)
    expect(rendered).toBeLessThanOrEqual(20)
  })

  test('an empty log says so', () => {
    expect(renderToStaticMarkup(<CommitLog commits={[]} cwd="/repo" onOpen={() => {}} />)).toContain('No commits yet')
  })
})
