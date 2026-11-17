import { useEffect, useState } from 'react'
import type { FileChange } from '../backend/parse.ts'
import type { ChatInfoSectionContext } from '../../../src/ui/extension-slots.ts'
import { gitApi } from './client.ts'
import { type DiffParams, openDiffPanel, type Scope, writeOpen } from './GitSideTab.tsx'
import { ChangeCounts } from './StatusTree.tsx'
import { FileIcon } from './FileIcon.tsx'
import { displayPath } from './tree.ts'

export type ChangedRow = { file: FileChange; section: 'staged' | 'unstaged' }
type ChangedApi = Pick<typeof gitApi, 'repo' | 'status'>

/** Reads the repository root and the staged then unstaged files for a folder. A folder with no repository has no rows. */
export async function loadChangedFiles(api: ChangedApi, cwd: string): Promise<{ repoRoot: string | null; rows: ChangedRow[] }> {
  const repo = await api.repo(cwd)
  if (!repo.repo) {
    return { repoRoot: null, rows: [] }
  }
  const status = await api.status(cwd)
  const rows: ChangedRow[] = [
    ...status.staged.map((file) => ({ file, section: 'staged' as const })),
    ...status.unstaged.map((file) => ({ file, section: 'unstaged' as const })),
  ]
  return { repoRoot: repo.root, rows }
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

/** The diff panel's params for a row: the scope follows the section the file is listed in. */
export function diffParamsFor(row: ChangedRow, cwd: string, chatId: string): DiffParams {
  const scope: Scope = row.section
  return { cwd, chatId, path: row.file.path, scope, from: chatId }
}

export function ChangedFilesView({
  repoRoot,
  launchCwd,
  rows,
  onOpen,
}: {
  repoRoot: string | null
  launchCwd: string
  rows: ChangedRow[]
  onOpen(row: ChangedRow): void
}) {
  if (repoRoot === null) {
    return null
  }
  if (rows.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">No changes</p>
  }
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li key={`${row.section}:${row.file.path}`}>
          <button
            type="button"
            onClick={() => onOpen(row)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted"
          >
            <FileIcon path={row.file.path} className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-xs font-semibold">{fileName(row.file.path)}</span>{' '}
              <span className="text-[10px] text-muted-foreground">{displayPath(row.file.path, repoRoot, launchCwd)}</span>
            </span>
            <ChangeCounts added={row.file.added ?? 0} removed={row.file.removed ?? 0} binary={row.file.binary} />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function ChangedFilesSection(context: ChatInfoSectionContext & { fetchers?: typeof gitApi }) {
  const api = context.fetchers ?? gitApi
  const { chat, openPanel, notify } = context
  const cwd = chat.launchCwd ?? null
  const [loaded, setLoaded] = useState<{ repoRoot: string | null; rows: ChangedRow[] } | null>(null)

  useEffect(() => {
    setLoaded(null)
    if (cwd === null) {
      return undefined
    }
    let stale = false
    loadChangedFiles(api, cwd).then(
      (result) => {
        if (!stale) {
          setLoaded(result)
        }
      },
      (error: unknown) => {
        if (!stale) {
          notify(error instanceof Error ? error.message : 'Git request failed', 'error')
        }
      },
    )
    return () => {
      stale = true
    }
  }, [cwd])

  if (cwd === null || loaded === null) {
    return null
  }
  return (
    <ChangedFilesView
      repoRoot={loaded.repoRoot}
      launchCwd={cwd}
      rows={loaded.rows}
      onOpen={(row) => openDiffPanel(openPanel, writeOpen, diffParamsFor(row, cwd, chat.id))}
    />
  )
}
