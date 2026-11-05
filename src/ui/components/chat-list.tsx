import { Archive, Check, ListChecks, LoaderCircle, MessageCircle, Pin, Plus, Search, Settings2, ShieldCheck, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Chat } from '../../channel/web/protocol.ts'
import { formatRelativeTime } from '../presentation.ts'
import type { ConnectionStatus } from '../use-web-channel.ts'
import { Avatar } from './ui/avatar.tsx'
import { Button } from './ui/button.tsx'
import { Input } from './ui/input.tsx'

type ChatListProps = {
  chats: Chat[]
  activeId: string | null
  away: boolean
  status: ConnectionStatus
  onOpen(chatId: string): void
  onNew(): void
  onSettings(): void
  onAway(): void
  onArchiveSelected(chatIds: string[]): Promise<void>
  onActionError(error: unknown): void
}

type SessionSourceFilter = 'all' | 'laptop' | 'spawned' | 'archived'

export function isSelectableChat(chat: Chat): boolean {
  return chat.id !== 'general' && chat.status === 'ended' && !chat.archived
}

export function filterChats(chats: Chat[], query: string, source: SessionSourceFilter): Chat[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return chats.filter(chat => {
    if (source === 'archived') {
      return chat.id !== 'general' && chat.archived && chat.title.toLocaleLowerCase().includes(normalizedQuery)
    }
    if (chat.archived) return false
    const sourceMatches =
      source === 'all' || (chat.id !== 'general' && chat.spawned === (source === 'spawned'))
    return sourceMatches && chat.title.toLocaleLowerCase().includes(normalizedQuery)
  })
}

