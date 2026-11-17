import { lstat, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  parseAheadBehind,
  parseLog,
  parseNumstat,
  parseStatusV2,
  parseUnifiedDiff,
  type Commit,
  type DiffHunk,
  type FileChange,
  type NumstatEntry,
} from './parse.ts'

export type GitRun = (
  cwd: string,
  args: string[],
  options?: { input?: string },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export type RepoInfo =
  | { repo: false }
  | {
      repo: true
      /** The real path of the requested folder, the same value git ran in. */
      cwd: string
      root: string
      branch: string | null
      upstream: string | null
      hasCommits: boolean
      /** Commits on HEAD not on upstream. Both counts are 0 when there is no upstream. */
      ahead: number
      behind: number
    }

/** A git command failed; the message is git's stderr. */
export class GitError extends Error {}

/** Commands whose arguments are pathspecs; only these get literal pathspec matching. */
const PATHSPEC_COMMANDS = new Set(['add', 'restore', 'rm', 'diff', 'ls-files'])

function takesPathspecs(args: string[]): boolean {
  const command = args[0] ?? ''
  return PATHSPEC_COMMANDS.has(command) || (command === 'show' && args.includes('--'))
}

/**
 * The environment for one git call. GIT_LITERAL_PATHSPECS is set only for commands that take pathspecs,
 * so commit hooks and other commands never see it. Any inherited value is dropped first.
 */
export function gitEnv(args: string[], base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && key !== 'GIT_LITERAL_PATHSPECS') {
      env[key] = value
    }
  }
  env.GIT_TERMINAL_PROMPT = '0'
  if (takesPathspecs(args)) {
    env.GIT_LITERAL_PATHSPECS = '1'
  }
  return env
}

