import { type ReactNode, useState } from 'react'
import { ChevronRight, Minus, Plus } from 'lucide-react'
import type { FileChange } from '../backend/parse.ts'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { cn } from '../../../src/ui/lib/utils.ts'
import { buildTree, type TreeNode } from './tree.ts'

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

type TreeRowsProps = {
  nodes: TreeNode[]
  depth: number
  /** Renders the file's name button and trailing controls. */
  renderFile(file: FileChange): ReactNode
}

function FolderRow({ node, depth, renderFile }: { node: Extract<TreeNode, { kind: 'folder' }>; depth: number; renderFile: TreeRowsProps['renderFile'] }) {
  const [open, setOpen] = useState(true)
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: `${depth * 12}px` }}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm hover:bg-muted"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        <ChangeCounts added={node.added} removed={node.removed} />
      </button>
      {open ? (
        <ul>
          <TreeRows nodes={node.children} depth={depth + 1} renderFile={renderFile} />
        </ul>
      ) : null}
    </li>
  )
}

/** Renders tree nodes recursively: folders are collapsible rows, files come from `renderFile`. */
export function TreeRows({ nodes, depth, renderFile }: TreeRowsProps) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'folder' ? (
          <FolderRow key={`folder:${node.path}`} node={node} depth={depth} renderFile={renderFile} />
        ) : (
          <li key={`file:${node.path}`} style={{ paddingLeft: `${depth * 12}px` }} className="flex items-center gap-1 rounded-md pr-1 hover:bg-muted">
            {renderFile(node.file)}
          </li>
        ),
      )}
    </>
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
  const nodes = buildTree(files)
  return (
    <ul className="flex flex-col gap-0.5">
      <TreeRows
        nodes={nodes}
        depth={0}
        renderFile={(file) => {
          const name = file.path.split('/').pop() ?? file.path
          return (
            <>
              <button
                type="button"
                title={file.path}
                onClick={() => onOpen(file)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <ChangeCounts added={file.added ?? 0} removed={file.removed ?? 0} binary={file.binary} />
              </button>
              {mode === 'unstaged' ? (
                <Button variant="ghost" size="icon-sm" aria-label={`Stage ${file.path}`} onClick={() => onStage([file.path])}>
                  <Plus className="size-3.5" />
                </Button>
              ) : (
                <Button variant="ghost" size="icon-sm" aria-label={`Unstage ${file.path}`} onClick={() => onUnstage([file.path])}>
                  <Minus className="size-3.5" />
                </Button>
              )}
            </>
          )
        }}
      />
    </ul>
  )
}
