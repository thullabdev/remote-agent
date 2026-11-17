import type { FileChange } from '../backend/parse.ts'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../src/ui/components/ui/dialog.tsx'

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
