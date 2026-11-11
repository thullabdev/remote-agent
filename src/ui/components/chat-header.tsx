import { ArrowLeft, Info, Pencil, Radio } from 'lucide-react'
import { chatState } from '../../channel/web/chat-state.ts'
import type { Chat } from '../../channel/web/protocol.ts'
import { useEffect, useRef, useState } from 'react'
import type { AccountUsageView, SessionUsageView } from '../../core/usage-types.ts'
import type { ConnectionStatus } from '../use-web-channel.ts'
import { Avatar } from './ui/avatar.tsx'
import { Button } from './ui/button.tsx'
import { Badge } from './ui/badge.tsx'
import { chatAvatar, NEEDS_YOU_BADGE_CLASS, NEEDS_YOU_TEXT_CLASS } from '../presentation.ts'
import type { GeneralViewPreference } from '../preferences.ts'
import { RenameDialog } from './rename-dialog.tsx'
import { useNow } from './usage-meters.tsx'
import { UsagePanel, UsageToggle } from './usage-panel.tsx'

type ChatHeaderProps = {
  chat: Chat
  status: ConnectionStatus
  onBack(): void
  onInfo(): void
  infoOpen: boolean
  usage?: SessionUsageView
  accounts?: AccountUsageView[]
  /** Renames the session; an empty name goes back to the automatic one. */
  onRename(title: string): Promise<void>
  /** General only: what it shows now, and how to switch. */
  view?: GeneralViewPreference
  onView?(view: GeneralViewPreference): void
  /** General only: one line of what needs attention, shown under its name. */
  summary?: string
  /** General only: how many sessions need you; the avatar glows while it is above zero. */
  needsYou?: number
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

export function ChatHeader({ chat, status, onBack, onInfo, infoOpen, usage, accounts = [], onRename, view, onView, summary, needsYou = 0 }: ChatHeaderProps) {
  const state = chatState(chat)
  // General is the command chat and its dashboard already shows usage, so it has no usage toggle and no details panel.
  const isGeneral = chat.id === 'general'
  const [usageOpen, setUsageOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const now = useNow()
  const wrapper = useRef<HTMLDivElement>(null)
  // A glance, not a place to stay: tapping elsewhere, scrolling the chat or pressing Escape puts it away.
  useEffect(() => {
    if (!usageOpen) {
      return
    }
    const close = () => setUsageOpen(false)
    const outside = (event: Event) => {
      if (!wrapper.current?.contains(event.target as Node)) {
        close()
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('scroll', outside, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('scroll', outside, true)
      document.removeEventListener('keydown', escape)
    }
  }, [usageOpen])
  return (
    <div ref={wrapper} className="relative z-30 shrink-0">
    <header className="chat-header-glass flex h-[4.25rem] shrink-0 items-center gap-2 bg-background/85 px-2 backdrop-blur md:px-4">
      <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Back to chats" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
      </Button>
      <Avatar
        {...chatAvatar(chat)}
        className={`size-9 rounded-xl text-xs ${chat.id === 'general' && needsYou > 0 ? 'ring-2 ring-status-needs/60 animate-pulse motion-reduce:animate-none' : ''}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {chat.id === 'general' ? (
            <h1 className="truncate font-display text-sm font-semibold tracking-tight">{chat.title}</h1>
          ) : (
            <h1 className="min-w-0 text-sm font-semibold tracking-tight">
              <button
                type="button"
                aria-label={`Rename session, ${chat.title}`}
                title={`Rename session, ${chat.title}`}
                onClick={() => setRenaming(true)}
                className="flex max-w-full items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-left font-display hover:bg-muted/70"
              >
                <span className="truncate">{chat.title}</span>
                <Pencil className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </h1>
          )}
          {chat.status === 'ended' && <Badge className="border-transparent bg-muted py-0 text-[9px]">Ended</Badge>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className={`truncate ${state === 'needs_you' ? `font-medium ${NEEDS_YOU_TEXT_CLASS}` : ''}`}>
            {state === 'needs_you' ? 'Waiting for your answer' : state === 'working' ? 'Working on your instruction' : chat.project ?? chat.cwd ?? summary ?? 'General command chat'}
          </span>
          <span className="hidden items-center gap-1.5 sm:inline-flex">
            <span className={`size-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-amber-500'}`} />
            {connectionLabel(status)}
          </span>
        </div>
      </div>
      {chat.id === 'general' && view !== undefined && onView !== undefined && (
        <div role="group" aria-label="General view" className="flex shrink-0 rounded-lg bg-muted p-0.5 text-xs">
          {(['dashboard', 'chat'] as const).map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => onView(option)}
              className={`rounded-md px-2.5 py-1 font-medium capitalize transition-colors ${view === option ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {!isGeneral && <UsageToggle view={usage} open={usageOpen} onToggle={() => setUsageOpen(open => !open)} />}
      {state === 'working' && (
        <Badge className="hidden border-transparent bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 sm:inline-flex">
          <Radio className="size-3" aria-hidden="true" /> Active
        </Badge>
      )}
      {state === 'needs_you' && <Badge className={`hidden sm:inline-flex ${NEEDS_YOU_BADGE_CLASS}`}>Needs you</Badge>}
      {!isGeneral && (
        <Button variant={infoOpen ? 'secondary' : 'ghost'} size="icon-sm" aria-label="Session information and actions" onClick={onInfo}>
          <Info aria-hidden="true" />
        </Button>
      )}
    </header>
    {!isGeneral && <UsagePanel open={usageOpen} accounts={accounts} session={usage} now={now} className="absolute inset-x-2 top-full mt-1 shadow-lg ring-1 ring-border/60 md:inset-x-auto md:right-4 md:w-96" />}
    <RenameDialog open={renaming} title={chat.title} onClose={() => setRenaming(false)} onRename={onRename} />
    </div>
  )
}
