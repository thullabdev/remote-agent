import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Commit, FileChange } from '../backend/parse.ts'
import type { RepoInfo } from '../backend/git.ts'
import type { OpenDiff } from './open-files.ts'
import {
  applyCommitType,
  canCommit,
  COMMIT_TYPES,
  CommitTypeSelect,
  commitHint,
  commitReviewAfterReload,
  commitStaged,
  commitTypeFromOption,
  commitTypeOf,
  ConflictGroup,
  draftFor,
  GitPanel,
  type GitView,
  gitView,
  isCurrentCwd,
  loadGitState,
  openDiffPanel,
  shouldRefreshOnIdle,
  splitConflicts,
  StagedEmptyState,
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

describe('commitHint', () => {
  test('asks for files to be staged when nothing is staged, whatever the message', () => {
    expect(commitHint(0, '')).toBe('Stage files to commit')
    expect(commitHint(0, 'Fix the thing')).toBe('Stage files to commit')
  })

  test('asks for a message when files are staged but the message is blank', () => {
    expect(commitHint(2, '')).toBe('Write a commit message')
    expect(commitHint(2, '   \n')).toBe('Write a commit message')
  })

  test('has no hint when files are staged and a message is typed', () => {
    expect(commitHint(1, 'Fix the thing')).toBeNull()
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

describe('commitReviewAfterReload', () => {
  test('opens the review with exactly the staged files that were just reloaded and the message', () => {
    const reloaded = [file('a.ts'), file('src/b.ts')]
    expect(commitReviewAfterReload(reloaded, 'Fix the thing')).toEqual({ staged: reloaded, message: 'Fix the thing' })
  })

  test('does not open the review when nothing is staged after the reload', () => {
    expect(commitReviewAfterReload([], 'Fix the thing')).toBeNull()
  })

  test('does not open the review when the message is blank', () => {
    expect(commitReviewAfterReload([file('a.ts')], '  ')).toBeNull()
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

describe('commitStaged with expectedPaths', () => {
  test('passes the reviewed paths to commit', async () => {
    const received: Array<[string, string, string[] | undefined]> = []
    const api = {
      commit: async (cwd: string, message: string, expectedPaths?: string[]) => {
        received.push([cwd, message, expectedPaths])
        return { sha: 'abc1234' }
      },
      status: async () => ({ staged: [], unstaged: [] }),
    }

    await commitStaged(api, '/repo', 'Fix the thing', ['a.ts', 'src/b.ts'])

    expect(received).toEqual([['/repo', 'Fix the thing', ['a.ts', 'src/b.ts']]])
  })
})

describe('shouldRefreshOnIdle', () => {
  test('is true only for the busy to idle transition', () => {
    expect(shouldRefreshOnIdle(true, false)).toBe(true)
  })

  test('is false for idle to busy, and for staying busy or idle', () => {
    expect(shouldRefreshOnIdle(false, true)).toBe(false)
    expect(shouldRefreshOnIdle(true, true)).toBe(false)
    expect(shouldRefreshOnIdle(false, false)).toBe(false)
  })
})

describe('applyCommitType', () => {
  test('adds a type prefix to a message that has none, keeping the text', () => {
    expect(applyCommitType('add the thing', 'feat')).toBe('feat: add the thing')
  })

  test('replaces a known prefix with the chosen type', () => {
    expect(applyCommitType('fix: add the thing', 'docs')).toBe('docs: add the thing')
  })

  test('removes a known prefix when the choice is none', () => {
    expect(applyCommitType('chore: tidy', null)).toBe('tidy')
  })

  test('leaves a message without a known prefix unchanged when the choice is none', () => {
    expect(applyCommitType('Fix: not a known type prefix', null)).toBe('Fix: not a known type prefix')
    expect(applyCommitType('add the thing', null)).toBe('add the thing')
  })

  test('keeps a colon in the body as part of the text', () => {
    expect(applyCommitType('fix: handle a: b', 'fix')).toBe('fix: handle a: b')
  })
})

describe('commitTypeOf and commitTypeFromOption', () => {
  test('reads the known type a message starts with', () => {
    expect(commitTypeOf('refactor: split it')).toBe('refactor')
    expect(commitTypeOf('split it')).toBeNull()
    expect(commitTypeOf('refactor split it')).toBeNull()
  })

  test('the empty option is none, and an unknown option is none too', () => {
    expect(commitTypeFromOption('')).toBeNull()
    expect(commitTypeFromOption('bogus')).toBeNull()
    expect(commitTypeFromOption('test')).toBe('test')
    expect(COMMIT_TYPES).toEqual(['feat', 'fix', 'docs', 'refactor', 'test', 'chore'])
  })
})

describe('CommitTypeSelect', () => {
  test('is a labelled native select offering none and every type', () => {
    const markup = renderToStaticMarkup(<CommitTypeSelect message="" onChange={() => {}} />)
    expect(markup).toContain('<span class="shrink-0">Commit type</span>')
    expect(markup).toContain('<select')
    expect(markup).toContain('<option value="" selected="">none</option>')
    for (const type of COMMIT_TYPES) {
      expect(markup).toContain(`<option value="${type}">${type}</option>`)
    }
  })

  test('selects the type the message already starts with', () => {
    expect(renderToStaticMarkup(<CommitTypeSelect message="fix: x" onChange={() => {}} />)).toContain('<option value="fix" selected="">fix</option>')
    expect(renderToStaticMarkup(<CommitTypeSelect message="x" onChange={() => {}} />)).toContain('<option value="" selected="">none</option>')
  })
})

describe('splitConflicts', () => {
  function withStatus(path: string, status: FileChange['status']): FileChange {
    return { path, oldPath: null, status, added: null, removed: null, binary: false }
  }

  test('separates conflicted files from the rest, keeping each in order', () => {
    const files = [withStatus('a.ts', 'modified'), withStatus('b.ts', 'conflicted'), withStatus('c.ts', 'untracked'), withStatus('d.ts', 'conflicted')]
    const result = splitConflicts(files)
    expect(result.conflicted.map((file) => file.path)).toEqual(['b.ts', 'd.ts'])
    expect(result.other.map((file) => file.path)).toEqual(['a.ts', 'c.ts'])
  })

  test('no conflicts gives an empty conflicted list', () => {
    expect(splitConflicts([withStatus('a.ts', 'modified')]).conflicted).toEqual([])
  })
})

describe('ConflictGroup', () => {
  const conflict: FileChange = { path: 'src/merge.ts', oldPath: null, status: 'conflicted', added: null, removed: null, binary: false }

  test('titles the group with its count and gives the resolve hint', () => {
    const markup = renderToStaticMarkup(<ConflictGroup files={[conflict]} onOpen={() => {}} onStage={() => {}} />)
    expect(markup).toContain('Conflicts · 1')
    expect(markup).toContain('Resolve these in your editor, then stage them.')
    expect(markup).toContain('aria-label="Stage src/merge.ts"')
    expect(markup).toContain('src/merge.ts')
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

describe('gitView', () => {
  const repo = { repo: true } as RepoInfo
  const notRepo = { repo: false } as RepoInfo

  test('shows the no-chat view before anything else', () => {
    expect(gitView({ hasChat: false, cwd: '/repo', repo, loadError: 'boom' })).toBe('no-chat')
  })

  test('shows the no-folder view when the chat has no folder', () => {
    expect(gitView({ hasChat: true, cwd: null, repo: null, loadError: null })).toBe('no-folder')
  })

  test('shows the error view when the load failed and no repository is loaded', () => {
    expect(gitView({ hasChat: true, cwd: '/repo', repo: null, loadError: 'cwd does not exist' })).toBe('error')
  })

  test('shows the loading view while the first load is in flight', () => {
    expect(gitView({ hasChat: true, cwd: '/repo', repo: null, loadError: null })).toBe('loading')
  })

  test('shows the not-repo view when the folder is not a repository', () => {
    expect(gitView({ hasChat: true, cwd: '/repo', repo: notRepo, loadError: null })).toBe('not-repo')
  })

  test('shows the repo view when a repository is loaded', () => {
    expect(gitView({ hasChat: true, cwd: '/repo', repo, loadError: null })).toBe('repo')
  })
})

describe('GitPanel layout', () => {
  const views: GitView[] = ['no-chat', 'no-folder', 'error', 'loading', 'not-repo', 'repo']

  function render(view: GitView): string {
    return text(
      renderToStaticMarkup(
        <GitPanel view={view} errorMessage="cwd does not exist" onRefresh={() => {}} repoBody={<p>Repository body</p>} />,
      ),
    )
  }

  test.each(views)('the %s view renders exactly one Git header with the shared title classes', (view) => {
    const markup = render(view)
    expect(markup.split('<header').length - 1).toBe(1)
    expect(markup).toContain('<h2 id="side-git-title" class="min-w-0 flex-1 truncate font-display text-xl font-semibold tracking-tight">Git</h2>')
  })

  test('the repo view puts the Refresh button in the header and shows the repository body', () => {
    const markup = render('repo')
    expect(markup).toContain('aria-label="Refresh"')
    expect(markup).toContain('Repository body')
  })

  test.each(['no-chat', 'no-folder', 'error', 'loading', 'not-repo'] as GitView[])('the %s view has no Refresh button in the header', (view) => {
    expect(render(view)).not.toContain('aria-label="Refresh"')
  })

  test('the no-chat view says to open a chat', () => {
    const markup = render('no-chat')
    expect(markup).toContain('No chat selected')
    expect(markup).toContain('Open a chat to see its repository and file changes here.')
  })

  test('the no-folder view names the missing project folder, distinct from the non-repository line', () => {
    const markup = render('no-folder')
    expect(markup).toContain('No project folder')
    expect(markup).toContain('This chat has no project folder')
    expect(markup).not.toContain('not a git repository')
  })

  test('the not-repo view says the folder is not a git repository', () => {
    const markup = render('not-repo')
    expect(markup).toContain('Not a git repository')
    expect(markup).toContain('This folder is not a git repository')
  })

  test('the error view shows the message and a Try again action, and drops the loading text', () => {
    const markup = render('error')
    expect(markup).toContain('Could not read this repository')
    expect(markup).toContain('cwd does not exist')
    expect(markup).toContain('Try again')
    expect(markup).not.toContain('Loading repository')
  })

  test('the loading view shows the loading line under the header', () => {
    expect(render('loading')).toContain('Loading repository')
  })
})
