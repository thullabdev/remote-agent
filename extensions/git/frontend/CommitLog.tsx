import { type ReactNode, useState } from 'react'
import type { Commit, FileChange } from '../backend/parse.ts'
import { Badge } from '../../../src/ui/components/ui/badge.tsx'
import { gitApi } from './client.ts'
import { TREE_ROW_HEIGHT, TreeFileRow, TreeFolderRow } from './StatusTree.tsx'
import { VirtualRows } from './VirtualRows.tsx'
import { buildTree, toggled, visibleRows, type VisibleTreeRow } from './tree.ts'

/** The height of a commit row, in pixels. */
export const COMMIT_ROW_HEIGHT = 40

type FilesState = { status: 'loading' } | { status: 'ready'; files: FileChange[] } | { status: 'error' }

/** A row of the log: a commit, a line of text under a commit (loading or failure), or a row of an expanded commit's file tree. */
export type LogRow =
  | { kind: 'commit'; key: string; commit: Commit; open: boolean }
  | { kind: 'note'; key: string; text: string; tone: 'muted' | 'error' }
  | { kind: 'tree'; key: string; sha: string; row: VisibleTreeRow }

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
]

/** Formats a commit time (seconds since epoch) relative to `now` (milliseconds). */
export function relativeTime(atSeconds: number, now: number = Date.now()): string {
  const deltaSeconds = atSeconds - now / 1000
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(deltaSeconds) >= size) {
      return formatter.format(Math.round(deltaSeconds / size), unit)
    }
  }
  return formatter.format(Math.round(deltaSeconds), 'second')
}

/**
 * The flat rows of the log: each commit, followed by its file rows when it is open.
 * A commit that is open but has no loaded files yet shows a note in place of its files.
 */
export function commitLogRows(
  commits: Commit[],
  openShas: ReadonlySet<string>,
  filesBySha: ReadonlyMap<string, FilesState>,
  collapsed: ReadonlySet<string>,
): LogRow[] {
  const rows: LogRow[] = []
  for (const commit of commits) {
    const open = openShas.has(commit.sha)
    rows.push({ kind: 'commit', key: `commit:${commit.sha}`, commit, open })
    if (open) {
      const files = filesBySha.get(commit.sha) ?? { status: 'loading' }
      if (files.status === 'loading') {
        rows.push({ kind: 'note', key: `${commit.sha}:loading`, text: 'Loading files…', tone: 'muted' })
      } else if (files.status === 'error') {
        rows.push({ kind: 'note', key: `${commit.sha}:error`, text: 'Could not load the files of this commit', tone: 'error' })
      } else {
        for (const row of visibleRows(buildTree(files.files), collapsed, `${commit.sha}/`)) {
          rows.push({ kind: 'tree', key: row.key, sha: commit.sha, row })
        }
      }
    }
  }
  return rows
}

function CommitButton({ commit, open, onToggle }: { commit: Commit; open: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex h-full w-full flex-col justify-center gap-0.5 rounded-md px-2 text-left hover:bg-muted"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{commit.shortSha}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{commit.subject}</span>
        <Badge>{commit.pushed ? 'Pushed' : 'Local'}</Badge>
      </span>
      <span className="text-xs text-muted-foreground">{`${commit.author} · ${relativeTime(commit.at)}`}</span>
    </button>
  )
}

/** The commit list, virtualized. A commit's files appear inline under it when it is open. */
export function CommitLog({ commits, cwd, onOpen }: { commits: Commit[]; cwd: string; onOpen(file: FileChange, sha: string): void }) {
  const [openShas, setOpenShas] = useState<ReadonlySet<string>>(() => new Set())
  const [filesBySha, setFilesBySha] = useState<ReadonlyMap<string, FilesState>>(() => new Map())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  if (commits.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No commits yet</p>
  }

  async function toggleCommit(sha: string): Promise<void> {
    if (openShas.has(sha)) {
      setOpenShas(toggled(openShas, sha))
      return
    }
    setOpenShas(toggled(openShas, sha))
    if (filesBySha.get(sha)?.status === 'ready') {
      return
    }
    setFilesBySha((current) => new Map(current).set(sha, { status: 'loading' }))
    try {
      const loaded = await gitApi.commitFiles(cwd, sha)
      setFilesBySha((current) => new Map(current).set(sha, { status: 'ready', files: loaded }))
    } catch {
      setFilesBySha((current) => new Map(current).set(sha, { status: 'error' }))
    }
  }

  const rows = commitLogRows(commits, openShas, filesBySha, collapsed)

  function renderRow(row: LogRow): ReactNode {
    if (row.kind === 'commit') {
      return <CommitButton commit={row.commit} open={row.open} onToggle={() => void toggleCommit(row.commit.sha)} />
    }
    if (row.kind === 'note') {
      return (
        <p className={`flex h-full items-center text-xs ${row.tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`} style={{ paddingLeft: '12px' }}>
          {row.text}
        </p>
      )
    }
    const { row: tree } = row
    if (tree.kind === 'folder') {
      return (
        <TreeFolderRow
          name={tree.name}
          depth={tree.depth + 1}
          open={tree.open}
          added={tree.added}
          removed={tree.removed}
          onToggle={() => setCollapsed((current) => toggled(current, tree.key))}
        />
      )
    }
    return <TreeFileRow file={tree.file} name={tree.name} depth={tree.depth + 1} onOpen={() => onOpen(tree.file, row.sha)} />
  }

  return (
    <VirtualRows
      rows={rows}
      rowHeight={(row) => (row.kind === 'commit' ? COMMIT_ROW_HEIGHT : TREE_ROW_HEIGHT)}
      getKey={(row) => row.key}
      renderRow={renderRow}
    />
  )
}
