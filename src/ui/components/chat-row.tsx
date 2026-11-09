import { Check, Laptop, Terminal } from 'lucide-react'
import { chatState } from '../../channel/web/chat-state.ts'
import type { Chat } from '../../channel/web/protocol.ts'
import { avatarHue, formatRelativeTime, NEEDS_YOU_TEXT_CLASS, pendingPromptLabel } from '../presentation.ts'
import { Avatar } from './ui/avatar.tsx'

const STATE_BADGE_CLASS = { needs_you: 'bg-status-needs', working: 'bg-status-working motion-safe:animate-pulse' } as const

/** The avatar tile, tinted by project, with the session's state as a dot on its corner. */
function ChatAvatar({ chat }: { chat: Chat }) {
  const state = chatState(chat)
  const hue = chat.id === 'general' ? undefined : avatarHue(chat.project ?? chat.title)
  return (
    <span className="relative shrink-0">
      <Avatar fallback={chat.id === 'general' ? '⌘' : (chat.project ?? chat.title)} hue={hue} className="size-11 rounded-2xl text-sm" />
      {(state === 'needs_you' || state === 'working') && (
        <span
          data-state={state}
          aria-hidden="true"
          className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-background ${STATE_BADGE_CLASS[state]}`}
        />
      )}
    </span>
  )
}

/** The preview line: what the session is doing first, then what it last said. A draft never replaces it. */
function PreviewLine({ chat }: { chat: Chat }) {
  const state = chatState(chat)
  if (state === 'needs_you' && chat.pendingPrompt !== null) {
    return (
      <span className="truncate text-xs text-muted-foreground">
        <span className={`font-medium ${NEEDS_YOU_TEXT_CLASS}`}>Needs you · {pendingPromptLabel(chat.pendingPrompt)}: </span>
        {chat.pendingPrompt.summary}
      </span>
    )
  }
  const text = chat.lastMessage?.preview ?? chat.project ?? 'No messages yet'
  const prefix = state === 'working' ? 'Working · ' : state === 'ended' ? 'Ended · ' : ''
  return (
    <span className="truncate text-xs text-muted-foreground">
      {prefix !== '' && <span className={state === 'working' ? 'font-medium text-status-working' : 'font-medium'}>{prefix}</span>}
      {text}
    </span>
  )
}

type ChatRowContentProps = {
  chat: Chat
  /** Set while selecting for archive: the row shows a checkbox in place of the avatar. */
  selection: { selected: boolean } | null
}

/** A small mark of where the session runs: the laptop, or a terminal for one spawned from Remote Agent (it lives in tmux). */
function OriginIcon({ chat }: { chat: Chat }) {
  if (chat.id === 'general') {
    return null
  }
  const Icon = chat.spawned ? Terminal : Laptop
  return (
    <span data-origin={chat.spawned ? 'spawned' : 'laptop'} title={chat.spawned ? 'Spawned from Remote Agent' : 'Started on your laptop'} className="flex shrink-0">
      <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
    </span>
  )
}

export function ChatRowContent({ chat, selection }: ChatRowContentProps) {
  const state = chatState(chat)
  const isGeneral = chat.id === 'general'
  const unreadDot = chat.unread > 0 ? <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-primary" /> : null
  return (
    <>
      {selection !== null ? (
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-2xl border ${
            selection.selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted text-transparent'
          }`}
          aria-hidden="true"
        >
          <Check className="size-5" />
        </span>
      ) : (
        <ChatAvatar chat={chat} />
      )}
      <span className={`min-w-0 flex-1 ${state === 'ended' ? 'opacity-70' : ''}`}>
        <span className="flex items-center gap-2">
          <span className={`truncate text-[15px] ${chat.unread > 0 ? 'font-semibold' : 'font-medium'}`}>{chat.title}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <OriginIcon chat={chat} />
            {chat.lastMessage !== null && (
              <time dateTime={new Date(chat.lastMessage.at).toISOString()} className="font-mono text-xs text-muted-foreground">
                {formatRelativeTime(chat.lastMessage.at)}
              </time>
            )}
            {isGeneral && unreadDot}
          </span>
        </span>
        {!isGeneral && (
          <span className="mt-0.5 flex items-center gap-2">
            <PreviewLine chat={chat} />
            {unreadDot !== null && <span className="ml-auto flex shrink-0">{unreadDot}</span>}
          </span>
        )}
        {chat.draft !== null && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            <span className="font-medium text-primary">Draft</span>: {chat.draft.preview}
          </span>
        )}
      </span>
    </>
  )
}
