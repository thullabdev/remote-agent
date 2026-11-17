import type { Commit, DiffHunk, FileChange } from '../backend/parse.ts'
import type { RepoInfo } from '../backend/git.ts'

const PREFIX = '/api/extensions/remote-agent.git'

async function call<T>(method: 'GET' | 'POST', route: string, query: Record<string, string>, body?: unknown): Promise<T> {
  const search = new URLSearchParams(query).toString()
  const url = `${PREFIX}${route}${search === '' ? '' : `?${search}`}`
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const response = await fetch(url, init)
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}`
    throw new Error(message)
  }
  return payload as T
}

export const gitApi = {
  repo(cwd: string): Promise<RepoInfo> {
    return call<RepoInfo>('GET', '/repo', { cwd })
  },

  status(cwd: string): Promise<{ staged: FileChange[]; unstaged: FileChange[] }> {
    return call<{ staged: FileChange[]; unstaged: FileChange[] }>('GET', '/status', { cwd })
  },

  async log(cwd: string, limit?: number): Promise<Commit[]> {
    const query: Record<string, string> = { cwd }
    if (limit !== undefined) {
      query.limit = String(limit)
    }
    const body = await call<{ commits: Commit[] }>('GET', '/log', query)
    return body.commits
  },

  async commitFiles(cwd: string, sha: string): Promise<FileChange[]> {
    const body = await call<{ files: FileChange[] }>('GET', '/commit-files', { cwd, sha })
    return body.files
  },

  diff(
    cwd: string,
    path: string,
    scope: 'staged' | 'unstaged' | 'commit',
    sha?: string,
  ): Promise<{ binary: boolean; hunks: DiffHunk[] }> {
    const query: Record<string, string> = { cwd, path, scope }
    if (sha !== undefined) {
      query.sha = sha
    }
    return call<{ binary: boolean; hunks: DiffHunk[] }>('GET', '/diff', query)
  },

  async stage(cwd: string, paths: string[]): Promise<void> {
    await call<{ ok: true }>('POST', '/stage', {}, { cwd, paths })
  },

  async unstage(cwd: string, paths: string[]): Promise<void> {
    await call<{ ok: true }>('POST', '/unstage', {}, { cwd, paths })
  },

  commit(cwd: string, message: string): Promise<{ sha: string }> {
    return call<{ sha: string }>('POST', '/commit', {}, { cwd, message })
  },
}
