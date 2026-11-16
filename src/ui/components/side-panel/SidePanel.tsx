import { Archive, Check, Pin, PinOff, LoaderCircle, Plus, Search, Settings, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Chat } from '../../../channel/web/protocol.ts'
import { filterChats, filterCounts, matchesOrigin, ORIGIN_FILTERS, searchTerms, visibleFilters, type ListFilter, type OriginFilter } from '../../chat-filters.ts'
import { chatRowLabel, rowOpenTarget } from '../../presentation.ts'
import { useResizableWidth } from '../../lib/use-resizable-width.ts'
import { BrandMark } from '../brand-mark.tsx'
import { ChatRowContent } from '../chat-row.tsx'
import { ResizeHandle } from '../resize-handle.tsx'
import { useNow } from '../usage-meters.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { ChatFilterBar } from './ChatFilterBar.tsx'
import { emptyMessage } from './empty-message.ts'
import { SourceFilter } from './SourceFilter.tsx'
import { ConnectionNotice } from './ConnectionNotice.tsx'
import { selectionGroupOf, type SelectionGroup } from './selection.ts'
import type { ConnectionStatus } from '../../use-web-channel.ts'

/** The side panel's width rules. The width is remembered on this device. */
export const SIDE_PANEL_WIDTH = {
  storageKey: 'remote-agent.chat-list-width.v1',
  defaultWidth: 352, // 22rem, the previous fixed width
  min: 260,
  max: 560,
  keyboardStep: 16,
  edge: 'right' as const,
}

export type SidePanelProps = {
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
  /** Sections extensions add above the chats, rendered by the host without knowing what they show. */
  sidebarSections?: ReactNode
  /** Tries the connection again now. The notice offers it only when this is set. */
  onRetry?(): void
  onSettings(): void
  onArchiveSelected(chatIds: string[]): Promise<void>
  onPinSelected(chatIds: string[], pinned: boolean): Promise<void>
  onActionError(error: unknown): void
}

/**
 * The left-hand side panel: the list of sessions, with search, filters, selection, and a resize handle on its right edge.
 * It slides over the main area on the narrow layout.
 */
export function SidePanel({
  initialFilter = 'all',
  initialQuery = '',
  initialOrigin = 'all',
  chats,
  activeId,
  status,
  onOpen,
  onNew,
  sidebarSections,
  onRetry,
  onSettings,
  onArchiveSelected,
  onPinSelected,
  onActionError,
}: SidePanelProps) {
  const [query, setQuery] = useState(initialQuery)
  const searchInput = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<ListFilter>(initialFilter)
  const [origin, setOrigin] = useState<OriginFilter>(initialOrigin)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [archiving, setArchiving] = useState(false)
  const { width, handle, ariaValues } = useResizableWidth(SIDE_PANEL_WIDTH)
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
              ref={searchInput}
              aria-label="Search sessions"
              placeholder="Search sessions"
              value={query}
              onChange={event => setQuery(event.target.value)}
              className={`h-10 rounded-full border-transparent bg-muted pl-9 shadow-none focus-visible:border-border ${query === '' ? 'pr-11' : 'pr-[4.5rem]'}`}
            />
            {query !== '' && (
              <button
                type="button"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => {
                  setQuery('')
                  searchInput.current?.focus()
                }}
                className="absolute right-10 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-background/60"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
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
          <p className="px-2 pb-2 text-xs text-muted-foreground">Press and hold a session to select it, then archive.</p>
        )}
        {terms.length > 0 && filteredChats.length > 0 && (
          <p className="px-2 pb-2 text-xs text-muted-foreground">{filteredChats.length === 1 ? '1 result' : `${filteredChats.length} results`}</p>
        )}
        {sidebarSections}
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
              className={`flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors ${
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
      <ResizeHandle edge="right" label="Resize chat list" handle={handle} ariaValues={ariaValues} />
    </aside>
  )
}
