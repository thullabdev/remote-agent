import { Fragment, useEffect, useRef, useState } from 'react'
import { Folder, Minus, Plus } from 'lucide-react'
import type { FileChange } from '../backend/parse.ts'
import type { ChatInfoSectionContext } from '../../../src/ui/extension-slots.ts'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { gitApi } from './client.ts'
import { type DiffParams, isCurrentCwd, openDiffPanel, type Scope, shouldRefreshOnIdle, writeOpen } from './GitSideTab.tsx'
import { ChangeCounts } from './StatusTree.tsx'
import { FileIcon } from './FileIcon.tsx'
import { displayPath, pathsUnder } from './tree.ts'

export type ChangedRow = { file: FileChange; section: 'staged' | 'unstaged' }
export type ChangedState = { repoRoot: string | null; repoCwd: string | null; rows: ChangedRow[] }
export type FolderGroup = { folder: string; rows: ChangedRow[] }
type ChangedApi = Pick<typeof gitApi, 'repo' | 'status'>

/** Reads the repository root and real folder, then the staged then unstaged files. A folder with no repository has no rows. */
export async function loadChangedFiles(api: ChangedApi, cwd: string): Promise<ChangedState> {
  const repo = await api.repo(cwd)
  if (!repo.repo) {
    return { repoRoot: null, repoCwd: null, rows: [] }
  }
  const status = await api.status(cwd)
  const rows: ChangedRow[] = [
    ...status.staged.map((file) => ({ file, section: 'staged' as const })),
    ...status.unstaged.map((file) => ({ file, section: 'unstaged' as const })),
  ]
  return { repoRoot: repo.root, repoCwd: repo.cwd, rows }
}

/** The folder a repo-relative path sits in: '' for a file at the repository root. */
function folderOf(path: string): string {
  const segments = path.split('/')
  segments.pop()
  return segments.join('/')
}

/**
 * Groups rows by the folder their file sits directly in. Folders keep the order they first appear in, and rows keep
 * their order within a folder. A folder's files are never split across two groups.
 */
export function groupByFolder(rows: ChangedRow[]): FolderGroup[] {
  const groups = new Map<string, ChangedRow[]>()
  for (const row of rows) {
    const folder = folderOf(row.file.path)
    const group = groups.get(folder)
    if (group === undefined) {
      groups.set(folder, [row])
    } else {
      group.push(row)
    }
  }
  return [...groups].map(([folder, groupRows]) => ({ folder, rows: groupRows }))
}

/** A folder's label as the launch folder sees it, with a trailing slash. The repository root shows as './'. */
export function folderLabel(folder: string, repoRoot: string, launchCwd: string): string {
  const shown = displayPath(folder, repoRoot, launchCwd)
  return `${shown === '' ? '.' : shown}/`
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
  onStage,
  onUnstage,
}: {
  repoRoot: string | null
  launchCwd: string
  rows: ChangedRow[]
  onOpen(row: ChangedRow): void
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
}) {
  if (repoRoot === null) {
    return null
  }
  if (rows.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">No changes</p>
  }
  return (
    <ul className="flex flex-col">
      {groupByFolder(rows).map((group) => {
        const label = folderLabel(group.folder, repoRoot, launchCwd)
        // Conflicted files are resolved in the editor first; staging them here would mark markers as resolved.
        const unstaged = group.rows.filter((row) => row.section === 'unstaged' && row.file.status !== 'conflicted').map((row) => row.file)
        const staged = group.rows.filter((row) => row.section === 'staged').map((row) => row.file)
        return (
          <Fragment key={`folder:${group.folder}`}>
            <li className="flex items-center gap-2 px-2 pb-0.5 pt-2">
              <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{label}</span>
              {unstaged.length === 0 ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Stage ${label}`}
                  title="Stage folder"
                  onClick={() => onStage(pathsUnder(unstaged, group.folder))}
                >
                  <Plus className="size-3.5" />
                </Button>
              )}
              {staged.length === 0 ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Unstage ${label}`}
                  title="Unstage folder"
                  onClick={() => onUnstage(pathsUnder(staged, group.folder))}
                >
                  <Minus className="size-3.5" />
                </Button>
              )}
            </li>
            {group.rows.map((row) => (
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
          </Fragment>
        )
      })}
    </ul>
  )
}

export function ChangedFilesSection(context: ChatInfoSectionContext & { fetchers?: typeof gitApi }) {
  const api = context.fetchers ?? gitApi
  const { chat, openPanel, notify } = context
  const cwd = chat.launchCwd ?? null
  const [loaded, setLoaded] = useState<ChangedState | null>(null)
  const latestCwd = useRef<string | null>(cwd)
  const previousBusy = useRef(chat.busy)

  useEffect(() => {
    latestCwd.current = cwd
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

  /** Reloads the changed files for the folder shown now. A response for a folder no longer shown is dropped. */
  async function reload(): Promise<void> {
    if (cwd === null) {
      return
    }
    try {
      const result = await loadChangedFiles(api, cwd)
      if (isCurrentCwd(latestCwd.current, cwd)) {
        setLoaded(result)
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Git request failed', 'error')
    }
  }

  // The agent stopped working, so its file changes may have moved: reload once the chat goes idle.
  useEffect(() => {
    const wasBusy = previousBusy.current
    previousBusy.current = chat.busy
    if (shouldRefreshOnIdle(wasBusy, chat.busy) && loaded !== null && loaded.repoRoot !== null) {
      void reload()
    }
  }, [chat.busy])

  async function changeStaging(stage: boolean, paths: string[]): Promise<void> {
    if (cwd === null) {
      return
    }
    try {
      if (stage) {
        await api.stage(cwd, paths)
      } else {
        await api.unstage(cwd, paths)
      }
      await reload()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Git request failed', 'error')
    }
  }

  if (cwd === null || loaded === null) {
    return null
  }
  return (
    <ChangedFilesView
      repoRoot={loaded.repoRoot}
      launchCwd={loaded.repoCwd ?? cwd}
      rows={loaded.rows}
      onOpen={(row) => openDiffPanel(openPanel, writeOpen, diffParamsFor(row, cwd, chat.id))}
      onStage={(paths) => void changeStaging(true, paths)}
      onUnstage={(paths) => void changeStaging(false, paths)}
    />
  )
}
