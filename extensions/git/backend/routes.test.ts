import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGit } from './git.ts'
import { createGitRoutes } from './routes.ts'

const dirs: string[] = []
const routes = createGitRoutes({ run: runGit })

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-ext-routes-'))
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

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function get(path: string, params: Record<string, string>): Request {
  const query = new URLSearchParams(params).toString()
  return new Request(`http://localhost/${path}?${query}`)
}

describe('git routes', () => {
  test('commit refuses empty message', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'x\n')
    await git(repo, 'add', '--', 'a.txt')

    const response = await routes.commit(post('commit', { cwd: repo, message: '   ' }))
    expect(response.status).toBe(400)
  })

  test('commit refuses nothing staged', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'x\n')

    const response = await routes.commit(post('commit', { cwd: repo, message: 'nothing here' }))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('nothing staged')
  })

  test('commit with a message starting with a dash is passed safely', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'x\n')
    await git(repo, 'add', '--', 'a.txt')

    const response = await routes.commit(post('commit', { cwd: repo, message: '-n tricky' }))
    expect(response.status).toBe(200)
    expect((await git(repo, 'log', '-1', '--format=%s')).trim()).toBe('-n tricky')
  })

  test('stage refuses a path that is not in status', async () => {
    const repo = await makeRepo()
    const response = await routes.stage(post('stage', { cwd: repo, paths: ['../secret'] }))
    expect(response.status).toBe(404)
  })

  test('unstage in a repository without commits works and leaves the file untracked', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'x\n')
    await git(repo, 'add', '--', 'a.txt')

    const response = await routes.unstage(post('unstage', { cwd: repo, paths: ['a.txt'] }))
    expect(response.status).toBe(200)
    const status = await (await routes.status(get('status', { cwd: repo }))).json()
    expect(status).toMatchObject({ staged: [], unstaged: [{ path: 'a.txt', status: 'untracked' }] })
  })

  test('unstage in a repository without commits works when the staged file was edited again', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'x\n')
    await git(repo, 'add', '--', 'a.txt')
    writeFileSync(join(repo, 'a.txt'), 'x\ny\n')

    const response = await routes.unstage(post('unstage', { cwd: repo, paths: ['a.txt'] }))
    expect(response.status).toBe(200)
    const status = await (await routes.status(get('status', { cwd: repo }))).json()
    expect(status).toMatchObject({ staged: [], unstaged: [{ path: 'a.txt', status: 'untracked' }] })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('x\ny\n')
  })

  test('a missing cwd is a 400', async () => {
    const response = await routes.status(get('status', { cwd: '/no/such/dir' }))
    expect(response.status).toBe(400)
  })

  test('stage treats bracket names as literal paths, not globs', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, '[id].tsx'), 'a\n')
    writeFileSync(join(repo, 'i.tsx'), 'a\n')
    await git(repo, 'add', '--', '[id].tsx', 'i.tsx')
    await git(repo, 'commit', '-q', '-m', 'init')
    writeFileSync(join(repo, '[id].tsx'), 'a\nb\n')
    writeFileSync(join(repo, 'i.tsx'), 'a\nb\n')

    const response = await routes.stage(post('stage', { cwd: repo, paths: ['[id].tsx'] }))
    expect(response.status).toBe(200)
    const status = await (await routes.status(get('status', { cwd: repo }))).json()
    expect(status.staged.map((change: { path: string }) => change.path)).toEqual(['[id].tsx'])
    expect(status.unstaged.map((change: { path: string }) => change.path)).toEqual(['i.tsx'])
  })

  test('commit with expectedPaths equal to the staged set commits', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'x\n')
    writeFileSync(join(repo, 'b.txt'), 'y\n')
    await git(repo, 'add', '--', 'a.txt', 'b.txt')

    const response = await routes.commit(post('commit', { cwd: repo, message: 'both', expectedPaths: ['b.txt', 'a.txt'] }))
    expect(response.status).toBe(200)
    expect((await git(repo, 'log', '-1', '--format=%s')).trim()).toBe('both')
  })

  test('commit with expectedPaths that differ from the staged set is a 409 and commits nothing', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'x\n')
    writeFileSync(join(repo, 'b.txt'), 'y\n')
    await git(repo, 'add', '--', 'a.txt', 'b.txt')

    const response = await routes.commit(post('commit', { cwd: repo, message: 'too early', expectedPaths: ['a.txt'] }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'The staged changes changed since you reviewed them. Review again.',
      staged: ['a.txt', 'b.txt'],
    })
    expect((await git(repo, 'status', '--porcelain')).trim().split('\n').sort()).toEqual(['A  a.txt', 'A  b.txt'])
    await expect(git(repo, 'rev-parse', '--verify', 'HEAD')).rejects.toThrow()
  })

  test('commit rejects malformed expectedPaths with a 400', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'x\n')
    await git(repo, 'add', '--', 'a.txt')

    for (const expectedPaths of ['a.txt', [1], [''], ['a.txt', null], Array.from({ length: 5001 }, (_, i) => `f${i}`)]) {
      const response = await routes.commit(post('commit', { cwd: repo, message: 'bad', expectedPaths }))
      expect(response.status).toBe(400)
    }
  })

  test('repo info reports ahead 1 and behind 0 with one local commit on a pushed upstream', async () => {
    const remote = tempDir()
    await git(remote, 'init', '-q', '--bare')
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    await git(repo, 'add', '--', 'a.txt')
    await git(repo, 'commit', '-q', '-m', 'pushed')
    await git(repo, 'remote', 'add', 'origin', remote)
    await git(repo, 'push', '-q', '-u', 'origin', 'HEAD')
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
    await git(repo, 'commit', '-q', '-am', 'local')

    const info = await (await routes.repo(get('repo', { cwd: repo }))).json()
    expect(info).toMatchObject({ repo: true, ahead: 1, behind: 0 })
  })

  test('repo info reports zero ahead and behind when there is no upstream', async () => {
    const repo = await makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    await git(repo, 'add', '--', 'a.txt')
    await git(repo, 'commit', '-q', '-m', 'init')

    const info = await (await routes.repo(get('repo', { cwd: repo }))).json()
    expect(info).toMatchObject({ repo: true, upstream: null, ahead: 0, behind: 0 })
  })

  test('repo info cwd is the real path of a symlinked folder', async () => {
    const repo = await makeRepo()
    const link = join(tempDir(), 'project-link')
    symlinkSync(repo, link)

    const info = await (await routes.repo(get('repo', { cwd: link }))).json()
    expect(info).toMatchObject({ repo: true, cwd: realpathSync(repo) })
  })
})
