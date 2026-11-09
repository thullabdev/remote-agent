import { Check, Monitor, Terminal } from 'lucide-react'
import { Fragment } from 'react'
import { chatState } from '../../channel/web/chat-state.ts'
import type { Chat } from '../../channel/web/protocol.ts'
import { avatarHue, formatRelativeTime, highlightSegments, NEEDS_YOU_TEXT_CLASS, pendingPromptLabel } from '../presentation.ts'
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

/** Text with the words of the current search marked. Plain text when there is no search. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) {
    return <>{text}</>
  }
  return (
    <>
      {highlightSegments(text, terms).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded bg-primary/25 px-0.5 text-inherit">{segment.text}</mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  )
}

/** The preview line: what the session is doing first, then what it last said. A draft never replaces it. */
function PreviewLine({ chat, terms }: { chat: Chat; terms: string[] }) {
  const state = chatState(chat)
  if (state === 'needs_you' && chat.pendingPrompt !== null) {
    return (
      <span className="truncate text-xs text-muted-foreground">
        <span className={`font-medium ${NEEDS_YOU_TEXT_CLASS}`}>Needs you · {pendingPromptLabel(chat.pendingPrompt)}: </span>
        <Highlight text={chat.pendingPrompt.summary} terms={terms} />
      </span>
    )
  }
  const text = chat.lastMessage?.preview ?? chat.project ?? 'No messages yet'
  const prefix = state === 'working' ? 'Working · ' : state === 'ended' ? 'Ended · ' : ''
  return (
    <span className="truncate text-xs text-muted-foreground">
      {prefix !== '' && <span className={state === 'working' ? 'font-medium text-status-working' : 'font-medium'}>{prefix}</span>}
      <Highlight text={text} terms={terms} />
    </span>
  )
}

type ChatRowContentProps = {
  chat: Chat
  /** Set while selecting for archive: the row shows a checkbox in place of the avatar. */
  selection: { selected: boolean } | null
  /** The clock the age is told against. The list passes a ticking one; it defaults to the current time. */
  now?: number
  /** The words of the current search, to mark in the row. */
  terms?: string[]
}

/** A small mark of where the session runs: the computer, or a terminal for one spawned from Remote Agent (it lives in tmux). */
function OriginIcon({ chat }: { chat: Chat }) {
  if (chat.id === 'general') {
    return null
  }
  const Icon = chat.spawned ? Terminal : Monitor
  return (
    <span data-origin={chat.spawned ? 'spawned' : 'computer'} title={chat.spawned ? 'Spawned from Remote Agent' : 'Started on your computer'} className="flex shrink-0">
      <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
    </span>
  )
}

export function ChatRowContent({ chat, selection, now = Date.now(), terms = [] }: ChatRowContentProps) {
  const state = chatState(chat)
  const isGeneral = chat.id === 'general'
  // The row does not print the project or folder, so a search that found the session by them says where.
  const foundInPlace = terms.some(term => [chat.project, chat.cwd].some(part => part !== null && part.toLowerCase().includes(term)))
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
          <span className={`truncate text-[15px] ${chat.unread > 0 ? 'font-semibold' : 'font-medium'}`}><Highlight text={chat.title} terms={terms} /></span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <OriginIcon chat={chat} />
            {chat.lastMessage !== null && (
              <time dateTime={new Date(chat.lastMessage.at).toISOString()} className="font-mono text-xs text-muted-foreground">
                {formatRelativeTime(chat.lastMessage.at, now)}
              </time>
            )}
            {isGeneral && unreadDot}
          </span>
        </span>
        {!isGeneral && (
          <span className="mt-0.5 flex items-center gap-2">
            <PreviewLine chat={chat} terms={terms} />
            {unreadDot !== null && <span className="ml-auto flex shrink-0">{unreadDot}</span>}
          </span>
        )}
        {foundInPlace && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            <Highlight text={[chat.project, chat.cwd].filter(part => part !== null).join(' · ')} terms={terms} />
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
