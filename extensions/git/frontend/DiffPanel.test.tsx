import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DiffHunk, DiffLine } from '../backend/parse.ts'
import { DiffView, loadDiff, panelParamsFor, scopeLabel, type DiffViewProps, type FetchDiff } from './DiffPanel.tsx'

function line(kind: DiffLine['kind'], text: string, oldLine: number | null, newLine: number | null): DiffLine {
  return { kind, oldLine, newLine, text }
}

function view(overrides: Partial<DiffViewProps>): string {
  const props: DiffViewProps = {
    path: 'src/a.txt',
    scope: 'unstaged',
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

describe('DiffView tabs, footer and background', () => {
  test('a tab shows only the file name, and the footer shows the full path and scope', () => {
    const html = view({ path: 'src/deep/a.ts', scope: 'staged', tabs: [{ path: 'src/deep/a.ts', scope: 'staged' }] })
    expect(html).toContain('>a.ts</button>')
    expect(html.match(/src\/deep\/a\.ts/g)).toHaveLength(1)
    expect(html).toContain('font-mono')
    expect(html).toContain('>staged</span>')
  })

  test('the shown diff is added as a tab when it is not in the list', () => {
    const html = view({ path: 'src/new.ts', scope: 'unstaged', tabs: [{ path: 'src/old.ts', scope: 'unstaged' }] })
    expect(html).toContain('>old.ts</button>')
    expect(html).toContain('>new.ts</button>')
  })

  test('the active tab is marked selected and each tab has a close control', () => {
    const html = view({
      path: 'b.ts',
      scope: 'unstaged',
      tabs: [
        { path: 'a.ts', scope: 'unstaged' },
        { path: 'b.ts', scope: 'unstaged' },
      ],
    })
    expect(html).toMatch(/aria-selected="true"[^>]*>b\.ts<\/button>/)
    expect(html).toMatch(/aria-selected="false"[^>]*>a\.ts<\/button>/)
    expect(html).toContain('aria-label="Close a.ts"')
    expect(html).toContain('aria-label="Close b.ts"')
  })

  test('the panel uses the main background, not the card background', () => {
    const html = view({ path: 'a.ts' })
    expect(html).toContain('bg-background')
    expect(html).not.toContain('bg-card')
  })

  test('the diff code container carries the theme class', () => {
    const hunks: DiffHunk[] = [{ header: '@@', lines: [line('added', 'x', null, 1)] }]
    expect(view({ added: 1, hunks })).toContain('git-diff-code')
  })
})

describe('scopeLabel and panelParamsFor', () => {
  test('scopeLabel shows the short sha for a commit and the scope otherwise', () => {
    expect(scopeLabel('commit', 'abcdef1234567')).toBe('abcdef1')
    expect(scopeLabel('staged')).toBe('staged')
    expect(scopeLabel('unstaged')).toBe('unstaged')
  })

  test('panelParamsFor keeps the chat, the origin and the commit sha', () => {
    expect(panelParamsFor({ path: 'a.ts', scope: 'unstaged' }, { cwd: '/r', chatId: 'c1', from: 'c1' })).toEqual({
      cwd: '/r',
      chatId: 'c1',
      path: 'a.ts',
      scope: 'unstaged',
      from: 'c1',
    })
    expect(panelParamsFor({ path: 'a.ts', scope: 'commit', sha: 'abc' }, { cwd: '/r', chatId: 'c1' })).toEqual({
      cwd: '/r',
      chatId: 'c1',
      path: 'a.ts',
      scope: 'commit',
      sha: 'abc',
    })
  })
})
