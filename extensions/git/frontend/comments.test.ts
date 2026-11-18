import { describe, expect, test } from 'bun:test'
import type { OpenStateStorage } from '../../../src/ui/components/ui/accordion-state.ts'
import type { UploadRef } from '../../../src/channel/web/protocol.ts'
import type { DiffLine } from '../backend/parse.ts'
import {
  addComment,
  anchorForLine,
  anchorForRange,
  attachComments,
  attachmentName,
  attachmentProblem,
  buildCommentsMarkdown,
  clearComments,
  COMMENTS_STORAGE_KEY,
  commentsForRow,
  type Comment,
  MAX_ATTACH_BYTES,
  readComments,
  removeComment,
  utf8ByteLength,
} from './comments.ts'

function memoryStorage(): OpenStateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

function throwingStorage(): OpenStateStorage {
  return {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  }
}

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    path: 'src/a.ts',
    scope: 'unstaged',
    side: 'new',
    line: 3,
    lineText: '+const x = 1',
    text: 'rename x',
    createdAt: 1000,
    ...overrides,
  }
}

function line(kind: DiffLine['kind'], oldLine: number | null, newLine: number | null, text = 'x'): DiffLine {
  return { kind, oldLine, newLine, text }
}

describe('comment store', () => {
  test('add, read, remove and clear keep the comments of one chat', () => {
    const storage = memoryStorage()
    const first = comment({ id: 'a' })
    const second = comment({ id: 'b', line: 9 })

    expect(addComment(storage, 'chat-1', first)).toEqual([first])
    expect(addComment(storage, 'chat-1', second)).toEqual([first, second])
    expect(readComments(storage, 'chat-1')).toEqual([first, second])

    expect(removeComment(storage, 'chat-1', 'a')).toEqual([second])
    expect(readComments(storage, 'chat-1')).toEqual([second])

    expect(clearComments(storage, 'chat-1')).toEqual([])
    expect(readComments(storage, 'chat-1')).toEqual([])
  })

  test('the store is one JSON object under the versioned key, keyed by chat', () => {
    const storage = memoryStorage()
    addComment(storage, 'chat-1', comment({ id: 'a' }))
    const stored = JSON.parse(storage.data.get(COMMENTS_STORAGE_KEY) ?? 'null') as Record<string, Comment[]>
    expect(Object.keys(stored)).toEqual(['chat-1'])
    expect(stored['chat-1']?.[0]?.id).toBe('a')
  })

  test('comments are isolated per chat', () => {
    const storage = memoryStorage()
    addComment(storage, 'chat-1', comment({ id: 'a' }))
    addComment(storage, 'chat-2', comment({ id: 'b' }))

    expect(readComments(storage, 'chat-1').map(item => item.id)).toEqual(['a'])
    expect(readComments(storage, 'chat-2').map(item => item.id)).toEqual(['b'])

    clearComments(storage, 'chat-1')
    expect(readComments(storage, 'chat-2').map(item => item.id)).toEqual(['b'])
  })

  test('a throwing store reads as empty and writes still return the new list', () => {
    const storage = throwingStorage()
    expect(readComments(storage, 'chat-1')).toEqual([])
    expect(addComment(storage, 'chat-1', comment({ id: 'a' })).map(item => item.id)).toEqual(['a'])
    expect(removeComment(storage, 'chat-1', 'a')).toEqual([])
    expect(clearComments(storage, 'chat-1')).toEqual([])
  })

  test('a throwing store does not wipe other chats when a write is attempted', () => {
    const storage = memoryStorage()
    addComment(storage, 'chat-2', comment({ id: 'kept' }))
    const readFails: OpenStateStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: (key, value) => storage.setItem(key, value),
    }
    addComment(readFails, 'chat-1', comment({ id: 'a' }))
    expect(readComments(storage, 'chat-2').map(item => item.id)).toEqual(['kept'])
  })

  test('null storage (no window) reads as empty and writes nothing', () => {
    expect(readComments(null, 'chat-1')).toEqual([])
    expect(addComment(null, 'chat-1', comment({ id: 'a' })).map(item => item.id)).toEqual(['a'])
  })

  test('malformed entries are dropped on read', () => {
    const storage = memoryStorage()
    const valid = comment({ id: 'ok' })
    const commitNoSha = { ...comment({ id: 'bad-commit' }), scope: 'commit' }
    const badSide = { ...comment({ id: 'bad-side' }), side: 'left' }
    const badLine = { ...comment({ id: 'bad-line' }), line: 0 }
    const badText = { ...comment({ id: 'bad-text' }), text: 4 }
    const badScope = { ...comment({ id: 'bad-scope' }), scope: 'branch' }
    storage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify({ 'chat-1': [valid, commitNoSha, badSide, badLine, badText, badScope, null, 'x'] }))

    expect(readComments(storage, 'chat-1')).toEqual([valid])
  })

  test('a corrupt store or a non-array chat entry reads as empty', () => {
    const corrupt = memoryStorage()
    corrupt.setItem(COMMENTS_STORAGE_KEY, '{not json')
    expect(readComments(corrupt, 'chat-1')).toEqual([])

    const notArray = memoryStorage()
    notArray.setItem(COMMENTS_STORAGE_KEY, JSON.stringify({ 'chat-1': 'oops' }))
    expect(readComments(notArray, 'chat-1')).toEqual([])
  })

  test('a commit comment keeps its sha', () => {
    const storage = memoryStorage()
    const commitComment = comment({ id: 'k', scope: 'commit', sha: 'abc1234def' })
    addComment(storage, 'chat-1', commitComment)
    expect(readComments(storage, 'chat-1')).toEqual([commitComment])
  })
})

