import type { Commit, DiffHunk, FileChange } from '../backend/parse.ts'
import type { RepoInfo } from '../backend/git.ts'
import type { UploadRef } from '../../../src/channel/web/protocol.ts'

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
    throw new Error(errorMessageOf(payload, response.status))
  }
  return payload as T
}

/** The `error` text of a failed response's body, or a status message when the body has none. */
function errorMessageOf(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string') {
    return payload.error
  }
  return `Request failed with status ${status}`
}

/** Stores text as a server-made attachment (the host's `/api/uploads/text`). Returns the upload the composer can attach. */
export async function uploadTextAttachment(name: string, text: string): Promise<UploadRef> {
  const response = await fetch('/api/uploads/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text }),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(errorMessageOf(payload, response.status))
  }
  if (typeof payload !== 'object' || payload === null || !('upload' in payload)) {
    throw new Error('The attachment was not created')
  }
  return payload.upload as UploadRef
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

  /** Commits what is staged. With `expectedPaths`, the server refuses (409, with the error text) unless the staged set matches. */
  commit(cwd: string, message: string, expectedPaths?: string[]): Promise<{ sha: string }> {
    return call<{ sha: string }>('POST', '/commit', {}, { cwd, message, expectedPaths })
  },
}
