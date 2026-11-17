import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
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
  | { repo: true; root: string; branch: string | null; upstream: string | null; hasCommits: boolean }

/** A git command failed; the message is git's stderr. */
export class GitError extends Error {}

/** Runs git with an argument array, never a shell string. `cwd` becomes `git -C <cwd>`. */
export const runGit: GitRun = async (cwd, args, options) => {
  const input = options?.input
  const proc = Bun.spawn(['git', '-C', cwd, ...args], {
    stdin: input === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
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
  return {
    repo: true,
    root,
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    upstream: upstream.exitCode === 0 ? upstream.stdout.trim() : null,
    hasCommits: head.exitCode === 0,
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

/** Counts an untracked file's lines; git's own heuristic treats a NUL byte in the first 8000 bytes as binary. */
async function untrackedCounts(root: string, path: string): Promise<Pick<FileChange, 'added' | 'removed' | 'binary'>> {
  try {
    const bytes = new Uint8Array(await Bun.file(join(root, path)).arrayBuffer())
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
  const pushed = await run(cwd, ['rev-list', '@{u}'])
  const pushedShas = new Set(pushed.exitCode === 0 ? pushed.stdout.split('\n').map(line => line.trim()) : [])
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