describe('commentsForRow', () => {
  const comments = [
    comment({ id: 'new3', line: 3, side: 'new' }),
    comment({ id: 'old3', line: 3, side: 'old' }),
    comment({ id: 'other-file', path: 'src/b.ts', line: 3 }),
    comment({ id: 'staged', scope: 'staged', line: 3 }),
    comment({ id: 'commit-a', scope: 'commit', sha: 'aaa', line: 3 }),
    comment({ id: 'commit-b', scope: 'commit', sha: 'bbb', line: 3 }),
  ]

  test('matches path, scope, sha, side and line exactly', () => {
    const row = (side: 'new' | 'old', line: number) => ({ side, line, lineText: 'x' })
    expect(commentsForRow(comments, 'src/a.ts', 'unstaged', undefined, row('new', 3)).map(item => item.id)).toEqual(['new3'])
    expect(commentsForRow(comments, 'src/a.ts', 'unstaged', undefined, row('old', 3)).map(item => item.id)).toEqual(['old3'])
    expect(commentsForRow(comments, 'src/a.ts', 'staged', undefined, row('new', 3)).map(item => item.id)).toEqual(['staged'])
    expect(commentsForRow(comments, 'src/a.ts', 'commit', 'aaa', row('new', 3)).map(item => item.id)).toEqual(['commit-a'])
    expect(commentsForRow(comments, 'src/a.ts', 'unstaged', undefined, row('new', 4))).toEqual([])
  })

  test('a range is shown under its last row only, on its side', () => {
    const range = comment({ id: 'range', side: 'new', line: 12, endLine: 18, quote: 'a\nb' })
    const row = (side: 'new' | 'old', line: number) => ({ side, line, lineText: 'x' })
    const shownUnder = (line: number, side: 'new' | 'old' = 'new') =>
      commentsForRow([range], 'src/a.ts', 'unstaged', undefined, row(side, line)).map(item => item.id)

    expect(shownUnder(18)).toEqual(['range'])
    expect(shownUnder(12)).toEqual([])
    expect(shownUnder(15)).toEqual([])
    expect(shownUnder(18, 'old')).toEqual([])
  })

  test('a range with endLine equal to line behaves as a single line on that number', () => {
    const range = comment({ id: 'same', side: 'new', line: 5, endLine: 5, quote: 'x' })
    expect(commentsForRow([range], 'src/a.ts', 'unstaged', undefined, { side: 'new', line: 5, lineText: 'x' }).map(item => item.id)).toEqual(['same'])
  })
})

describe('anchorForRange', () => {
  test('a single row gives the single-line anchor with no endLine or quote', () => {
    expect(anchorForRange([line('added', null, 7, 'new')])).toEqual({ side: 'new', line: 7, lineText: 'new' })
  })

  test('new-side rows anchor on the first and last new-side numbers, skipping removed rows', () => {
    const anchor = anchorForRange([line('removed', 4, null, 'gone'), line('added', null, 4, 'four'), line('context', 5, 5, 'five'), line('added', null, 6, 'six')])
    expect(anchor).toEqual({ side: 'new', line: 4, endLine: 6, lineText: 'gone', quote: 'gone\nfour\nfive\nsix' })
  })

  test('when no row has a new-side number the range anchors on the old side', () => {
    const anchor = anchorForRange([line('removed', 9, null, 'a'), line('removed', 10, null, 'b')])
    expect(anchor).toEqual({ side: 'old', line: 9, endLine: 10, lineText: 'a', quote: 'a\nb' })
  })

  test('a range that starts with a removed row still takes the first new-side number', () => {
    const anchor = anchorForRange([line('removed', 2, null, 'x'), line('added', null, 2, 'y')])
    expect(anchor?.side).toBe('new')
    expect(anchor?.line).toBe(2)
  })

  test('meta rows add no numbers and are kept in the quote', () => {
    const anchor = anchorForRange([line('added', null, 3, 'a'), line('meta', null, null, '\\ No newline'), line('added', null, 4, 'b')])
    expect(anchor).toEqual({ side: 'new', line: 3, endLine: 4, lineText: 'a', quote: 'a\n\\ No newline\nb' })
  })
})

