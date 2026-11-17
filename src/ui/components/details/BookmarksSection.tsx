import type { PinView } from '../../../channel/web/protocol.ts'
import { formatTime } from '../../presentation.ts'
import { Button } from '../ui/button.tsx'
import { SectionLabel } from './SectionLabel.tsx'

type BookmarksSectionProps = {
  pins: PinView[]
  onJump(pin: PinView): void
  onUnpin(messageId: string): Promise<void>
}

/** The messages bookmarked in this chat, each one shown in the chat or removed. */
export function BookmarksSection({ pins, onJump, onUnpin }: BookmarksSectionProps) {
  return (
    <details open={pins.length > 0} className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between">
        <SectionLabel>Bookmarks · {pins.length}</SectionLabel>
      </summary>
      {pins.length === 0 ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Tap the bookmark on a message to keep it here.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {pins.map(pin => (
            <li key={pin.id} className="rounded-xl bg-card p-2.5">
              <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                <span>{pin.kind === 'user_text' ? 'You' : 'Agent'}</span>
                <time dateTime={new Date(pin.at).toISOString()}>{formatTime(pin.at)}</time>
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-snug">{pin.preview}</p>
              <div className="mt-1.5 flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => onJump(pin)}>Show in chat</Button>
                <Button variant="ghost" size="sm" onClick={() => void onUnpin(pin.id)}>Remove bookmark</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
