import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DiffHunk, DiffLine } from '../backend/parse.ts'
import {
  DiffView,
  loadDiff,
  nextSelection,
  panelParamsFor,
  rangeAfterTextSelection,
  scopeLabel,
  selectionBounds,
  selectionFromRows,
  selectionLabel,
  type DiffViewProps,
  type FetchDiff,
} from './DiffPanel.tsx'
import { COMMENT_BLOCK_CLASS, CommentEditor, SelectionCommentBar } from './CommentEditor.tsx'
import type { Comment } from './comments.ts'

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

  test('the tab strip is a tablist whose tabs are role tab with aria-selected', () => {
    const html = view({ path: 'b.ts', scope: 'unstaged', tabs: [{ path: 'a.ts', scope: 'unstaged' }, { path: 'b.ts', scope: 'unstaged' }] })
    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html.match(/aria-selected="/g)).toHaveLength(2)
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

describe('DiffView comments', () => {
  const hunks: DiffHunk[] = [{ header: '@@ -1,2 +1,2 @@', lines: [line('removed', '-old', 1, null), line('added', '+new', null, 1), line('meta', '\\ note', null, null)] }]
  const saved: Comment = {
    id: 'c1',
    path: 'src/a.txt',
    scope: 'unstaged',
    side: 'new',
    line: 1,
    lineText: '+new',
    text: 'rename this',
    createdAt: 1,
  }

  test('each commentable line has a gutter button, and meta lines do not', () => {
    const markup = view({ hunks, added: 1, removed: 1, onSelectRow: () => {} })
    expect(markup).toContain('aria-label="Comment on line 1"')
    expect(markup.match(/aria-label="Comment on line/g)?.length).toBe(2)
  })

  test('no gutter button is rendered when comments cannot be made', () => {
    expect(view({ hunks, added: 1, removed: 1 })).not.toContain('Comment on line')
  })

  test('saved comments render under their line with a remove button', () => {
    const markup = view({ hunks, added: 1, removed: 1, comments: [saved], onSelectRow: () => {}, onRemoveComment: () => {} })
    expect(markup).toContain('rename this')
    expect(markup).toContain('aria-label="Remove comment"')
  })

  test('the editor shows under the line being commented on, and the footer shows the count and attach control', () => {
    const markup = view({
      hunks,
      added: 1,
      removed: 1,
      selection: { hunk: 0, anchor: 0, target: 0 },
      onSelectRow: () => {},
      onSaveComment: () => {},
      onCancelComment: () => {},
      commentCount: 0,
      onAttachComments: () => {},
    })
    expect(markup).toContain('aria-label="Comment text"')
    expect(markup.match(/aria-label="Comment text"/g)?.length).toBe(1)
    expect(markup).toContain('Comment on a line first')
    expect(markup).toContain('Attach to chat')
  })

  test('a range comment appears under its last row only', () => {
    const rangeHunks: DiffHunk[] = [{ header: '@@ -1 +1,2 @@', lines: [line('removed', 'alpha', 1, null), line('added', 'beta', null, 1), line('added', 'gamma', null, 2)] }]
    const range: Comment = {
      id: 'r1',
      path: 'src/a.txt',
      scope: 'unstaged',
      side: 'new',
      line: 1,
      endLine: 2,
      lineText: 'beta',
      quote: 'beta\ngamma',
      text: 'range note',
      createdAt: 1,
    }
    const markup = view({ hunks: rangeHunks, added: 2, removed: 1, comments: [range], onSelectRow: () => {}, onRemoveComment: () => {} })
    expect(markup.match(/range note/g)).toHaveLength(1)
    expect(markup.indexOf('range note')).toBeGreaterThan(markup.indexOf('gamma'))
  })

  test('selected rows are highlighted and the editor sits under the last selected row', () => {
    const selectedHunks: DiffHunk[] = [{ header: '@@', lines: [line('context', 'alpha', 1, 1), line('added', 'beta', null, 2), line('added', 'gamma', null, 3)] }]
    const markup = view({ hunks: selectedHunks, added: 2, selection: { hunk: 0, anchor: 2, target: 0 }, onSelectRow: () => {}, onSaveComment: () => {}, onCancelComment: () => {} })
    expect(markup.match(/class="flex bg-muted"/g)).toHaveLength(3)
    expect(markup.match(/aria-label="Comment text"/g)).toHaveLength(1)
    expect(markup.indexOf('aria-label="Comment text"')).toBeGreaterThan(markup.indexOf('gamma'))
  })
})

describe('comment selection rules', () => {
  test('a plain click starts a single-row selection, in any hunk', () => {
    expect(nextSelection(null, 0, 3, false)).toEqual({ hunk: 0, anchor: 3, target: 3 })
    expect(nextSelection({ hunk: 0, anchor: 1, target: 2 }, 0, 5, false)).toEqual({ hunk: 0, anchor: 5, target: 5 })
  })

  test('shift-click extends from the anchor to the clicked row, in either direction', () => {
    expect(nextSelection({ hunk: 0, anchor: 2, target: 2 }, 0, 6, true)).toEqual({ hunk: 0, anchor: 2, target: 6 })
    expect(nextSelection({ hunk: 0, anchor: 4, target: 4 }, 0, 1, true)).toEqual({ hunk: 0, anchor: 4, target: 1 })
    expect(nextSelection({ hunk: 0, anchor: 2, target: 6 }, 0, 3, true)).toEqual({ hunk: 0, anchor: 2, target: 3 })
  })

  test('shift-click in another hunk, or with no selection, starts a new single selection', () => {
    expect(nextSelection({ hunk: 0, anchor: 2, target: 2 }, 1, 6, true)).toEqual({ hunk: 1, anchor: 6, target: 6 })
    expect(nextSelection(null, 0, 6, true)).toEqual({ hunk: 0, anchor: 6, target: 6 })
  })

  test('selectionBounds returns the first and last row in display order', () => {
    expect(selectionBounds({ hunk: 0, anchor: 5, target: 2 })).toEqual({ from: 2, to: 5 })
    expect(selectionBounds({ hunk: 0, anchor: 3, target: 3 })).toEqual({ from: 3, to: 3 })
  })
})

describe('selectionFromRows', () => {
  test('rows in the same hunk give the range between them, in either order', () => {
    expect(selectionFromRows({ hunk: 1, row: 2 }, { hunk: 1, row: 6 }, 9)).toEqual({ hunk: 1, anchor: 2, target: 6 })
    expect(selectionFromRows({ hunk: 1, row: 6 }, { hunk: 1, row: 2 }, 9)).toEqual({ hunk: 1, anchor: 6, target: 2 })
  })

  test('a focus in a later hunk clamps to the last row of the anchor hunk', () => {
    expect(selectionFromRows({ hunk: 0, row: 3 }, { hunk: 2, row: 0 }, 7)).toEqual({ hunk: 0, anchor: 3, target: 7 })
  })

  test('a focus in an earlier hunk clamps to the first row of the anchor hunk', () => {
    expect(selectionFromRows({ hunk: 2, row: 4 }, { hunk: 0, row: 9 }, 7)).toEqual({ hunk: 2, anchor: 4, target: 0 })
  })
})

describe('rangeAfterTextSelection', () => {
  const mapped = { hunk: 0, anchor: 1, target: 3 }

  test('a mapped text selection becomes a pending range', () => {
    expect(rangeAfterTextSelection(null, mapped)).toEqual({ selection: mapped, fromText: true })
  })

  test('a collapsed or off-diff selection clears a pending text range', () => {
    expect(rangeAfterTextSelection({ selection: mapped, fromText: true }, null)).toBeNull()
  })

  test('a collapsed or off-diff selection keeps a range from a gutter button or an opened editor', () => {
    const committed = { selection: mapped, fromText: false }
    expect(rangeAfterTextSelection(committed, null)).toBe(committed)
  })

  test('no range and no mapped selection stays empty', () => {
    expect(rangeAfterTextSelection(null, null)).toBeNull()
  })

  test('the same rows again keep the current range, so an open editor is not reset', () => {
    const committed = { selection: mapped, fromText: false }
    expect(rangeAfterTextSelection(committed, { ...mapped })).toBe(committed)
  })

  test('a new text selection replaces a committed range as a pending one', () => {
    const next = { hunk: 0, anchor: 4, target: 5 }
    expect(rangeAfterTextSelection({ selection: mapped, fromText: false }, next)).toEqual({ selection: next, fromText: true })
  })
})

describe('selectionLabel', () => {
  test('a single numbered row reads as one line', () => {
    expect(selectionLabel([line('context', 'a', 12, 12)])).toBe('Line 12 selected')
  })

  test('a range reads with an en dash between its first and last line numbers', () => {
    const rows = [line('added', 'a', null, 12), line('added', 'b', null, 13), line('added', 'c', null, 18)]
    expect(selectionLabel(rows)).toBe('Lines 12–18 selected')
  })

  test('rows with no line numbers say so', () => {
    expect(selectionLabel([line('meta', '\\ note', null, null)])).toBe('No commentable lines selected')
  })
})

describe('DiffView text selection', () => {
  const hunks: DiffHunk[] = [{ header: '@@ -1,2 +1,3 @@', lines: [line('context', 'alpha', 1, 1), line('added', 'beta', null, 2), line('added', 'gamma', null, 3)] }]

  test('each diff row carries its hunk and row index', () => {
    const markup = view({ hunks, added: 1 })
    expect(markup.match(/data-hunk="0"/g)).toHaveLength(3)
    expect(markup).toContain('data-row="0"')
    expect(markup).toContain('data-row="2"')
  })

  test('a pending text range shows the bar with its label and a Comment button, and no editor yet', () => {
    const markup = view({
      hunks,
      added: 2,
      selection: { hunk: 0, anchor: 1, target: 2 },
      selectionPending: true,
      onSelectRow: () => {},
      onSaveComment: () => {},
      onCancelComment: () => {},
      onCommentSelection: () => {},
    })
    expect(markup).toContain('Lines 2–3 selected')
    expect(markup).toContain('>Comment</button>')
    expect(markup).not.toContain('aria-label="Comment text"')
  })

  test('the bar is not shown for a committed range', () => {
    const markup = view({ hunks, added: 2, selection: { hunk: 0, anchor: 1, target: 2 }, onSelectRow: () => {}, onSaveComment: () => {} })
    expect(markup).not.toContain('selected</span>')
    expect(markup).toContain('aria-label="Comment text"')
  })
})

describe('comment block and card classes', () => {
  test('the block indents only from md up and has no fixed phone width', () => {
    const classes = COMMENT_BLOCK_CLASS.split(' ')
    expect(classes).toContain('md:pl-[7.25rem]')
    expect(classes).toContain('md:w-[40rem]')
    expect(classes.some(name => name === 'pl-[7.25rem]' || name === 'w-[40rem]')).toBe(false)
    expect(classes).toContain('mx-3')
  })

  test('the editor is a card with a borderless transparent textarea, a round Save and a ghost Cancel', () => {
    const markup = renderToStaticMarkup(<CommentEditor onSave={() => {}} onCancel={() => {}} />)
    expect(markup).toContain('rounded-3xl bg-card')
    expect(markup).toContain('bg-transparent')
    expect(markup).toContain('resize-none')
    expect(markup).toContain('size-9 shrink-0 rounded-full')
    expect(markup).toContain('aria-label="Save comment"')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toMatch(/aria-label="Save comment" title="Save comment" disabled=""/)
  })

  test('the selection bar uses the muted pill and a disabled Comment button when no row has a line number', () => {
    const markup = renderToStaticMarkup(<SelectionCommentBar label="No commentable lines selected" disabled onComment={() => {}} />)
    expect(markup).toContain('rounded-full bg-card')
    expect(markup).toMatch(/disabled=""[^>]*>Comment</)
  })
})
