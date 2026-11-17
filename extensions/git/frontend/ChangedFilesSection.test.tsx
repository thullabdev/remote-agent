import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FileChange } from '../backend/parse.ts'
import type { RepoInfo } from '../backend/git.ts'
import { openDiffPanel } from './GitSideTab.tsx'
import { ChangedFilesView, diffParamsFor, loadChangedFiles, type ChangedRow } from './ChangedFilesSection.tsx'

function file(path: string, added: number, removed: number): FileChange {
  return { path, oldPath: null, status: 'modified', added, removed, binary: false }
}

const staged: ChangedRow = { file: file('src/a.ts', 2, 1), section: 'staged' }
const unstaged: ChangedRow = { file: file('README.md', 0, 3), section: 'unstaged' }

describe('ChangedFilesView', () => {
  test('lists changed files flat with counts and paths relative to the launch folder', () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesView repoRoot="/repo" launchCwd="/repo" rows={[staged, unstaged]} onOpen={() => {}} />,
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
      <ChangedFilesView repoRoot="/repo" launchCwd="/repo/src" rows={[{ file: file('docs/guide.md', 1, 0), section: 'unstaged' }]} onOpen={() => {}} />,
    )
    expect(markup).toContain('../docs/guide.md')
  })

  test('shows "No changes" when the list is empty', () => {
    const markup = renderToStaticMarkup(<ChangedFilesView repoRoot="/repo" launchCwd="/repo" rows={[]} onOpen={() => {}} />)
    expect(markup).toContain('No changes')
  })

  test('a chat with no repository renders nothing', () => {
    const markup = renderToStaticMarkup(<ChangedFilesView repoRoot={null} launchCwd="/repo" rows={[staged]} onOpen={() => {}} />)
    expect(markup).toBe('')
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
    const repo: RepoInfo = { repo: true, root: '/repo', branch: 'main', upstream: null, hasCommits: true }
    const result = await loadChangedFiles(
      {
        repo: async () => repo,
        status: async () => ({ staged: [file('src/a.ts', 2, 1)], unstaged: [file('README.md', 0, 3)] }),
      },
      '/repo',
    )
    expect(result).toEqual({ repoRoot: '/repo', rows: [staged, unstaged] })
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
    expect(result).toEqual({ repoRoot: null, rows: [] })
  })
})