/** Runs git with an argument array, never a shell string. `cwd` becomes `git -C <cwd>`. */
export const runGit: GitRun = async (cwd, args, options) => {
  const input = options?.input
  const proc = Bun.spawn(['git', '-C', cwd, ...args], {
    stdin: input === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: gitEnv(args),
  })
  if (input !== undefined && typeof proc.stdin !== 'number' && proc.stdin !== undefined) {
    proc.stdin.write(input)
    await proc.stdin.end()
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

export async function mustRun(run: GitRun, cwd: string, args: string[], options?: { input?: string }): Promise<string> {
  const result = await run(cwd, args, options)
  if (result.exitCode !== 0) {
    throw new GitError(result.stderr.trim() || `git ${args[0] ?? ''} failed`)
  }
  return result.stdout
}

async function isExistingDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function repoInfo(cwd: string, run: GitRun = runGit): Promise<RepoInfo> {
  if (!isAbsolute(cwd) || !(await isExistingDirectory(cwd))) {
    return { repo: false }
  }
  const top = await run(cwd, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) {
    return { repo: false }
  }
  const root = top.stdout.trim()
  const branch = await run(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const upstream = await run(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const head = await run(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  let ahead = 0
  let behind = 0
  if (upstream.exitCode === 0) {
    const counts = await run(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
    if (counts.exitCode === 0) {
      ({ ahead, behind } = parseAheadBehind(counts.stdout))
    }
  }
  return {
    repo: true,
    cwd,
    root,
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    upstream: upstream.exitCode === 0 ? upstream.stdout.trim() : null,
    hasCommits: head.exitCode === 0,
    ahead,
    behind,
  }
}

async function topLevel(cwd: string, run: GitRun): Promise<string> {
  return (await mustRun(run, cwd, ['rev-parse', '--show-toplevel'])).trim()
}

function withCounts(changes: FileChange[], numstat: Map<string, NumstatEntry>): FileChange[] {
  return changes.map(change => {
    const entry = numstat.get(change.path)
    if (!entry) {
      return change
    }
    return { ...change, added: entry.added, removed: entry.removed, binary: entry.binary }
  })
}

/** Untracked files above this size are not read; their counts are reported as null. */
const UNTRACKED_COUNT_CAP_BYTES = 1_048_576

/** Counts an untracked file's lines; git's own heuristic treats a NUL byte in the first 8000 bytes as binary. */
async function untrackedCounts(root: string, path: string): Promise<Pick<FileChange, 'added' | 'removed' | 'binary'>> {
  const full = join(root, path)
  try {
    const info = await lstat(full)
    if (!info.isFile() || info.size > UNTRACKED_COUNT_CAP_BYTES) {
      return { added: null, removed: null, binary: false }
    }
    const bytes = new Uint8Array(await Bun.file(full).arrayBuffer())
    if (bytes.subarray(0, 8000).includes(0)) {
      return { added: null, removed: null, binary: true }
    }
    let lines = 0
    for (const byte of bytes) {
      if (byte === 10) {
        lines += 1
      }
    }
    if (bytes.length > 0 && bytes[bytes.length - 1] !== 10) {
      lines += 1
    }
    return { added: lines, removed: 0, binary: false }
  } catch {
    return { added: null, removed: null, binary: false }
  }
}

export async function statusOf(
  cwd: string,
  run: GitRun = runGit,
): Promise<{ staged: FileChange[]; unstaged: FileChange[] }> {
  const root = await topLevel(cwd, run)
  const status = await mustRun(run, root, ['status', '--porcelain=v2', '-z', '--untracked-files=all'])
  const parsed = parseStatusV2(status)
  const unstagedNumstat = parseNumstat(await mustRun(run, root, ['diff', '--numstat', '-z']))
  const stagedNumstat = parseNumstat(await mustRun(run, root, ['diff', '--cached', '--numstat', '-z']))

  const unstaged = await Promise.all(
    withCounts(parsed.unstaged, unstagedNumstat).map(async change => {
      if (change.status !== 'untracked') {
        return change
      }
      return { ...change, ...(await untrackedCounts(root, change.path)) }
    }),
  )
  return { staged: withCounts(parsed.staged, stagedNumstat), unstaged }
}

export async function logOf(cwd: string, limit: number, run: GitRun = runGit): Promise<Commit[]> {
  const head = await run(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  if (head.exitCode !== 0) {
    return []
  }
  const format = '%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e'
  const output = await mustRun(run, cwd, ['log', '-n', String(limit), `--format=${format}`])
  // Only the commits ahead of upstream are listed. A logged commit is pushed when it is not one of them.
  // With no upstream the command fails, every commit stays local, and no pushed set is built.
  const ahead = await run(cwd, ['rev-list', '@{u}..HEAD'])
  if (ahead.exitCode !== 0) {
    return parseLog(output, new Set())
  }
  const localOnly = new Set(ahead.stdout.split('\n').map(line => line.trim()))
  const loggedShas = output
    .split('\x1e')
    .map(record => record.replace(/^\n+/, '').split('\x1f')[0]?.trim() ?? '')
    .filter(sha => sha !== '')
  const pushedShas = new Set(loggedShas.filter(sha => !localOnly.has(sha)))
  return parseLog(output, pushedShas)
}

const CHANGE_LETTERS: Record<string, FileChange['status']> = {
  A: 'added',
  D: 'deleted',
  M: 'modified',
  T: 'modified',
  R: 'renamed',
  C: 'renamed',
  U: 'conflicted',
}

export async function commitFiles(cwd: string, sha: string, run: GitRun = runGit): Promise<FileChange[]> {
  const nameStatus = await mustRun(run, cwd, ['show', '--format=', '--name-status', '-z', '-M', sha])
  const numstat = parseNumstat(await mustRun(run, cwd, ['show', '--format=', '--numstat', '-z', '-M', sha]))
  const tokens = nameStatus.split('\0')
  const files: FileChange[] = []
  let i = 0
  while (i < tokens.length) {
    const code = tokens[i] ?? ''
    i += 1
    if (code === '') {
      continue
    }
    const status = CHANGE_LETTERS[code.charAt(0)] ?? 'modified'
    if (code.startsWith('R') || code.startsWith('C')) {
      const oldPath = tokens[i] ?? ''
      const path = tokens[i + 1] ?? ''
      i += 2
      files.push({ path, oldPath, status, added: null, removed: null, binary: false })
    } else {
      const path = tokens[i] ?? ''
      i += 1
      files.push({ path, oldPath: null, status, added: null, removed: null, binary: false })
    }
  }
  return withCounts(files, numstat)
}

export async function fileDiff(
  cwd: string,
  path: string,
  scope: 'staged' | 'unstaged' | 'commit',
  sha: string | null,
  run: GitRun = runGit,
): Promise<{ binary: boolean; hunks: DiffHunk[] }> {
  const root = await topLevel(cwd, run)
  if (scope === 'commit') {
    if (sha === null) {
      throw new GitError('a commit diff needs a sha')
    }
    const text = await mustRun(run, root, ['show', '--format=', '--no-color', '--no-ext-diff', sha, '--', path])
    return parseUnifiedDiff(text)
  }
  if (scope === 'staged') {
    const text = await mustRun(run, root, ['diff', '--cached', '--no-color', '--no-ext-diff', '--', path])
    return parseUnifiedDiff(text)
  }
  const tracked = await run(root, ['ls-files', '--error-unmatch', '--', path])
  if (tracked.exitCode !== 0) {
    // Untracked: diff against /dev/null. --no-index exits 1 when the files differ, which is the normal case here.
    const result = await run(root, ['diff', '--no-index', '--no-color', '--no-ext-diff', '--', '/dev/null', join(root, path)])
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new GitError(result.stderr.trim() || 'git diff failed')
    }
    return parseUnifiedDiff(result.stdout)
  }
  const text = await mustRun(run, root, ['diff', '--no-color', '--no-ext-diff', '--', path])
  return parseUnifiedDiff(text)
}
