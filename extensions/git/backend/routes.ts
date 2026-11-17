import { realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import {
  commitFiles as commitFilesOf,
  fileDiff,
  logOf,
  mustRun,
  repoInfo,
  runGit,
  statusOf,
  type GitRun,
  type RepoInfo,
} from './git.ts'
import type { FileChange } from './parse.ts'

/** A validation or lookup failure that maps to a specific HTTP status. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const DEFAULT_LOG_LIMIT = 50
const MAX_LOG_LIMIT = 200
const SHA_PATTERN = /^[0-9a-f]{4,64}$/i
const MAX_EXPECTED_PATHS = 5000
const STAGED_CHANGED_MESSAGE = 'The staged changes changed since you reviewed them. Review again.'

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  const message = error instanceof Error ? error.message : String(error)
  return Response.json({ error: message }, { status: 500 })
}

async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (error) {
    return errorResponse(error)
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new HttpError(400, 'body must be JSON')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'body must be a JSON object')
  }
  return body as Record<string, unknown>
}

async function validCwd(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value === '') {
    throw new HttpError(400, 'cwd is required')
  }
  if (!isAbsolute(value)) {
    throw new HttpError(400, 'cwd must be an absolute path')
  }
  try {
    if (!(await stat(value)).isDirectory()) {
      throw new HttpError(400, 'cwd is not a directory')
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error
    }
    throw new HttpError(400, 'cwd does not exist')
  }
  // Git runs in the resolved path, so a symlinked project folder resolves to its real location.
  try {
    return realpathSync(value)
  } catch {
    throw new HttpError(400, 'cwd does not exist')
  }
}

function validPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(item => typeof item === 'string' && item !== '')) {
    throw new HttpError(400, 'paths must be a non-empty array of strings')
  }
  return value as string[]
}

function validExpectedPaths(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_EXPECTED_PATHS ||
    !value.every(item => typeof item === 'string' && item !== '')
  ) {
    throw new HttpError(400, `expectedPaths must be an array of at most ${MAX_EXPECTED_PATHS} non-empty strings`)
  }
  return value as string[]
}

function validSha(value: string | null): string {
  if (value === null || !SHA_PATTERN.test(value)) {
    throw new HttpError(400, 'sha must be a hexadecimal commit id')
  }
  return value
}

/** Resolves the repository for cwd, or fails with 404 when cwd is not inside one. */
async function requireRepo(cwd: string, run: GitRun): Promise<Extract<RepoInfo, { repo: true }>> {
  const info = await repoInfo(cwd, run)
  if (!info.repo) {
    throw new HttpError(404, 'not in a git repository')
  }
  return info
}

function allPaths(status: { staged: FileChange[]; unstaged: FileChange[] }): Set<string> {
  return new Set([...status.staged, ...status.unstaged].map(change => change.path))
}

function assertInStatus(paths: string[], known: Set<string>): void {
  for (const path of paths) {
    if (!known.has(path)) {
      throw new HttpError(404, `path is not in git status: ${path}`)
    }
  }
}

export function createGitRoutes(deps: { run?: GitRun }): {
  repo(request: Request): Promise<Response>
  status(request: Request): Promise<Response>
  log(request: Request): Promise<Response>
  commitFiles(request: Request): Promise<Response>
  diff(request: Request): Promise<Response>
  stage(request: Request): Promise<Response>
  unstage(request: Request): Promise<Response>
  commit(request: Request): Promise<Response>
} {
  const run = deps.run ?? runGit

  async function stageOrUnstage(request: Request, mode: 'stage' | 'unstage'): Promise<Response> {
    const body = await readBody(request)
    const cwd = await validCwd(body.cwd)
    const paths = validPaths(body.paths)
    const repo = await requireRepo(cwd, run)
    const status = await statusOf(cwd, run)
    assertInStatus(paths, allPaths(status))

    if (mode === 'stage') {
      await mustRun(run, repo.root, ['add', '--', ...paths])
    } else if (repo.hasCommits) {
      await mustRun(run, repo.root, ['restore', '--staged', '--', ...paths])
    } else {
      // -f lets rm --cached drop a file whose index copy differs from the work tree; --cached never touches the work tree.
      await mustRun(run, repo.root, ['rm', '--cached', '-q', '-f', '--', ...paths])
    }
    return Response.json({ ok: true })
  }

  return {
    repo: request =>
      guarded(async () => {
        const cwd = await validCwd(new URL(request.url).searchParams.get('cwd'))
        return Response.json(await repoInfo(cwd, run))
      }),

    status: request =>
      guarded(async () => {
        const cwd = await validCwd(new URL(request.url).searchParams.get('cwd'))
        await requireRepo(cwd, run)
        return Response.json(await statusOf(cwd, run))
      }),

    log: request =>
      guarded(async () => {
        const params = new URL(request.url).searchParams
        const cwd = await validCwd(params.get('cwd'))
        const rawLimit = params.get('limit')
        const limit = rawLimit === null ? DEFAULT_LOG_LIMIT : Number(rawLimit)
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_LIMIT) {
          throw new HttpError(400, `limit must be an integer from 1 to ${MAX_LOG_LIMIT}`)
        }
        await requireRepo(cwd, run)
        return Response.json({ commits: await logOf(cwd, limit, run) })
      }),

    commitFiles: request =>
      guarded(async () => {
        const params = new URL(request.url).searchParams
        const cwd = await validCwd(params.get('cwd'))
        const sha = validSha(params.get('sha'))
        await requireRepo(cwd, run)
        return Response.json({ files: await commitFilesOf(cwd, sha, run) })
      }),

    diff: request =>
      guarded(async () => {
        const params = new URL(request.url).searchParams
        const cwd = await validCwd(params.get('cwd'))
        const path = params.get('path')
        if (path === null || path === '') {
          throw new HttpError(400, 'path is required')
        }
        const scope = params.get('scope')
        if (scope !== 'staged' && scope !== 'unstaged' && scope !== 'commit') {
          throw new HttpError(400, 'scope must be staged, unstaged or commit')
        }
        await requireRepo(cwd, run)
        if (scope === 'commit') {
          const sha = validSha(params.get('sha'))
          const files = await commitFilesOf(cwd, sha, run)
          assertInStatus([path], new Set(files.map(file => file.path)))
          return Response.json(await fileDiff(cwd, path, 'commit', sha, run))
        }
        assertInStatus([path], allPaths(await statusOf(cwd, run)))
        return Response.json(await fileDiff(cwd, path, scope, null, run))
      }),

    stage: request => guarded(() => stageOrUnstage(request, 'stage')),

    unstage: request => guarded(() => stageOrUnstage(request, 'unstage')),

    commit: request =>
      guarded(async () => {
        const body = await readBody(request)
        const cwd = await validCwd(body.cwd)
        if (typeof body.message !== 'string' || body.message.trim() === '') {
          throw new HttpError(400, 'message is required')
        }
        const message = body.message.trim()
        // An omitted expectedPaths commits whatever is staged; a present one must match the staged set.
        const expectedPaths = body.expectedPaths === undefined ? null : validExpectedPaths(body.expectedPaths)
        await requireRepo(cwd, run)
        const status = await statusOf(cwd, run)
        if (status.staged.length === 0) {
          throw new HttpError(400, 'nothing staged to commit')
        }
        const stagedPaths = [...new Set(status.staged.map(change => change.path))].sort()
        if (expectedPaths !== null) {
          const expectedSet = new Set(expectedPaths)
          const stagedSet = new Set(stagedPaths)
          const same = expectedSet.size === stagedSet.size && stagedPaths.every(path => expectedSet.has(path))
          if (!same) {
            return Response.json({ error: STAGED_CHANGED_MESSAGE, staged: stagedPaths }, { status: 409 })
          }
        }
        await mustRun(run, cwd, ['commit', '-m', message])
        const sha = (await mustRun(run, cwd, ['rev-parse', 'HEAD'])).trim()
        return Response.json({ sha })
      }),
  }
}