describe('range comments', () => {
  const range = comment({ id: 'r1', line: 12, endLine: 18, quote: 'first\nsecond', lineText: 'first', text: 'split these' })

  test('the label of a new-side range is path:new 12-18, and an old-side range is path:old 12-18', () => {
    expect(buildCommentsMarkdown([range], 'main')).toContain('### src/a.ts:new 12-18\n')
    const old = { ...range, side: 'old' as const }
    expect(buildCommentsMarkdown([old], 'main')).toContain('### src/a.ts:old 12-18\n')
  })

  test('a single line keeps the plain label, and a range whose endLine equals line reads as one line', () => {
    expect(buildCommentsMarkdown([comment({ line: 12 })], 'main')).toContain('### src/a.ts:12\n')
    expect(buildCommentsMarkdown([{ ...range, endLine: 12 }], 'main')).toContain('### src/a.ts:12\n')
  })

  test('the quote is fenced in place of the single line', () => {
    const markdown = buildCommentsMarkdown([range], 'main')
    expect(markdown).toContain('```\nfirst\nsecond\n```\n\nsplit these\n')
  })

  test('a stored range comment round-trips with its endLine and quote', () => {
    const storage = memoryStorage()
    addComment(storage, 'chat-1', range)
    expect(readComments(storage, 'chat-1')).toEqual([range])
  })

  test('an old single-line entry without endLine or quote still reads', () => {
    const storage = memoryStorage()
    const legacy: Comment = { id: 'legacy', path: 'src/a.ts', scope: 'unstaged', side: 'new', line: 3, lineText: '+x', text: 'old note', createdAt: 5 }
    storage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify({ 'chat-1': [legacy] }))
    expect(readComments(storage, 'chat-1')).toEqual([legacy])
    expect(buildCommentsMarkdown(readComments(storage, 'chat-1'), 'main')).toContain('### src/a.ts:3\n')
  })

  test('a range with a non-integer endLine or a non-string quote is dropped on read', () => {
    const storage = memoryStorage()
    storage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify({ 'chat-1': [{ ...range, id: 'bad-end', endLine: 'x' }, { ...range, id: 'bad-quote', quote: 4 }] }))
    expect(readComments(storage, 'chat-1')).toEqual([])
  })
})

describe('anchorForLine', () => {
  test('removed lines anchor on the old side, added and context lines on the new side', () => {
    expect(anchorForLine(line('removed', 5, null, '-old'))).toEqual({ side: 'old', line: 5, lineText: '-old' })
    expect(anchorForLine(line('added', null, 7, '+new'))).toEqual({ side: 'new', line: 7, lineText: '+new' })
    expect(anchorForLine(line('context', 2, 2, ' same'))).toEqual({ side: 'new', line: 2, lineText: ' same' })
  })

  test('meta lines and lines without a number on their side have no anchor', () => {
    expect(anchorForLine(line('meta', null, null, '\\ No newline'))).toBeNull()
    expect(anchorForLine(line('removed', null, null, '-x'))).toBeNull()
    expect(anchorForLine(line('added', null, null, '+x'))).toBeNull()
  })
})

describe('buildCommentsMarkdown', () => {
  test('starts with the title and branch, groups by path and orders by line', () => {
    const markdown = buildCommentsMarkdown(
      [
        comment({ id: 'b2', path: 'src/b.ts', line: 1, text: 'b first' }),
        comment({ id: 'a9', line: 9, text: 'later' }),
        comment({ id: 'a2', line: 2, text: 'earlier' }),
      ],
      'feat/x',
    )

    expect(markdown).toBe(
      [
        '# Review comments',
        '',
        'Branch: feat/x',
        '',
        '## src/a.ts',
        '',
        '### src/a.ts:2',
        '',
        'scope: unstaged',
        '',
        '```',
        '+const x = 1',
        '```',
        '',
        'earlier',
        '',
        '### src/a.ts:9',
        '',
        'scope: unstaged',
        '',
        '```',
        '+const x = 1',
        '```',
        '',
        'later',
        '',
        '## src/b.ts',
        '',
        '### src/b.ts:1',
        '',
        'scope: unstaged',
        '',
        '```',
        '+const x = 1',
        '```',
        '',
        'b first',
        '',
      ].join('\n'),
    )
  })

  test('anchor formats: new side is path:line, old side is path:old line, commit scope shows the short sha', () => {
    const markdown = buildCommentsMarkdown(
      [
        comment({ id: 'o', side: 'old', line: 12, scope: 'staged', text: 'removed' }),
        comment({ id: 'c', scope: 'commit', sha: 'abcdef1234567', line: 4, text: 'commit' }),
      ],
      null,
    )

    expect(markdown).toContain('Branch: detached\n')
    expect(markdown).toContain('### src/a.ts:old 12\n')
    expect(markdown).toContain('scope: staged\n')
    expect(markdown).toContain('### src/a.ts:4\n')
    expect(markdown).toContain('scope: commit abcdef1\n')
  })

  test('a blank branch reads as detached', () => {
    expect(buildCommentsMarkdown([], '')).toContain('Branch: detached')
  })

  test('the fence is longer than any backtick run in the quoted line', () => {
    const markdown = buildCommentsMarkdown([comment({ lineText: '+const s = "```"' })], 'main')
    expect(markdown).toContain('````\n+const s = "```"\n````\n')
  })

  test('is deterministic regardless of input order', () => {
    const one = comment({ id: 'one', line: 1 })
    const two = comment({ id: 'two', line: 2 })
    expect(buildCommentsMarkdown([two, one], 'main')).toBe(buildCommentsMarkdown([one, two], 'main'))
  })
})

