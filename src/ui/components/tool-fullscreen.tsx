import { Maximize2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from './ui/button.tsx'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog.tsx'

/**
 * A full-screen button for a tool's file view (Edit or Write). The dialog shows the same content at the full height of the
 * screen, without the inline height limit, so a long change can be read end to end.
 */
export function FullscreenButton({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={`Full screen: ${title}`} title="Full screen" onClick={() => setOpen(true)}>
        <Maximize2 className="size-3.5" aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="inset-0 left-0 top-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-3 overflow-hidden rounded-none p-3 sm:p-4">
          <DialogTitle className="truncate pr-10 font-mono text-xs font-normal text-muted-foreground">{title}</DialogTitle>
          <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-muted [&_pre]:!max-h-none [&>div]:!max-h-none">{children}</div>
        </DialogContent>
      </Dialog>
    </>
  )
}
