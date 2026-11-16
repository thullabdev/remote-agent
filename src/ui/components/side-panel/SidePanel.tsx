import { Plus, Settings } from 'lucide-react'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Chat } from '../../../channel/web/protocol.ts'
import { filterChats, filterCounts, matchesOrigin, searchTerms, type ListFilter, type OriginFilter } from '../../chat-filters.ts'
import { rowOpenTarget } from '../../presentation.ts'
import { useResizableWidth } from '../../lib/use-resizable-width.ts'
import type { ConnectionStatus } from '../../use-web-channel.ts'
import { BrandMark } from '../brand-mark.tsx'
import { ResizeHandle } from '../resize-handle.tsx'
import { useNow } from '../usage-meters.tsx'
import { Button } from '../ui/button.tsx'
import { ChatFilterBar } from './ChatFilterBar.tsx'
import { ConnectionNotice } from '../connection-notice.tsx'
import { emptyMessage } from './empty-message.ts'
import { ListNotes } from './ListNotes.tsx'
import { NewSessionButton } from './NewSessionButton.tsx'
import { SearchBar } from './SearchBar.tsx'
import { SelectionBar } from './SelectionBar.tsx'
import { SessionRow } from './SessionRow.tsx'
import { useChatSelection } from './use-chat-selection.ts'
import { useLongPress } from './use-long-press.ts'

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
  const [filter, setFilter] = useState<ListFilter>(initialFilter)
  const [origin, setOrigin] = useState<OriginFilter>(initialOrigin)
  const { width, handle, ariaValues } = useResizableWidth(SIDE_PANEL_WIDTH)
  const selection = useChatSelection({ chats, onArchiveSelected, onPinSelected, onActionError })
  const press = useLongPress(selection.begin)
  const terms = useMemo(() => searchTerms(query), [query])
  const filteredChats = useMemo(() => filterChats(chats, query, filter, origin), [chats, query, filter, origin])
  // Ticks every 30 s so "12m" becomes "13m" without waiting for something else to re-render the list.
  const now = useNow()
  const counts = useMemo(() => filterCounts(chats, origin), [chats, origin])
  const endedUnread = useMemo(
    () => chats.some(chat => matchesOrigin(chat, origin) && chat.status === 'ended' && !chat.archived && chat.unread > 0),
    [chats, origin],
  )

  const selectFilter = (next: ListFilter) => {
    setFilter(next)
    if (next === 'archived') {
      selection.cancel()
    }
  }

  // While selecting, a tap toggles a row that can be selected; otherwise it opens the chat.
  const activate = (chat: Chat) => {
    if (selection.selectionMode) {
      if (selection.selectableIds.has(chat.id)) {
        selection.toggle(chat.id)
      }
      return
    }
    onOpen(chat.id, rowOpenTarget(chat))
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
        {selection.selectionMode ? (
          <SelectionBar
            selectedCount={selection.selectedIds.size}
            group={selection.selectionGroup}
            allSelectedPinned={selection.allSelectedPinned}
            busy={selection.archiving}
            onCancel={selection.cancel}
            onPin={() => void selection.pin()}
            onArchive={() => void selection.archive()}
          />
        ) : (
          <SearchBar query={query} onQuery={setQuery} origin={origin} onOrigin={setOrigin} />
        )}
        <Button variant="ghost" size="icon" aria-label="Settings" title="Settings" onClick={onSettings}>
          <Settings aria-hidden="true" />
        </Button>
        <Button size="icon" className="hidden md:inline-flex" aria-label="Start a new session" title="Start a new session" onClick={onNew}>
          <Plus aria-hidden="true" />
        </Button>
      </header>

      <ConnectionNotice status={status} onRetry={onRetry} variant="card" />
      <ChatFilterBar value={filter} counts={counts} endedUnread={endedUnread} onSelect={selectFilter} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 max-md:pb-24">
        <ListNotes
          showArchiveHint={filter === 'ended' && filteredChats.length > 0 && !selection.selectionMode}
          resultCount={terms.length > 0 && filteredChats.length > 0 ? filteredChats.length : null}
        />
        {sidebarSections}
        <div className="space-y-1">
          {filteredChats.map(chat => (
            <SessionRow
              key={chat.id}
              chat={chat}
              active={activeId === chat.id}
              now={now}
              terms={terms}
              selection={{ mode: selection.selectionMode, selectable: selection.selectableIds.has(chat.id), selected: selection.selectedIds.has(chat.id) }}
              pressable={selection.groups.get(chat.id) !== null}
              press={press}
              onActivate={activate}
            />
          ))}
          {filteredChats.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyMessage(query, filter, origin)}</div>}
        </div>
      </div>
      {!selection.selectionMode && <NewSessionButton onNew={onNew} />}
      <ResizeHandle edge={SIDE_PANEL_WIDTH.edge} label="Resize chat list" handle={handle} ariaValues={ariaValues} />
    </aside>
  )
}
