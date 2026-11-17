import { type ReactNode, useState } from 'react'
import { ChevronRight, Folder, Minus, Plus } from 'lucide-react'
import type { FileChange } from '../backend/parse.ts'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { cn } from '../../../src/ui/lib/utils.ts'
import { FileIcon } from './FileIcon.tsx'
import { VirtualRows } from './VirtualRows.tsx'
import { buildTree, collapsedFolders, pathsUnder, startsCollapsed, sumCounts, toggled, type VisibleTreeRow, visibleRows } from './tree.ts'

/** The height of a file or folder row in a tree list, in pixels. */
export const TREE_ROW_HEIGHT = 28

/** The counts shown beside a file or folder: `+added −removed`, or `binary` for a binary file. */
export function ChangeCounts({ added, removed, binary }: { added: number; removed: number; binary?: boolean }) {
  if (binary === true) {
    return <span className="shrink-0 text-xs text-muted-foreground">binary</span>
  }
  return (
    <span className="shrink-0 font-mono text-xs">
      <span className="text-emerald-600 dark:text-emerald-400">{`+${added}`}</span>{' '}
      <span className="text-red-600 dark:text-red-400">{`−${removed}`}</span>
    </span>
  )
}

/** A section's total as `+added −removed`. Each part is muted when it is zero. */
export function SectionTotals({ files }: { files: FileChange[] }) {
  const { added, removed } = sumCounts(files)
  return (
    <span className="shrink-0 font-mono text-xs">
      <span className={added === 0 ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400'}>{`+${added}`}</span>{' '}
      <span className={removed === 0 ? 'text-muted-foreground' : 'text-red-600 dark:text-red-400'}>{`−${removed}`}</span>
    </span>
  )
}

/** A folder row: the name toggles its children, and `trailing` holds its controls beside the toggle. */
export function TreeFolderRow({
  name,
  depth,
  open,
  added,
  removed,
  onToggle,
  trailing,
}: {
  name: string
  depth: number
  open: boolean
  added: number
  removed: number
  onToggle(): void
  trailing?: ReactNode
}) {
  return (
    <div style={{ paddingLeft: `${depth * 12}px` }} className="flex h-full items-center gap-1 rounded-md pr-1 hover:bg-muted">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-xs"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
        <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <ChangeCounts added={added} removed={removed} />
      </button>
      {trailing}
    </div>
  )
}

/** A file row: the name opens the file, and `trailing` holds its controls. */
export function TreeFileRow({
  file,
  name,
  depth,
  onOpen,
  trailing,
}: {
  file: FileChange
  name: string
  depth: number
  onOpen(): void
  trailing?: ReactNode
}) {
  return (
    <div style={{ paddingLeft: `${depth * 12}px` }} className="flex h-full items-center gap-1 rounded-md pr-1 hover:bg-muted">
      <button type="button" title={file.path} onClick={onOpen} className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-xs">
        <FileIcon path={file.path} className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <ChangeCounts added={file.added ?? 0} removed={file.removed ?? 0} binary={file.binary} />
      </button>
      {trailing}
    </div>
  )
}

export function StatusTree({
  files,
  mode,
  onOpen,
  onStage,
  onUnstage,
}: {
  files: FileChange[]
  mode: 'staged' | 'unstaged'
  onOpen(file: FileChange): void
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
}) {
  /** The folders the person has flipped from their default: collapsed when the tree is large, expanded otherwise. */
  const [toggles, setToggles] = useState<ReadonlySet<string>>(() => new Set())
  const tree = buildTree(files)
  const rows = visibleRows(tree, collapsedFolders(tree, startsCollapsed(files.length), toggles))

  function renderRow(row: VisibleTreeRow): ReactNode {
    if (row.kind === 'folder') {
      const folderTrailing =
        mode === 'unstaged' ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Stage ${row.path}/`} title="Stage folder" onClick={() => onStage(pathsUnder(files, row.path))}>
            <Plus className="size-3.5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Unstage ${row.path}/`}
            title="Unstage folder"
            onClick={() => onUnstage(pathsUnder(files, row.path))}
          >
            <Minus className="size-3.5" />
          </Button>
        )
      return (
        <TreeFolderRow
          name={row.name}
          depth={row.depth}
          open={row.open}
          added={row.added}
          removed={row.removed}
          onToggle={() => setToggles((current) => toggled(current, row.key))}
          trailing={folderTrailing}
        />
      )
    }
    const { file } = row
    const trailing =
      mode === 'unstaged' ? (
        <Button variant="ghost" size="icon-sm" aria-label={`Stage ${file.path}`} onClick={() => onStage([file.path])}>
          <Plus className="size-3.5" />
        </Button>
      ) : (
        <Button variant="ghost" size="icon-sm" aria-label={`Unstage ${file.path}`} onClick={() => onUnstage([file.path])}>
          <Minus className="size-3.5" />
        </Button>
      )
    return <TreeFileRow file={file} name={row.name} depth={row.depth} onOpen={() => onOpen(file)} trailing={trailing} />
  }

  return <VirtualRows rows={rows} rowHeight={TREE_ROW_HEIGHT} getKey={(row) => row.key} renderRow={renderRow} />
}
