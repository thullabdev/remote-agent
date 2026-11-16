import { useEffect, useMemo, useState } from 'react'
import type { Chat } from '../../../channel/web/protocol.ts'
import { selectionGroupOf, type SelectionGroup } from './selection.ts'

type ChatSelectionOptions = {
  chats: Chat[]
  onArchiveSelected(chatIds: string[]): Promise<void>
  onPinSelected(chatIds: string[], pinned: boolean): Promise<void>
  onActionError(error: unknown): void
}

/**
 * Multi-select in the list: one kind of session at a time (ended ones to archive, live ones to pin). Owns the selection, and the
 * archive and pin actions on it.
 */
export function useChatSelection({ chats, onArchiveSelected, onPinSelected, onActionError }: ChatSelectionOptions) {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionGroup, setSelectionGroup] = useState<SelectionGroup | null>(null)
  const [archiving, setArchiving] = useState(false)

  const groups = useMemo(() => new Map(chats.map(chat => [chat.id, selectionGroupOf(chat)] as const)), [chats])
  const selectableIds = useMemo(
    () => new Set(chats.filter(chat => selectionGroup !== null && groups.get(chat.id) === selectionGroup).map(chat => chat.id)),
    [chats, groups, selectionGroup],
  )
  const selectedChats = chats.filter(chat => selectedIds.has(chat.id))
  const allSelectedPinned = selectedChats.length > 0 && selectedChats.every(chat => chat.pinned)

  // A chat that stops being selectable (it was archived elsewhere, say) leaves the selection.
  useEffect(() => {
    setSelectedIds(current => new Set([...current].filter(id => selectableIds.has(id))))
  }, [selectableIds])

  const cancel = () => {
    setSelectedIds(new Set())
    setSelectionMode(false)
    setSelectionGroup(null)
  }

  const begin = (chatId: string) => {
    setSelectionGroup(groups.get(chatId) ?? null)
    setSelectionMode(true)
    setSelectedIds(new Set([chatId]))
  }

  const toggle = (chatId: string) => {
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

  const runOnSelected = async (action: (ids: string[]) => Promise<void>) => {
    const ids = [...selectedIds].filter(id => selectableIds.has(id))
    if (ids.length === 0 || archiving) {
      return
    }
    setArchiving(true)
    try {
      await action(ids)
      cancel()
    } catch (error) {
      onActionError(error)
    } finally {
      setArchiving(false)
    }
  }

  return {
    groups,
    selectionMode,
    selectedIds,
    selectionGroup,
    selectableIds,
    archiving,
    allSelectedPinned,
    begin,
    toggle,
    cancel,
    archive: () => runOnSelected(onArchiveSelected),
    pin: () => runOnSelected(ids => onPinSelected(ids, !allSelectedPinned)),
  }
}
