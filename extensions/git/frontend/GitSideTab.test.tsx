import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Commit, FileChange } from '../backend/parse.ts'
import type { OpenDiff } from './open-files.ts'
import {
  canCommit,
  commitStaged,
  draftFor,
  GitHeader,
  isCurrentCwd,
  loadGitState,
  NoChatState,
  NoRepositoryState,
  openDiffPanel,
} from './GitSideTab.tsx'

function file(path: string): FileChange {
  return { path, oldPath: null, status: 'modified', added: 1, removed: 0, binary: false }
}

function commit(sha: string): Commit {
  return { sha, shortSha: sha.slice(0, 7), author: 'Ada', at: 1700000000, subject: 'Subject', pushed: true }
}

function text(markup: string): string {
  return markup.replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
}

describe('canCommit', () => {
  test('is false when nothing is staged, even with a message', () => {
    expect(canCommit([], 'Fix the thing')).toBe(false)
  })

  test('is false when the message is blank or only whitespace', () => {
    expect(canCommit([file('a.ts')], '')).toBe(false)
    expect(canCommit([file('a.ts')], '   \n\t')).toBe(false)
  })

  test('is true when something is staged and a message is typed', () => {
    expect(canCommit([file('a.ts')], 'Fix the thing')).toBe(true)
  })
})

describe('draftFor', () => {
  test('keeps the draft while the folder is unchanged', () => {
    expect(draftFor('/repo-a', '/repo-a', 'Fix the thing')).toBe('Fix the thing')
  })

  test('clears the draft when the folder changes', () => {
    expect(draftFor('/repo-a', '/repo-b', 'Fix the thing')).toBe('')
  })

  test('clears the draft when the folder goes away or appears', () => {
    expect(draftFor('/repo-a', null, 'Fix the thing')).toBe('')
    expect(draftFor(null, '/repo-a', 'Fix the thing')).toBe('')
  })
})

describe('isCurrentCwd', () => {
  test('accepts a response for the folder shown now', () => {
    expect(isCurrentCwd('/repo-a', '/repo-a')).toBe(true)
  })

  test('drops a response for a folder that is no longer shown', () => {
    expect(isCurrentCwd('/repo-b', '/repo-a')).toBe(false)
    expect(isCurrentCwd(null, '/repo-a')).toBe(false)
  })
})

describe('commitStaged', () => {
  test('calls commit once, then refreshes status, and returns the result', async () => {
    const calls: string[] = []
    const api = {
      commit: async (cwd: string, message: string) => {
        calls.push(`commit:${cwd}:${message}`)
        return { sha: 'abc1234' }
      },
      status: async (cwd: string) => {
        calls.push(`status:${cwd}`)
        return { staged: [], unstaged: [file('a.ts')] }
      },
    }

    const result = await commitStaged(api, '/repo', 'Fix the thing')

    expect(calls).toEqual(['commit:/repo:Fix the thing', 'status:/repo'])
    expect(result).toEqual({ sha: 'abc1234', status: { staged: [], unstaged: [file('a.ts')] } })
  })

  test('propagates a commit failure without refreshing status', async () => {
    const calls: string[] = []
    const api = {
      commit: async () => {
        calls.push('commit')
        throw new Error('nothing to commit')
      },
      status: async () => {
        calls.push('status')
        return { staged: [], unstaged: [] }
      },
    }

    await expect(commitStaged(api, '/repo', 'msg')).rejects.toThrow('nothing to commit')
    expect(calls).toEqual(['commit'])
  })
})

describe('openDiffPanel', () => {
  test('opens the staged scope and records the open diff for the chat', () => {
    const opened: Array<[string, Record<string, string>]> = []
    const written: Array<[string, OpenDiff]> = []

    openDiffPanel(
      (id, params) => {
        opened.push([id, params ?? {}])
      },
      (chatId, diff) => {
        written.push([chatId, diff])
      },
      { cwd: '/repo', chatId: 'chat-1', path: 'src/a.ts', scope: 'staged' },
    )

    expect(opened).toEqual([['git.diff', { cwd: '/repo', chatId: 'chat-1', path: 'src/a.ts', scope: 'staged' }]])
    expect(written).toEqual([['chat-1', { path: 'src/a.ts', scope: 'staged' }]])
  })

  test('includes the sha for a commit diff', () => {
    const opened: Array<[string, Record<string, string>]> = []
    const written: Array<[string, OpenDiff]> = []

    openDiffPanel(
      (id, params) => {
        opened.push([id, params ?? {}])
      },
      (chatId, diff) => {
        written.push([chatId, diff])
      },
      { cwd: '/repo', chatId: 'chat-1', path: 'src/a.ts', scope: 'commit', sha: 'abc1234' },
    )

    expect(opened).toEqual([['git.diff', { cwd: '/repo', chatId: 'chat-1', path: 'src/a.ts', scope: 'commit', sha: 'abc1234' }]])
    expect(written).toEqual([['chat-1', { path: 'src/a.ts', scope: 'commit', sha: 'abc1234' }]])
  })
})

describe('loadGitState', () => {
  test('loads status and log for the folder and returns both', async () => {
    const calls: string[] = []
    const api = {
      status: async (cwd: string) => {
        calls.push(`status:${cwd}`)
        return { staged: [file('a.ts')], unstaged: [file('b.ts')] }
      },
      log: async (cwd: string) => {
        calls.push(`log:${cwd}`)
        return [commit('abc1234')]
      },
    }

    const state = await loadGitState(api, '/repo')

    expect([...calls].sort()).toEqual(['log:/repo', 'status:/repo'])
    expect(state).toEqual({ status: { staged: [file('a.ts')], unstaged: [file('b.ts')] }, commits: [commit('abc1234')] })
  })
})

describe('GitSideTab markup', () => {
  test('shows the empty state when the chat folder is not a repository', () => {
    expect(text(renderToStaticMarkup(<NoRepositoryState />))).toContain("No git repository in this chat's folder")
  })

  test('shows the prompt to open a chat when there is no active chat', () => {
    expect(text(renderToStaticMarkup(<NoChatState />))).toContain('Open a chat to see its repository')
  })

  test('renders a refresh button in the header', () => {
    const markup = renderToStaticMarkup(<GitHeader onRefresh={() => {}} />)
    expect(markup).toContain('aria-label="Refresh"')
    expect(text(markup)).toContain('Git')
  })
})
