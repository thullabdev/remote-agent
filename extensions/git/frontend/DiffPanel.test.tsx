import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DiffHunk, DiffLine } from '../backend/parse.ts'
import { DiffView, loadDiff, type DiffViewProps, type FetchDiff } from './DiffPanel.tsx'

function line(kind: DiffLine['kind'], text: string, oldLine: number | null, newLine: number | null): DiffLine {
  return { kind, oldLine, newLine, text }
}

function view(overrides: Partial<DiffViewProps>): string {
  const props: DiffViewProps = {
    path: 'src/a.txt',
    added: 0,
    removed: 0,
    binary: false,
    hunks: [],
    showAll: false,
    onShowAll: () => {},
    onClose: () => {},
    ...overrides,
  }
  return renderToStaticMarkup(<DiffView {...props} />)
}

describe('loadDiff', () => {
  test('passes cwd, path, scope and sha through to fetchDiff and returns its result', async () => {
    const calls: unknown[][] = []
    const fetchDiff: FetchDiff = async (...args) => {
      calls.push(args)
      return { binary: false, hunks: [] }
    }

    const result = await loadDiff(fetchDiff, { cwd: '/repo', path: 'a.ts', scope: 'commit', sha: 'abc123' })
    expect(calls).toEqual([['/repo', 'a.ts', 'commit', 'abc123']])
    expect(result).toEqual({ binary: false, hunks: [] })
  })

  test('passes an absent sha as undefined', async () => {
    const calls: unknown[][] = []
    const fetchDiff: FetchDiff = async (...args) => {
      calls.push(args)
      return { binary: true, hunks: [] }
    }

    await loadDiff(fetchDiff, { cwd: '/repo', path: 'img.png', scope: 'unstaged' })
    expect(calls).toEqual([['/repo', 'img.png', 'unstaged', undefined]])
  })

  test('propagates a rejection from fetchDiff', async () => {
    const fetchDiff: FetchDiff = async () => {
      throw new Error('boom')
    }

    await expect(loadDiff(fetchDiff, { cwd: '/repo', path: 'a.ts', scope: 'staged' })).rejects.toThrow('boom')
  })
})

describe('DiffView', () => {
  test('header shows the path and counts', () => {
    const hunks: DiffHunk[] = [
      {
        header: '@@ -1,2 +1,3 @@',
        lines: [line('context', 'keep', 1, 1), line('removed', 'old', 2, null), line('added', 'new one', null, 2), line('added', 'new two', null, 3)],
      },
    ]

    const html = view({ path: 'src/a.txt', added: 2, removed: 1, hunks })
    expect(html).toContain('src/a.txt')
    expect(html).toContain('+2')
    expect(html).toContain('−1')
  })

  test('a binary file shows the binary message and no hunks', () => {
    const html = view({ path: 'img/logo.png', binary: true, hunks: [{ header: '@@', lines: [line('added', 'x', null, 1)] }] })
    expect(html).toContain('Binary file: no text diff')
    expect(html).not.toContain('<pre')
    expect(html).not.toContain('data-diff-line')
  })

  test('truncates after 2,000 lines and shows Show all', () => {
    const lines: DiffLine[] = []
    for (let index = 1; index <= 2500; index += 1) {
      lines.push(line('added', `row ${index}`, null, index))
    }
    const hunks: DiffHunk[] = [{ header: '@@ -0,0 +1,2500 @@', lines }]

    const truncated = view({ added: 2500, hunks, showAll: false })
    expect(truncated.match(/data-diff-line/g)).toHaveLength(2000)
    expect(truncated).toContain('Show all')

    const full = view({ added: 2500, hunks, showAll: true })
    expect(full.match(/data-diff-line/g)).toHaveLength(2500)
    expect(full).not.toContain('Show all')
  })

  test('renders the escaped fallback text for lines before highlighting', () => {
    const hunks: DiffHunk[] = [{ header: '@@', lines: [line('added', '<b>"x" & y</b>', null, 1)] }]
    const html = view({ added: 1, hunks })
    expect(html).toContain('&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;')
    expect(html).not.toContain('<b>')
  })
})
