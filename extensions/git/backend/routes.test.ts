import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  test('a missing cwd is a 400', async () => {
    const response = await routes.status(get('status', { cwd: '/no/such/dir' }))
    expect(response.status).toBe(400)
  })
})
