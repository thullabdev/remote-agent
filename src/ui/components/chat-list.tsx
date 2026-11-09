import { Archive, Check, Pin, PinOff, LoaderCircle, Plus, Search, Settings, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { Chat } from '../../channel/web/protocol.ts'
import { filterChats, filterCounts, matchesOrigin, ORIGIN_FILTERS, searchTerms, visibleFilters, type ListFilter, type OriginFilter } from '../chat-filters.ts'
import { chatRowLabel, connectionNoticeText, rowOpenTarget } from '../presentation.ts'
import { BrandMark } from './brand-mark.tsx'
import type { ConnectionStatus } from '../use-web-channel.ts'
import { ChatRowContent } from './chat-row.tsx'
import { useNow } from './usage-meters.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.tsx'
import { Button } from './ui/button.tsx'
import { Input } from './ui/input.tsx'

type ChatListProps = {
  /** The tab the list opens on. All, unless a test or a link says otherwise. */
  initialFilter?: ListFilter
  /** The search the list opens with. Empty, unless a test says otherwise. */
  initialQuery?: string
  /** The source the list opens on. All sources, unless a test or a link says otherwise. */
  initialOrigin?: OriginFilter
  chats: Chat[]
  activeId: string | null
  status: ConnectionStatus
  /** `focus` asks the app to open at a Prompt: a tap on a session that needs you goes straight to what it waits for. */
  onOpen(chatId: string, focus?: { promptId: string }): void
  onNew(): void
  /** Tries the connection again now. The notice offers it only when this is set. */
  onRetry?(): void
  onSettings(): void
  onArchiveSelected(chatIds: string[]): Promise<void>
  onPinSelected(chatIds: string[], pinned: boolean): Promise<void>
  onActionError(error: unknown): void
}

/** Narrows the list to sessions started on the computer or spawned from Remote Agent. Sits inside the search field to keep the header light. */
function SourceFilter({ value, onSelect }: { value: OriginFilter; onSelect(origin: OriginFilter): void }) {
  const active = value !== 'all'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Filter by source"
          data-active={active ? 'true' : undefined}
          className={`absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full hover:bg-background/60 ${active ? 'text-primary' : 'text-muted-foreground'}`}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {active && <span aria-hidden="true" className="absolute right-1 top-1 size-2 rounded-full bg-primary" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ORIGIN_FILTERS.map(([origin, label]) => (
          <DropdownMenuItem key={origin} onSelect={() => onSelect(origin)}>
            <span className="flex-1">{label}</span>
            {value === origin && <Check className="size-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What an empty list says: why it is empty, in the words of what the user asked to see. */
function emptyMessage(query: string, filter: ListFilter, origin: OriginFilter): string {
  if (query.trim() !== '') {
    return 'No sessions match that search.'
  }
  if (origin !== 'all') {
    return `No ${origin} sessions here.`
  }
  switch (filter) {
    case 'all':
      return 'Your sessions will appear here.'
    case 'needs_you':
      return 'Nothing is waiting on you.'
    case 'working':
      return 'No session is working right now.'
    case 'ended':
      return 'No ended sessions.'
    case 'archived':
      return 'No archived sessions.'
  }
}

/** Says nothing while all is well. A line that is always on becomes invisible, so it only shows when the connection is not fine. */
function ConnectionNotice({ status, onRetry }: { status: ConnectionStatus; onRetry?: () => void }) {
  const text = connectionNoticeText(status)
  if (text === undefined) {
    return null
  }
  return (
    <div role="status" className="mx-4 mb-1 flex shrink-0 items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
      <span className={`size-2 shrink-0 rounded-full ${status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">{text}</span>
      {onRetry !== undefined && (status === 'reconnecting' || status === 'error') && (
        <button type="button" onClick={onRetry} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/60">
          Retry
        </button>
      )}
    </div>
  )
}

/** Horizontally scrolling tabs. Needs you and Working only appear while they hold something. */
function ChatFilterBar({
  value,
  counts,
  endedUnread,
  onSelect,
}: {
  value: ListFilter
  counts: Record<ListFilter, number>
  /** An ended session has unread messages, so a session that just finished or failed is not missed behind the Ended tab. */
  endedUnread: boolean
  onSelect(filter: ListFilter): void
}) {
  return (
    <div
      className="flex shrink-0 gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label="Filter sessions"
    >
      {visibleFilters(counts, value).map(([filter, label]) => {
        const selected = value === filter
        const count = counts[filter]
        const attention = filter === 'needs_you' && count > 0
        const showCount = (filter === 'needs_you' || filter === 'working') && count > 0
        const showDot = filter === 'ended' && endedUnread
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={selected}
            aria-label={showDot ? `${label}, has unread messages` : undefined}
            onClick={() => onSelect(filter)}
            className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors ${
              selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'
            } ${attention && !selected ? 'text-status-needs' : ''}`}
          >
            {label}
            {showCount && <span className={`tabular-nums text-xs ${attention ? 'text-status-needs' : ''}`}>{count}</span>}
            {showDot && <span data-unread="true" aria-hidden="true" className="size-2 rounded-full bg-primary" />}
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

export function isPinnableChat(chat: Chat): boolean {
  return chat.id !== 'general' && chat.status !== 'ended' && !chat.archived
}

type SelectionGroup = 'ended' | 'live'

// A selection holds one kind of session: ended ones can be archived, live ones can be pinned.
export function selectionGroupOf(chat: Chat): SelectionGroup | null {
  if (isSelectableChat(chat)) {
    return 'ended'
  }
  return isPinnableChat(chat) ? 'live' : null
}

export function ChatList({
  initialFilter = 'all',
  initialQuery = '',
  initialOrigin = 'all',
  chats,
  activeId,
  status,
  onOpen,
  onNew,
  onRetry,
  onSettings,
  onArchiveSelected,
  onPinSelected,
  onActionError,
}: ChatListProps) {
  const [query, setQuery] = useState(initialQuery)
  const [filter, setFilter] = useState<ListFilter>(initialFilter)
  const [origin, setOrigin] = useState<OriginFilter>(initialOrigin)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [archiving, setArchiving] = useState(false)
  const [width, setWidth] = useState(readChatListWidth)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)
  const longPress = useRef<{ chatId: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const suppressClick = useRef<string | null>(null)
  const terms = useMemo(() => searchTerms(query), [query])
  const filteredChats = useMemo(
    () => filterChats(chats, query, filter, origin),
    [chats, query, filter, origin],
  )
  // Ticks every 30 s so "12m" becomes "13m" without waiting for something else to re-render the list.
  const now = useNow()
  const counts = useMemo(() => filterCounts(chats, origin), [chats, origin])
  const endedUnread = useMemo(
    () => chats.some(chat => matchesOrigin(chat, origin) && chat.status === 'ended' && !chat.archived && chat.unread > 0),
    [chats, origin],
  )
  const groups = useMemo(() => new Map(chats.map(chat => [chat.id, selectionGroupOf(chat)] as const)), [chats])
  const [selectionGroup, setSelectionGroup] = useState<SelectionGroup | null>(null)
  const selectableIds = useMemo(
    () => new Set(chats.filter(chat => selectionGroup !== null && groups.get(chat.id) === selectionGroup).map(chat => chat.id)),
    [chats, groups, selectionGroup],
  )
  const selectedChats = chats.filter(chat => selectedIds.has(chat.id))
  const allSelectedPinned = selectedChats.length > 0 && selectedChats.every(chat => chat.pinned)

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
    setSelectionGroup(groups.get(chatId) ?? null)
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
    setSelectionGroup(null)
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

  const pinSelected = async () => {
    const ids = [...selectedIds].filter(id => selectableIds.has(id))
    if (ids.length === 0 || archiving) {
      return
    }
    setArchiving(true)
    try {
      await onPinSelected(ids, !allSelectedPinned)
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
      className={`absolute inset-0 z-10 flex min-w-0 flex-col bg-background transition-[transform,visibility] duration-300 md:relative md:z-auto md:w-[var(--chat-list-width)] md:shrink-0 md:translate-x-0 ${
        activeId === null ? 'translate-x-0' : '-translate-x-full max-md:invisible'
      }`}
      style={{ '--chat-list-width': `${width}px` } as CSSProperties}
      aria-label="Sessions"
    >
      <header className="flex h-[4.25rem] shrink-0 items-center gap-2 px-4">
        <BrandMark className="hidden size-11 shrink-0 text-foreground md:block" />
        {selectionMode ? (
          <div className="flex min-w-0 flex-1 items-center gap-2" aria-live="polite">
            <div className="min-w-0 flex-1 truncate text-sm font-medium">
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select sessions'}
            </div>
            <Button variant="ghost" size="icon" aria-label="Cancel selection" onClick={cancelSelection}>
              <X aria-hidden="true" />
            </Button>
            {selectionGroup === 'live' ? (
              <Button aria-label={allSelectedPinned ? 'Unpin selected' : 'Pin selected'} onClick={() => void pinSelected()} disabled={selectedIds.size === 0 || archiving}>
                {archiving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : allSelectedPinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                <span>{allSelectedPinned ? 'Unpin' : 'Pin'}</span>
              </Button>
            ) : (
              <Button aria-label="Archive selected" onClick={() => void archiveSelected()} disabled={selectedIds.size === 0 || archiving}>
                {archiving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Archive aria-hidden="true" />}
                <span className="sm:hidden">Archive</span>
                <span className="hidden sm:inline">Archive selected</span>
              </Button>
            )}
          </div>
        ) : (
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              aria-label="Search sessions"
              placeholder="Search sessions"
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-10 rounded-full border-transparent bg-muted pl-9 pr-11 shadow-none focus-visible:border-border"
            />
            <SourceFilter value={origin} onSelect={setOrigin} />
          </div>
        )}
        <Button variant="ghost" size="icon" aria-label="Settings" title="Settings" onClick={onSettings}>
          <Settings aria-hidden="true" />
        </Button>
        <Button size="icon" className="hidden md:inline-flex" aria-label="Start a new session" title="Start a new session" onClick={onNew}>
          <Plus aria-hidden="true" />
        </Button>
      </header>

      <ConnectionNotice status={status} onRetry={onRetry} />
      <ChatFilterBar value={filter} counts={counts} endedUnread={endedUnread} onSelect={selectFilter} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 max-md:pb-24">
        {filter === 'ended' && filteredChats.length > 0 && !selectionMode && (
          <p className="px-3 pb-2 text-xs text-muted-foreground">Press and hold a session to select it, then archive.</p>
        )}
        {terms.length > 0 && filteredChats.length > 0 && (
          <p className="px-3 pb-2 text-xs text-muted-foreground">{filteredChats.length === 1 ? '1 result' : `${filteredChats.length} results`}</p>
        )}
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
                onOpen(chat.id, rowOpenTarget(chat))
              }}
              onPointerDown={event => {
                if (selectionMode || groups.get(chat.id) === null || event.button !== 0) return
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
                if (groups.get(chat.id) !== null) event.preventDefault()
              }}
              aria-disabled={selectionMode && !selectableIds.has(chat.id)}
              aria-current={activeId === chat.id ? 'page' : undefined}
              aria-pressed={selectionMode && selectableIds.has(chat.id) ? selectedIds.has(chat.id) : undefined}
              aria-label={
                selectionMode && selectableIds.has(chat.id)
                  ? `${chat.title}, ${selectedIds.has(chat.id) ? 'selected' : 'not selected'}`
                  : chatRowLabel(chat, now)
              }
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                activeId === chat.id ? 'bg-muted' : 'hover:bg-muted/70'
              }`}
            >
              <ChatRowContent chat={chat} now={now} terms={terms} selection={selectionMode && selectableIds.has(chat.id) ? { selected: selectedIds.has(chat.id) } : null} />
            </button>
          ))}
          {filteredChats.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {emptyMessage(query, filter, origin)}
            </div>
          )}
        </div>
      </div>
      {!selectionMode && (
        <Button
          size="icon"
          className="absolute bottom-4 right-4 z-20 size-14 rounded-full shadow-lg md:hidden"
          aria-label="Start a new session"
          title="Start a new session"
          onClick={onNew}
        >
          <Plus aria-hidden="true" className="size-6" />
        </Button>
      )}
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
