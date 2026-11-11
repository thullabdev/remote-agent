import { useEffect, useState } from 'react'
import { Button } from './ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.tsx'
import { Input } from './ui/input.tsx'

type RenameDialogProps = {
  open: boolean
  /** The current name, which the box starts with and selects. */
  title: string
  onClose(): void
  /** Receives the trimmed name; an empty name means go back to the automatic one. */
  onRename(title: string): Promise<void>
}

export function RenameDialog({ open, title, onClose, onRename }: RenameDialogProps) {
  const [draftName, setDraftName] = useState(title)

  useEffect(() => {
    if (open) {
      setDraftName(title)
    }
  }, [open, title])

  const submit = async () => {
    onClose()
    await onRename(draftName.trim())
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Session</DialogTitle>
          <DialogDescription>Leave the name empty to go back to the automatic name.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={event => {
            event.preventDefault()
            void submit()
          }}
        >
          <Input
            value={draftName}
            onChange={event => setDraftName(event.target.value)}
            onFocus={event => event.currentTarget.select()}
            maxLength={120}
            aria-label="Session name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save name</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
