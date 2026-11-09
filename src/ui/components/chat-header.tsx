import { ArrowLeft, Info, Radio } from 'lucide-react'
import type { Chat } from '../../channel/web/protocol.ts'
import type { SessionUsageView } from '../../core/usage-types.ts'
import type { ConnectionStatus } from '../use-web-channel.ts'
import { Avatar } from './ui/avatar.tsx'
import { Button } from './ui/button.tsx'
import { Badge } from './ui/badge.tsx'
import { ContextPill } from './usage-meters.tsx'

type ChatHeaderProps = {
  chat: Chat
  status: ConnectionStatus
  onBack(): void
  onInfo(): void
  infoOpen: boolean
  usage?: SessionUsageView
}

function connectionLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Live'
    case 'loading':
      return 'Connecting'
    case 'resyncing':
      return 'Syncing'
    case 'reconnecting':
      return 'Reconnecting'
    case 'error':
      return 'Offline'
  }
}

export function ChatHeader({ chat, status, onBack, onInfo, infoOpen, usage }: ChatHeaderProps) {
  return (
    <header className="chat-header-glass flex h-[4.25rem] shrink-0 items-center gap-2 bg-background/85 px-2 backdrop-blur md:px-4">
      <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Back to chats" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
      </Button>
      <Avatar fallback={chat.id === 'general' ? '⌘' : chat.title} className="size-9 rounded-xl text-xs" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate font-display text-sm font-semibold tracking-tight">{chat.title}</h1>
          {chat.status === 'ended' && <Badge className="border-transparent bg-muted py-0 text-[9px]">Ended</Badge>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">{chat.busy ? 'Working on your instruction' : chat.project ?? chat.cwd ?? 'General command chat'}</span>
          <span className="hidden items-center gap-1.5 sm:inline-flex">
            <span className={`size-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-amber-500'}`} />
            {connectionLabel(status)}
          </span>
        </div>
      </div>
      <ContextPill view={usage} />
      {chat.busy && (
        <Badge className="hidden border-transparent bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 sm:inline-flex">
          <Radio className="size-3" aria-hidden="true" /> Active
        </Badge>
      )}
      <Button variant={infoOpen ? 'secondary' : 'ghost'} size="icon-sm" aria-label="Session information and actions" onClick={onInfo}>
        <Info aria-hidden="true" />
      </Button>
    </header>
  )
}
