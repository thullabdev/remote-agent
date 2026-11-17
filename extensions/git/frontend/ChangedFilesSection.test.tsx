import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FileChange } from '../backend/parse.ts'
import type { RepoInfo } from '../backend/git.ts'
import { openDiffPanel } from './GitSideTab.tsx'
import { ChangedFilesView, diffParamsFor, folderLabel, groupByFolder, loadChangedFiles, type ChangedRow } from './ChangedFilesSection.tsx'

function file(path: string, added: number, removed: number): FileChange {
  return { path, oldPath: null, status: 'modified', added, removed, binary: false }
}

const staged: ChangedRow = { file: file('src/a.ts', 2, 1), section: 'staged' }
const unstaged: ChangedRow = { file: file('README.md', 0, 3), section: 'unstaged' }

describe('ChangedFilesView', () => {
  test('lists changed files flat with counts and paths relative to the launch folder', () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesView repoRoot="/repo" launchCwd="/repo" rows={[staged, unstaged]} onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />,
    )
    expect(markup).toContain('src/a.ts')
    expect(markup).toContain('README.md')
    expect(markup).toContain('+2')
    expect(markup).toContain('−1')
    expect(markup).toContain('+0')
    expect(markup).toContain('−3')
    expect(markup.indexOf('src/a.ts')).toBeLessThan(markup.indexOf('README.md'))
  })

  test('a file outside the launch folder shows with ../', () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesView repoRoot="/repo" launchCwd="/repo/src" rows={[{ file: file('docs/guide.md', 1, 0), section: 'unstaged' }]} onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />,
    )
    expect(markup).toContain('../docs/guide.md')
  })

  test('shows "No changes" when the list is empty', () => {
    const markup = renderToStaticMarkup(<ChangedFilesView repoRoot="/repo" launchCwd="/repo" rows={[]} onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />)
    expect(markup).toContain('No changes')
  })

  test('a chat with no repository renders nothing', () => {
    const markup = renderToStaticMarkup(<ChangedFilesView repoRoot={null} launchCwd="/repo" rows={[staged]} onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />)
    expect(markup).toBe('')
  })
})

describe('groupByFolder', () => {
  const nested: ChangedRow = { file: file('src/feature/b.ts', 1, 0), section: 'unstaged' }
  const sourceStaged: ChangedRow = { file: file('src/a.ts', 2, 1), section: 'staged' }
  const root: ChangedRow = { file: file('README.md', 0, 3), section: 'unstaged' }

  test('groups rows by the folder their file sits directly in, in first-appearance order', () => {
    const groups = groupByFolder([sourceStaged, root, nested, { file: file('src/c.ts', 1, 1), section: 'unstaged' }])
    expect(groups.map((group) => group.folder)).toEqual(['src', '', 'src/feature'])
    expect(groups[0]?.rows.map((row) => row.file.path)).toEqual(['src/a.ts', 'src/c.ts'])
  })

  test('a folder holds staged and unstaged rows together, in their order', () => {
    const groups = groupByFolder([sourceStaged, { file: file('src/z.ts', 0, 0), section: 'unstaged' }])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.rows.map((row) => row.section)).toEqual(['staged', 'unstaged'])
  })

  test('no rows give no groups', () => {
    expect(groupByFolder([])).toEqual([])
  })
})

describe('folderLabel', () => {
  test('shows the folder relative to the launch folder, with a trailing slash', () => {
    expect(folderLabel('src', '/repo', '/repo')).toBe('src/')
    expect(folderLabel('src', '/repo', '/repo/src')).toBe('./')
    expect(folderLabel('docs', '/repo', '/repo/src')).toBe('../docs/')
  })

  test('the repository root shows as ./ from the root', () => {
    expect(folderLabel('', '/repo', '/repo')).toBe('./')
  })
})

describe('ChangedFilesView folder headers', () => {
  const stagedSrc: ChangedRow = { file: file('src/a.ts', 2, 1), section: 'staged' }
  const unstagedSrc: ChangedRow = { file: file('src/b.ts', 1, 0), section: 'unstaged' }

  test('each folder gets one header, with a Stage button when it has unstaged files and an Unstage button when it has staged ones', () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesView repoRoot="/repo" launchCwd="/repo" rows={[stagedSrc, unstagedSrc]} onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />,
    )
    expect(markup.split('aria-label="Stage src/"').length - 1).toBe(1)
    expect(markup.split('aria-label="Unstage src/"').length - 1).toBe(1)
    expect(markup).toContain('src/a.ts')
  })

  test('a folder with only staged files has no Stage button', () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesView repoRoot="/repo" launchCwd="/repo" rows={[stagedSrc]} onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />,
    )
    expect(markup).toContain('aria-label="Unstage src/"')
    expect(markup).not.toContain('aria-label="Stage src/"')
  })

  test('the file rows keep their open-diff buttons under the header', () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesView repoRoot="/repo" launchCwd="/repo" rows={[unstagedSrc]} onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />,
    )
    expect(markup).toContain('<button type="button" class="flex w-full')
  })
})

describe('clicking a row opens the diff panel with the right scope', () => {
  test('diffParamsFor uses scope unstaged for unstaged files and staged for staged files', () => {
    expect(diffParamsFor(unstaged, '/repo', 'chat-1')).toEqual({ cwd: '/repo', chatId: 'chat-1', path: 'README.md', scope: 'unstaged', from: 'chat-1' })
    expect(diffParamsFor(staged, '/repo', 'chat-1')).toEqual({ cwd: '/repo', chatId: 'chat-1', path: 'src/a.ts', scope: 'staged', from: 'chat-1' })
  })

  test('the params open the git.diff panel with that scope', () => {
    const opened: Array<{ id: string; params?: Record<string, string> }> = []
    openDiffPanel(
      (id, params) => {
        opened.push({ id, params })
      },
      () => {},
      diffParamsFor(staged, '/repo', 'chat-1'),
    )
    expect(opened).toEqual([{ id: 'git.diff', params: { cwd: '/repo', chatId: 'chat-1', path: 'src/a.ts', scope: 'staged', from: 'chat-1' } }])
  })
})

describe('loadChangedFiles', () => {
  test('returns staged files then unstaged files for a repository', async () => {
    const repo: RepoInfo = {
      repo: true,
      cwd: '/repo',
      root: '/repo',
      branch: 'main',
      upstream: null,
      hasCommits: true,
      ahead: 0,
      behind: 0,
    }
    const result = await loadChangedFiles(
      {
        repo: async () => repo,
        status: async () => ({ staged: [file('src/a.ts', 2, 1)], unstaged: [file('README.md', 0, 3)] }),
      },
      '/repo',
    )
    expect(result).toEqual({ repoRoot: '/repo', repoCwd: '/repo', rows: [staged, unstaged] })
  })

  test('a folder with no repository has no root and no rows', async () => {
    const result = await loadChangedFiles(
      {
        repo: async () => ({ repo: false }),
        status: async () => {
          throw new Error('status must not be read without a repository')
        },
      },
      '/tmp/plain',
    )
    expect(result).toEqual({ repoRoot: null, repoCwd: null, rows: [] })
  })
})
