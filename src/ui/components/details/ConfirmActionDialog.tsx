import { Button } from '../ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog.tsx'
import type { ConfirmAction } from './types.ts'

type ConfirmActionDialogProps = {
  action: ConfirmAction | null
  onCancel(): void
  onConfirm(): void
}

/** Asks before ending a process or hiding history on every device. */
export function ConfirmActionDialog({ action, onCancel, onConfirm }: ConfirmActionDialogProps) {
  return (
    <Dialog open={action !== null} onOpenChange={open => { if (!open) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action === 'end' ? 'End this Session?' : 'Hide chat history?'}</DialogTitle>
          <DialogDescription>
            {action === 'end'
              ? 'Remote Agent will end this spawned session. Its history will remain available.'
              : 'This hides the messages shown here on every connected device. Claude keeps its own context, so the session is not reset.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>
            {action === 'end' ? 'End Session' : 'Hide history'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
