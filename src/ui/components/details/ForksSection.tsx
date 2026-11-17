import { GitFork, RefreshCw } from 'lucide-react'
import type { ForkView } from '../../../channel/web/protocol.ts'
import { formatTime } from '../../presentation.ts'
import { Button } from '../ui/button.tsx'
import { SectionLabel } from './SectionLabel.tsx'

type ForksSectionProps = {
  forks: ForkView[]
  onRefresh(): void | Promise<void>
  onShowFork(fork: ForkView): void
  onOpenFork(chatId: string): void
}

/** The chats forked from this one. Each fork can be shown at its fork point or opened. */
export function ForksSection({ forks, onRefresh, onShowFork, onOpenFork }: ForksSectionProps) {
  return (
    <details open={forks.length > 0} className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between">
        <SectionLabel>Forks · {forks.length}</SectionLabel>
      </summary>
      <div className="mt-1 flex justify-end">
        <Button variant="ghost" size="sm" aria-label="Refresh forks" onClick={() => void onRefresh()}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>
      {forks.length === 0 ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Fork from a reply to start one.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {forks.map(fork => (
            <li key={fork.chatId} className="rounded-xl bg-card p-2.5">
              <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                <GitFork aria-hidden="true" className="size-3" />
                <time dateTime={new Date(fork.createdAt).toISOString()}>{formatTime(fork.createdAt)}</time>
                {fork.status === 'ended' && <span>Ended</span>}
              </div>
              <p className="mt-1 text-sm font-medium leading-snug">{fork.title}</p>
              {fork.pointVisible && <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{fork.pointPreview}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {fork.pointVisible ? (
                  <Button variant="ghost" size="sm" onClick={() => onShowFork(fork)}>Show in chat</Button>
                ) : (
                  <span className="px-2 text-xs text-muted-foreground">Fork point no longer shown</span>
                )}
                <Button variant="ghost" size="sm" onClick={() => onOpenFork(fork.chatId)}>Open fork</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