export function ChatList({
  chats,
  activeId,
  away,
  status,
  onOpen,
  onNew,
  onSettings,
  onAway,
  onArchiveSelected,
  onActionError,
}: ChatListProps) {
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SessionSourceFilter>('all')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [archiving, setArchiving] = useState(false)
  const longPress = useRef<{ chatId: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const suppressClick = useRef<string | null>(null)
  const filteredChats = useMemo(
    () => filterChats(chats, query, sourceFilter),
    [chats, query, sourceFilter],
  )
  const selectableIds = useMemo(() => new Set(chats.filter(isSelectableChat).map(chat => chat.id)), [chats])

  useEffect(() => {
    setSelectedIds(current => new Set([...current].filter(id => selectableIds.has(id))))
  }, [selectableIds])

  useEffect(() => () => {
    if (longPress.current !== null) {
      clearTimeout(longPress.current.timer)
    }
  }, [])

  const cancelLongPress = () => {
    if (longPress.current !== null) {
      clearTimeout(longPress.current.timer)
      longPress.current = null
    }
  }

  const beginSelection = (chatId: string) => {
    setSelectionMode(true)
    setSelectedIds(new Set([chatId]))
  }

  const toggleSelection = (chatId: string) => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(chatId)) {
        next.delete(chatId)
        if (next.size === 0) setSelectionMode(false)
      } else {
        next.add(chatId)
      }
      return next
    })
  }

  const cancelSelection = () => {
    setSelectedIds(new Set())
    setSelectionMode(false)
  }

  const archiveSelected = async () => {
    const ids = [...selectedIds].filter(id => selectableIds.has(id))
    if (ids.length === 0 || archiving) return
    setArchiving(true)
    try {
      await onArchiveSelected(ids)
      cancelSelection()
    } catch (error) {
      onActionError(error)
    } finally {
      setArchiving(false)
    }
  }

  return (
    <aside
      className={`absolute inset-0 z-10 flex min-w-0 flex-col border-r border-border bg-background transition-transform duration-300 md:static md:z-auto md:w-[22rem] md:shrink-0 md:translate-x-0 ${
        activeId === null ? 'translate-x-0' : '-translate-x-full'
      }`}
      aria-label="Chats"
    >
      <header className="flex h-[4.25rem] shrink-0 items-center justify-between border-b border-border/70 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <MessageCircle className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-base font-semibold tracking-tight">Remote Agent</div>
            <div className="text-[11px] text-muted-foreground">Your sessions, in one place</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={away ? 'secondary' : 'ghost'}
            size="icon-sm"
            className={away ? 'text-amber-700 dark:text-amber-300' : ''}
            aria-label={`Away mode ${away ? 'on' : 'off'}`}
            title={`Away mode ${away ? 'on' : 'off'}`}
            onClick={onAway}
          >
            <ShieldCheck aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={onSettings}>
            <Settings2 aria-hidden="true" />
          </Button>
        </div>
      </header>

      {selectionMode ? (
        <div className="flex h-[4.5rem] shrink-0 items-center gap-2 px-4 py-3" aria-live="polite">
          <div className="min-w-0 flex-1 truncate text-sm font-medium">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select ended sessions'}
          </div>
          <Button variant="ghost" size="icon" aria-label="Cancel selection" onClick={cancelSelection}>
            <X aria-hidden="true" />
          </Button>
          <Button aria-label="Archive selected" onClick={() => void archiveSelected()} disabled={selectedIds.size === 0 || archiving}>
            {archiving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Archive aria-hidden="true" />}
            <span className="sm:hidden">Archive</span>
            <span className="hidden sm:inline">Archive selected</span>
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              aria-label="Search chats"
              placeholder="Search sessions"
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-10 rounded-full border-transparent bg-muted pl-9 shadow-none focus-visible:border-border"
            />
          </div>
          {filteredChats.some(isSelectableChat) && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label="Select ended sessions"
                title="Select ended sessions"
                onClick={() => setSelectionMode(true)}
              >
                <ListChecks aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => setSelectionMode(true)}>
                Select
              </Button>
            </>
          )}
          <Button size="icon" aria-label="Start a new session" title="Start a new session" onClick={onNew}>
            <Plus aria-hidden="true" />
          </Button>
        </div>
      )}

      <div className="flex items-center gap-1 px-4 pb-2" role="group" aria-label="Filter sessions">
        {([
          ['all', 'All'],
          ['laptop', 'Active Session'],
          ['spawned', 'Spawned'],
          ['archived', 'Archived'],
        ] as const).map(([source, label]) => (
          <Button
            key={source}
            variant={sourceFilter === source ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={sourceFilter === source}
            onClick={() => {
              setSourceFilter(source)
              if (source === 'archived') cancelSelection()
            }}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">
          Chats <span className="ml-1 font-mono normal-case tracking-normal">{filteredChats.length}</span>
        </div>
        <div className="space-y-1">
          {filteredChats.map(chat => (
            <button
              type="button"
              key={chat.id}
              onClick={event => {
                if (suppressClick.current === chat.id) {
                  suppressClick.current = null
                  event.preventDefault()
                  return
                }
                if (selectionMode) {
                  if (selectableIds.has(chat.id)) toggleSelection(chat.id)
                  return
                }
                onOpen(chat.id)
              }}
              onPointerDown={event => {
                if (selectionMode || !isSelectableChat(chat) || event.button !== 0) return
                cancelLongPress()
                const { clientX: x, clientY: y } = event
                const timer = setTimeout(() => {
                  longPress.current = null
                  suppressClick.current = chat.id
                  beginSelection(chat.id)
                }, 500)
                longPress.current = { chatId: chat.id, x, y, timer }
              }}
              onPointerMove={event => {
                const pending = longPress.current
                if (
                  pending?.chatId === chat.id &&
                  (Math.abs(event.clientX - pending.x) > 10 || Math.abs(event.clientY - pending.y) > 10)
                ) {
                  cancelLongPress()
                }
              }}
              onPointerUp={cancelLongPress}
              onPointerCancel={cancelLongPress}
              onContextMenu={event => {
                if (isSelectableChat(chat)) event.preventDefault()
              }}
              aria-disabled={selectionMode && !selectableIds.has(chat.id)}
              aria-current={activeId === chat.id ? 'page' : undefined}
              aria-pressed={selectableIds.has(chat.id) ? selectedIds.has(chat.id) : undefined}
              aria-label={selectionMode && selectableIds.has(chat.id)
                ? `${chat.title}, ${selectedIds.has(chat.id) ? 'selected' : 'not selected'}`
                : undefined}
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
                activeId === chat.id ? 'bg-muted' : 'hover:bg-muted/70'
              }`}
            >
              {selectionMode && selectableIds.has(chat.id) ? (
                <span
                  className={`grid size-11 shrink-0 place-items-center rounded-2xl border ${
                    selectedIds.has(chat.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted text-transparent'
                  }`}
                  aria-hidden="true"
                >
                  <Check className="size-5" />
                </span>
              ) : (
                <Avatar fallback={chat.id === 'general' ? '⌘' : chat.title} className="size-11 rounded-2xl text-sm" />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{chat.title}</span>
                  {chat.id !== 'general' && (
                    <span className="shrink-0 rounded-full border border-border bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {chat.spawned ? 'Spawned' : 'Active Session'}
                    </span>
                  )}
                  {chat.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
                  {chat.status === 'ended' && (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                      Ended
                    </span>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                    {chat.lastMessage ? formatRelativeTime(chat.lastMessage.at) : ''}
                  </span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    {chat.busy ? 'Working…' : chat.lastMessage?.preview ?? chat.project ?? 'No messages yet'}
                  </span>
                  {chat.unread > 0 && (
                    <span className="ml-auto grid min-h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      {chat.unread > 99 ? '99+' : chat.unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))}
          {filteredChats.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {query.trim()
                ? 'No chats match that search.'
                : sourceFilter === 'all'
                  ? 'Your chats will appear here.'
                  : sourceFilter === 'laptop'
                    ? 'No active sessions.'
                    : sourceFilter === 'spawned'
                      ? 'No spawned sessions.'
                      : 'No archived sessions.'}
            </div>
          )}
        </div>
      </div>
      <footer className="border-t border-border/70 px-4 py-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-600 dark:bg-emerald-400' : status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
          {status === 'connected' ? 'Connected to your Bridge' : status === 'reconnecting' ? 'Reconnecting to Bridge…' : status === 'resyncing' ? 'Syncing recent activity…' : status === 'error' ? 'Bridge connection unavailable' : 'Connecting to your Bridge…'}
        </span>
      </footer>
    </aside>
  )
}
