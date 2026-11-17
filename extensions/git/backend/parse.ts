export type FileChange = {
  path: string
  oldPath: string | null
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
  added: number | null
  removed: number | null
  binary: boolean
}

export type NumstatEntry = { added: number | null; removed: number | null; binary: boolean }

export type Commit = {
  sha: string
  shortSha: string
  author: string
  // raw seconds since epoch from %at (not milliseconds)
  at: number
  subject: string
  pushed: boolean
}

export type DiffLine = {
  kind: 'context' | 'added' | 'removed' | 'meta'
  oldLine: number | null
  newLine: number | null
  text: string
}

export type DiffHunk = { header: string; lines: DiffLine[] }

type ChangeStatus = FileChange['status']

function statusFromLetter(letter: string): ChangeStatus | null {
  switch (letter) {
    case 'M':
    case 'T':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    case 'U':
      return 'conflicted'
    default:
      return null
  }
}

function makeChange(path: string, oldPath: string | null, status: ChangeStatus): FileChange {
  return { path, oldPath, status, added: null, removed: null, binary: false }
}

// Splits off the first `count` space-separated fields; the remainder (which may contain spaces) is returned as-is.
function splitHead(token: string, count: number): { head: string[]; rest: string } {
  const head: string[] = []
  let rest = token
  for (let k = 0; k < count; k++) {
    const idx = rest.indexOf(' ')
    if (idx === -1) {
      head.push(rest)
      rest = ''
    } else {
      head.push(rest.slice(0, idx))
      rest = rest.slice(idx + 1)
    }
  }
  return { head, rest }
}

export function parseStatusV2(output: string): { staged: FileChange[]; unstaged: FileChange[] } {
  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const tokens = output.split('\0')
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i] ?? ''
    i += 1
    switch (token.charAt(0)) {
      case '?':
        unstaged.push(makeChange(token.slice(2), null, 'untracked'))
        break
      case '1': {
        const { head, rest } = splitHead(token, 8)
        pushXY(head[1] ?? '..', rest, null, staged, unstaged)
        break
      }
      case '2': {
        // Rename/copy entries are followed by one extra NUL field holding the original path.
        const { head, rest } = splitHead(token, 9)
        const origPath = tokens[i] ?? ''
        i += 1
        pushXY(head[1] ?? '..', rest, origPath, staged, unstaged)
        break
      }
      case 'u': {
        const { rest } = splitHead(token, 10)
        unstaged.push(makeChange(rest, null, 'conflicted'))
        break
      }
      default:
        break
    }
  }
  return { staged, unstaged }
}

function pushXY(
  xy: string,
  path: string,
  origPath: string | null,
  staged: FileChange[],
  unstaged: FileChange[],
): void {
  const x = statusFromLetter(xy.charAt(0))
  const y = statusFromLetter(xy.charAt(1))
  if (x !== null) {
    staged.push(makeChange(path, x === 'renamed' ? origPath : null, x))
  }
  if (y !== null) {
    unstaged.push(makeChange(path, y === 'renamed' ? origPath : null, y))
  }
}

export function parseNumstat(output: string): Map<string, NumstatEntry> {
  const map = new Map<string, NumstatEntry>()
  const tokens = output.split('\0')
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i] ?? ''
    i += 1
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(token)
    if (match === null) {
      continue
    }
    const [, addedRaw = '-', removedRaw = '-', pathRaw = ''] = match
    let path = pathRaw
    if (path === '') {
      // In -z output a rename is "added\tremoved\t" followed by the old path and the new path as separate fields.
      path = tokens[i + 1] ?? ''
      i += 2
    }
    const binary = addedRaw === '-'
    map.set(path, {
      added: binary ? null : Number(addedRaw),
      removed: binary ? null : Number(removedRaw),
      binary,
    })
  }
  return map
}

export function parseLog(output: string, pushedShas: Set<string>): Commit[] {
  const commits: Commit[] = []
  for (const record of output.split('\x1e')) {
    const body = record.replace(/^\n+/, '')
    if (body.trim() === '') {
      continue
    }
    const [sha = '', shortSha = '', author = '', at = '', ...subjectParts] = body.split('\x1f')
    commits.push({
      sha,
      shortSha,
      author,
      at: Number(at),
      subject: subjectParts.join('\x1f'),
      pushed: pushedShas.has(sha),
    })
  }
  return commits
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseUnifiedDiff(text: string): { binary: boolean; hunks: DiffHunk[] } {
  const binary = /^Binary files .* differ$/m.test(text) || /^GIT binary patch$/m.test(text)
  if (binary) {
    return { binary: true, hunks: [] }
  }

  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of text.split('\n')) {
    if (line.startsWith('diff ')) {
      current = null
      continue
    }
    const header = HUNK_HEADER.exec(line)
    if (header) {
      current = { header: line, lines: [] }
      hunks.push(current)
      oldLine = Number(header[1])
      newLine = Number(header[2])
      continue
    }
    if (current === null || line === '') {
      continue
    }
    switch (line.charAt(0)) {
      case ' ':
        current.lines.push({ kind: 'context', oldLine, newLine, text: line.slice(1) })
        oldLine += 1
        newLine += 1
        break
      case '-':
        current.lines.push({ kind: 'removed', oldLine, newLine: null, text: line.slice(1) })
        oldLine += 1
        break
      case '+':
        current.lines.push({ kind: 'added', oldLine: null, newLine, text: line.slice(1) })
        newLine += 1
        break
      case '\\':
        current.lines.push({ kind: 'meta', oldLine: null, newLine: null, text: line })
        break
      default:
        break
    }
  }

  return { binary: false, hunks }
}
