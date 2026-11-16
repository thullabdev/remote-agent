import { GitFork, Pencil, Pin, PinOff, RotateCcw } from 'lucide-react'
import type { Chat } from '../../../channel/web/protocol.ts'
import { Button } from '../ui/button.tsx'

type SessionActionsProps = {
  chat: Chat
  onResume(): Promise<void>
  onFork(): Promise<void>
  onPin(pinned: boolean): Promise<void>
  onRequestRename(): void
}

/** Resume or fork, pin, and rename. Hidden for General, which has no session to act on. */
export function SessionActions({ chat, onResume, onFork, onPin, onRequestRename }: SessionActionsProps) {
  const ended = chat.status === 'ended'
  return (
    <section aria-label="Actions" className="grid gap-2">
      {ended ? (
        <>
          <Button className="justify-start" disabled={chat.archived} onClick={() => void onResume()}>
            <RotateCcw aria-hidden="true" />
            Resume
          </Button>
          <p className="-mt-1 text-xs text-muted-foreground">Starts Claude again with this session&apos;s history.</p>
        </>
      ) : (
        <Button className="justify-start" onClick={() => void onFork()}>
          <GitFork aria-hidden="true" />
          Fork
        </Button>
      )}
      <div className="grid grid-cols-2 gap-2">
        {!chat.archived && (
          <Button variant="outline" className="justify-start" onClick={() => void onPin(!chat.pinned)}>
            {chat.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
            {chat.pinned ? 'Unpin' : 'Pin to top'}
          </Button>
        )}
        <Button variant="outline" className="justify-start" onClick={onRequestRename}>
          <Pencil aria-hidden="true" />
          Rename
        </Button>
      </div>
    </section>
  )
}
