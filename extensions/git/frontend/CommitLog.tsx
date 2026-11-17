import { useState } from 'react'
import type { Commit, FileChange } from '../backend/parse.ts'
import { Badge } from '../../../src/ui/components/ui/badge.tsx'
import { gitApi } from './client.ts'
import { ChangeCounts, TreeRows } from './StatusTree.tsx'
import { buildTree } from './tree.ts'

type FilesState = { status: 'loading' } | { status: 'ready'; files: FileChange[] } | { status: 'error' }

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

function CommitRow({ commit, cwd, onOpen }: { commit: Commit; cwd: string; onOpen(file: FileChange, sha: string): void }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<FilesState>({ status: 'loading' })

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && files.status !== 'ready') {
      setFiles({ status: 'loading' })
      try {
        const loaded = await gitApi.commitFiles(cwd, commit.sha)
        setFiles({ status: 'ready', files: loaded })
      } catch {
        setFiles({ status: 'error' })
      }
    }
  }

  return (
    <li className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={toggle} className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{commit.shortSha}</span>
          <span className="min-w-0 flex-1 truncate text-sm">{commit.subject}</span>
          <Badge>{commit.pushed ? 'Pushed' : 'Local'}</Badge>
        </span>
        <span className="text-xs text-muted-foreground">{`${commit.author} · ${relativeTime(commit.at)}`}</span>
      </button>
      {open ? (
        <div className="pl-3">
          {files.status === 'loading' ? <p className="py-1 text-xs text-muted-foreground">Loading files…</p> : null}
          {files.status === 'error' ? <p className="py-1 text-xs text-red-600 dark:text-red-400">Could not load the files of this commit</p> : null}
          {files.status === 'ready' ? (
            <ul className="flex flex-col gap-0.5">
              <TreeRows
                nodes={buildTree(files.files)}
                depth={0}
                renderFile={(file) => (
                  <button
                    type="button"
                    title={file.path}
                    onClick={() => onOpen(file, commit.sha)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{file.path.split('/').pop() ?? file.path}</span>
                    <ChangeCounts added={file.added ?? 0} removed={file.removed ?? 0} binary={file.binary} />
                  </button>
                )}
              />
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export function CommitLog({ commits, cwd, onOpen }: { commits: Commit[]; cwd: string; onOpen(file: FileChange, sha: string): void }) {
  if (commits.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No commits yet</p>
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {commits.map((commit) => (
        <CommitRow key={commit.sha} commit={commit} cwd={cwd} onOpen={onOpen} />
      ))}
    </ul>
  )
}
