import type { FileChange } from '../backend/parse.ts'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../src/ui/components/ui/dialog.tsx'
import { ChangeCounts } from './StatusTree.tsx'

/** Every staged path with its counts, so the user approves the exact files that will be committed. */
export function StagedFileList({ staged }: { staged: FileChange[] }) {
  return (
    <ul className="flex max-h-48 flex-col gap-0.5 overflow-auto">
      {staged.map((file) => (
        <li key={file.path} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-sm">
          <span className="min-w-0 flex-1 truncate" title={file.path}>
            {file.path}
          </span>
          <ChangeCounts added={file.added ?? 0} removed={file.removed ?? 0} binary={file.binary} />
        </li>
      ))}
    </ul>
  )
}

export function CommitDialog({
  open,
  message,
  staged,
  onCancel,
  onConfirm,
}: {
  open: boolean
  message: string
  staged: FileChange[]
  onCancel(): void
  onConfirm(): void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onCancel()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Commit staged changes?</DialogTitle>
          <DialogDescription>{`${staged.length} staged ${staged.length === 1 ? 'file' : 'files'} will be committed with this message:`}</DialogDescription>
        </DialogHeader>
        <StagedFileList staged={staged} />
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 font-mono text-xs">{message}</pre>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Commit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
