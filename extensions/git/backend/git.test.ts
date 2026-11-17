import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileDiff, gitEnv, logOf, repoInfo, runGit, statusOf } from './git.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-ext-test-'))
  dirs.push(dir)
  return dir
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runGit(cwd, args)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

async function makeRepo(): Promise<string> {
  const repo = tempDir()
  await git(repo, 'init', '-q')
  await git(repo, 'config', 'user.name', 'Test')
  await git(repo, 'config', 'user.email', 'test@example.com')
  await git(repo, 'config', 'commit.gpgsign', 'false')
  return repo
}

describe('git runner', () => {
  test('unborn HEAD: logOf returns [] and a staged file is listed with counts', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
    await git(repo, 'add', '--', 'a.txt')

    expect(await logOf(repo, 10)).toEqual([])
    const status = await statusOf(repo)
    expect(status.staged).toMatchObject([{ path: 'a.txt', status: 'added', added: 2, removed: 0 }])
  })

  test('numstat joins counts: an edited committed file reports added 1, removed 0', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    await git(repo, 'add', '--', 'a.txt')
    await git(repo, 'commit', '-q', '-m', 'init')

    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
    const status = await statusOf(repo)
    expect(status.unstaged).toMatchObject([{ path: 'a.txt', status: 'modified', added: 1, removed: 0 }])
  })

  test('binary numstat is reported as binary', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'image.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
    await git(repo, 'add', '--', 'image.bin')
    await git(repo, 'commit', '-q', '-m', 'binary')

    writeFileSync(join(repo, 'image.bin'), Buffer.from([0, 9, 9, 9, 0, 1, 2]))
    const status = await statusOf(repo)
    expect(status.unstaged).toMatchObject([{ path: 'image.bin', binary: true, added: null }])
    const diff = await fileDiff(repo, 'image.bin', 'unstaged', null)
    expect(diff).toEqual({ binary: true, hunks: [] })
  })

  test('pushed split: with one local commit ahead of upstream, the older commit is pushed and the new one is local', async () => {
    const remote = tempDir()
    await git(remote, 'init', '-q', '--bare')
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    await git(repo, 'add', '--', 'a.txt')
    await git(repo, 'commit', '-q', '-m', 'pushed one')
    await git(repo, 'remote', 'add', 'origin', remote)
    await git(repo, 'push', '-q', '-u', 'origin', 'HEAD')
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
    await git(repo, 'commit', '-q', '-am', 'local two')

    const commits = await logOf(repo, 10)
    expect(commits.map(commit => [commit.subject, commit.pushed])).toEqual([
      ['local two', false],
      ['pushed one', true],
    ])
  })

  test('gitEnv sets GIT_LITERAL_PATHSPECS only for commands that take pathspecs', () => {
    expect(gitEnv(['commit', '-m', 'x'], {}).GIT_LITERAL_PATHSPECS).toBeUndefined()
    expect(gitEnv(['log', '-n', '1'], {}).GIT_LITERAL_PATHSPECS).toBeUndefined()
    expect(gitEnv(['rev-parse', 'HEAD'], {}).GIT_LITERAL_PATHSPECS).toBeUndefined()
    expect(gitEnv(['add', '--', 'a.txt'], {}).GIT_LITERAL_PATHSPECS).toBe('1')
    expect(gitEnv(['show', '--format=', '--', 'a.txt'], {}).GIT_LITERAL_PATHSPECS).toBe('1')
    expect(gitEnv(['show', '--format=', 'abc123'], {}).GIT_LITERAL_PATHSPECS).toBeUndefined()
  })

  test('gitEnv drops an inherited GIT_LITERAL_PATHSPECS for commands that take none', () => {
    expect(gitEnv(['commit', '-m', 'x'], { GIT_LITERAL_PATHSPECS: '1', PATH: '/bin' })).toEqual({ PATH: '/bin', GIT_TERMINAL_PROMPT: '0' })
  })

  test('subfolder launch reports repo true with the repository root', async () => {
    const repo = await makeRepo()
    mkdirSync(join(repo, 'sub'))
    const info = await repoInfo(join(repo, 'sub'))
    expect(info).toMatchObject({ repo: true, root: repo, hasCommits: false })
  })

  test('folder that is not a repo reports repo false', async () => {
    const outside = tempDir()
    expect(await repoInfo(outside)).toEqual({ repo: false })
  })

  test('untracked file over 1 MB is not read and reports null counts', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'big.txt'), Buffer.alloc(1_048_577, 97))
    const status = await statusOf(repo)
    expect(status.unstaged).toMatchObject([{ path: 'big.txt', status: 'untracked', added: null, removed: null }])
  })

  test('untracked symlink is not counted as a regular file and reports null counts', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'target.txt'), 'one\ntwo\n')
    symlinkSync(join(repo, 'target.txt'), join(repo, 'link.txt'))
    const status = await statusOf(repo)
    expect(status.unstaged.find(change => change.path === 'link.txt')).toMatchObject({
      status: 'untracked',
      added: null,
      removed: null,
    })
  })
})
