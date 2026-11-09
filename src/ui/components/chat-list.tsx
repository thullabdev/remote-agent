import { Archive, LoaderCircle, Plus, Search, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { Chat } from '../../channel/web/protocol.ts'
import { filterChats, filterCounts, LIST_FILTERS, type ListFilter } from '../chat-filters.ts'
import { chatRowLabel } from '../presentation.ts'
import { BrandMark } from './brand-mark.tsx'
import type { ConnectionStatus } from '../use-web-channel.ts'
import { ChatRowContent } from './chat-row.tsx'
import { Button } from './ui/button.tsx'
import { Input } from './ui/input.tsx'

type ChatListProps = {
  chats: Chat[]
  activeId: string | null
  status: ConnectionStatus
  onOpen(chatId: string): void
  onNew(): void
  onSettings(): void
  onArchiveSelected(chatIds: string[]): Promise<void>
  onActionError(error: unknown): void
}

/** Horizontally scrolling filter chips. Every chip stays reachable by scrolling, so "Needs you" is never hidden behind a "More" menu. */
function ChatFilterBar({ value, counts, onSelect }: { value: ListFilter; counts: Record<ListFilter, number>; onSelect(filter: ListFilter): void }) {
  return (
    <div
      className="flex shrink-0 gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label="Filter sessions"
    >
      {LIST_FILTERS.map(([filter, label]) => {
        const selected = value === filter
        const count = counts[filter]
        const attention = filter === 'needs_you' && count > 0
        const showCount = (filter === 'needs_you' || filter === 'working') && count > 0
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(filter)}
            className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors ${
              selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'
            } ${attention && !selected ? 'text-status-needs' : ''}`}
          >
            {label}
            {showCount && <span className={`tabular-nums text-xs ${attention ? 'text-status-needs' : ''}`}>{count}</span>}
          </button>
        )
      })}
    </div>
  )
}

const CHAT_LIST_WIDTH_KEY = 'remote-agent.chat-list-width.v1'
const CHAT_LIST_DEFAULT_WIDTH = 352 // 22rem, the previous fixed width
const CHAT_LIST_MIN_WIDTH = 260
const CHAT_LIST_MAX_WIDTH = 560
const CHAT_LIST_KEYBOARD_STEP = 16

function clampChatListWidth(width: number): number {
  return Math.min(CHAT_LIST_MAX_WIDTH, Math.max(CHAT_LIST_MIN_WIDTH, Math.round(width)))
}

function readChatListWidth(): number {
  try {
    const stored = Number(localStorage.getItem(CHAT_LIST_WIDTH_KEY))
    return Number.isFinite(stored) && stored > 0 ? clampChatListWidth(stored) : CHAT_LIST_DEFAULT_WIDTH
  } catch {
    return CHAT_LIST_DEFAULT_WIDTH
  }
}

function saveChatListWidth(width: number): void {
  try {
    localStorage.setItem(CHAT_LIST_WIDTH_KEY, String(width))
  } catch {
    // Storage unavailable: the width still applies for this session.
  }
}

export function isSelectableChat(chat: Chat): boolean {
  return chat.id !== 'general' && chat.status === 'ended' && !chat.archived
}

export function ChatList({
  chats,
  activeId,
  status,
  onOpen,
  onNew,
  onSettings,
  onArchiveSelected,
  onActionError,
}: ChatListProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ListFilter>('all')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [archiving, setArchiving] = useState(false)
  const [width, setWidth] = useState(readChatListWidth)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)
  const longPress = useRef<{ chatId: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const suppressClick = useRef<string | null>(null)
  const filteredChats = useMemo(
    () => filterChats(chats, query, filter),
    [chats, query, filter],
  )
  const counts = useMemo(() => filterCounts(chats), [chats])
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

  const selectFilter = (next: ListFilter) => {
    setFilter(next)
    if (next === 'archived') {
      cancelSelection()
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

  const onResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStart.current = { x: event.clientX, width }
  }

  const onResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeStart.current === null) return
    setWidth(clampChatListWidth(resizeStart.current.width + event.clientX - resizeStart.current.x))
  }

  const endResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeStart.current === null) return
    resizeStart.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    saveChatListWidth(width)
  }

  const onResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = clampChatListWidth(width + (event.key === 'ArrowRight' ? CHAT_LIST_KEYBOARD_STEP : -CHAT_LIST_KEYBOARD_STEP))
    setWidth(next)
    saveChatListWidth(next)
  }

  return (
    <aside
      className={`absolute inset-0 z-10 flex min-w-0 flex-col bg-background transition-transform duration-300 md:relative md:z-auto md:w-[var(--chat-list-width)] md:shrink-0 md:translate-x-0 ${
        activeId === null ? 'translate-x-0' : '-translate-x-full'
      }`}
      style={{ '--chat-list-width': `${width}px` } as CSSProperties}
      aria-label="Chats"
    >
      <header className="flex h-[4.25rem] shrink-0 items-center gap-2 px-4">
        <BrandMark className="size-11 shrink-0 text-foreground" />
        {selectionMode ? (
          <div className="flex min-w-0 flex-1 items-center gap-2" aria-live="polite">
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
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Settings" title="Settings" onClick={onSettings}>
          <Settings aria-hidden="true" />
        </Button>
        <Button size="icon" aria-label="Start a new session" title="Start a new session" onClick={onNew}>
          <Plus aria-hidden="true" />
        </Button>
      </header>

      <ChatFilterBar value={filter} counts={counts} onSelect={selectFilter} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
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
              aria-pressed={selectionMode && selectableIds.has(chat.id) ? selectedIds.has(chat.id) : undefined}
              aria-label={
                selectionMode && selectableIds.has(chat.id)
                  ? `${chat.title}, ${selectedIds.has(chat.id) ? 'selected' : 'not selected'}`
                  : chatRowLabel(chat)
              }
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                activeId === chat.id ? 'bg-muted' : 'hover:bg-muted/70'
              }`}
            >
              <ChatRowContent chat={chat} selection={selectionMode && selectableIds.has(chat.id) ? { selected: selectedIds.has(chat.id) } : null} />
            </button>
          ))}
          {filteredChats.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {query.trim()
                ? 'No chats match that search.'
                : filter === 'all'
                  ? 'Your chats will appear here.'
                  : filter === 'needs_you'
                    ? 'Nothing is waiting on you.'
                    : filter === 'working'
                      ? 'No session is working right now.'
                      : filter === 'ended'
                        ? 'No ended sessions.'
                        : 'No archived sessions.'}
            </div>
          )}
        </div>
      </div>
      <footer className="px-4 py-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-600 dark:bg-emerald-400' : status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
          {status === 'connected' ? 'Connected to your Bridge' : status === 'reconnecting' ? 'Reconnecting to Bridge…' : status === 'resyncing' ? 'Syncing recent activity…' : status === 'error' ? 'Bridge connection unavailable' : 'Connecting to your Bridge…'}
        </span>
      </footer>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat list"
        aria-valuemin={CHAT_LIST_MIN_WIDTH}
        aria-valuemax={CHAT_LIST_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onKeyDown={onResizeKeyDown}
        className="absolute inset-y-0 -right-1 z-20 hidden w-2 cursor-col-resize touch-none outline-none hover:bg-primary/15 focus-visible:bg-primary/25 md:block"
      />
    </aside>
  )
}