describe('attachment helpers', () => {
  test('attachmentName uses the local date and a file-name-safe branch', () => {
    const now = new Date(2026, 10, 18, 9, 30)
    expect(attachmentName('feat/git-extension', now)).toBe('review-comments-2026-11-18-feat-git-extension.md')
    expect(attachmentName(null, now)).toBe('review-comments-2026-11-18-detached.md')
    expect(attachmentName('a b:c', now)).toBe('review-comments-2026-11-18-a-b-c.md')
  })

  test('utf8ByteLength counts bytes, not characters', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('é')).toBe(2)
  })

  test('attachmentProblem refuses more than 200 comments and text over 64 KB', () => {
    expect(attachmentProblem(200, 'x')).toBeNull()
    expect(attachmentProblem(201, 'x')).toContain('201')
    expect(attachmentProblem(1, 'x'.repeat(MAX_ATTACH_BYTES))).toBeNull()
    expect(attachmentProblem(1, 'x'.repeat(MAX_ATTACH_BYTES + 1))).toContain('too long')
  })
})

describe('attachComments', () => {
  const ref: UploadRef = { id: 'u1', name: 'review-comments.md', mime: 'text/markdown', size: 10 }

  test('uploads the markdown, attaches it to the chat and reports attached', async () => {
    const uploads: Array<{ name: string; text: string }> = []
    const attached: Array<{ chatId: string; ref: UploadRef }> = []
    const outcome = await attachComments({
      chatId: 'chat-1',
      comments: [comment()],
      branch: 'main',
      now: new Date(2026, 10, 18),
      upload: async (name, text) => {
        uploads.push({ name, text })
        return ref
      },
      open: () => {},
      attach: (chatId, upload) => {
        attached.push({ chatId, ref: upload })
        return true
      },
    })

    expect(outcome).toEqual({ status: 'attached' })
    expect(uploads).toHaveLength(1)
    expect(uploads[0]?.name).toBe('review-comments-2026-11-18-main.md')
    expect(uploads[0]?.text).toContain('rename x')
    expect(attached).toEqual([{ chatId: 'chat-1', ref }])
  })

  test('when no composer is mounted, the attachment waits and the chat is brought into view', async () => {
    const opened: string[] = []
    const outcome = await attachComments({
      chatId: 'chat-1',
      comments: [comment()],
      branch: 'main',
      now: new Date(),
      upload: async () => ref,
      attach: () => false,
      open: chatId => opened.push(chatId),
    })
    expect(outcome).toEqual({ status: 'attached' })
    expect(opened).toEqual(['chat-1'])
  })

  test('reports failed with the upload error, and does not attach', async () => {
    let attachCalls = 0
    const outcome = await attachComments({
      chatId: 'chat-1',
      comments: [comment()],
      branch: 'main',
      now: new Date(),
      upload: async () => {
        throw new Error('Upload too large')
      },
      open: () => {},
      attach: () => {
        attachCalls += 1
        return true
      },
    })
    expect(outcome).toEqual({ status: 'failed', message: 'Upload too large' })
    expect(attachCalls).toBe(0)
  })

  test('refuses without uploading when there are no comments or the cap is exceeded', async () => {
    let uploadCalls = 0
    const deps = {
      chatId: 'chat-1',
      branch: 'main',
      now: new Date(),
      upload: async () => {
        uploadCalls += 1
        return ref
      },
      attach: () => true,
      open: () => {},
    }

    expect(await attachComments({ ...deps, comments: [] })).toEqual({ status: 'refused', message: 'There are no comments to attach.' })
    const many = Array.from({ length: 201 }, (_, index) => comment({ id: `c${index}` }))
    const refused = await attachComments({ ...deps, comments: many })
    expect(refused.status).toBe('refused')
    expect(uploadCalls).toBe(0)
  })
})
