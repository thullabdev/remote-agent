import type { MouseEvent, PointerEvent } from 'react'
import type { Chat } from '../../../channel/web/protocol.ts'
import { chatRowLabel } from '../../presentation.ts'
import { ChatRowContent } from '../chat-row.tsx'
import type { useLongPress } from './use-long-press.ts'

type SessionRowProps = {
  chat: Chat
  /** Whether this is the chat in the main area. */
  active: boolean
  now: number
  terms: string[]
  /** Selection state for this row: whether selection is on, whether the row can take part, and whether it is chosen. */
  selection: { mode: boolean; selectable: boolean; selected: boolean }
  /** Whether a press on the row can start a selection. General and other rows that cannot be selected cannot. */
  pressable: boolean
  press: ReturnType<typeof useLongPress>
  onActivate(chat: Chat): void
}

/** One session in the list: a tap opens it, or toggles it while selecting; a long press starts a selection. */
export function SessionRow({ chat, active, now, terms, selection, pressable, press, onActivate }: SessionRowProps) {
  const chosen = selection.mode && selection.selectable
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (press.consumeClick(chat.id)) {
      event.preventDefault()
      return
    }
    onActivate(chat)
  }
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (selection.mode || !pressable || event.button !== 0) {
      return
    }
    press.onPointerDown(chat.id, event)
  }
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={event => press.onPointerMove(chat.id, event)}
      onPointerUp={press.cancel}
      onPointerCancel={press.cancel}
      onContextMenu={event => {
        if (pressable) event.preventDefault()
      }}
      aria-disabled={selection.mode && !selection.selectable}
      aria-current={active ? 'page' : undefined}
      aria-pressed={chosen ? selection.selected : undefined}
      aria-label={chosen ? `${chat.title}, ${selection.selected ? 'selected' : 'not selected'}` : chatRowLabel(chat, now)}
      className={`flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors ${active ? 'bg-muted' : 'hover:bg-muted/70'}`}
    >
      <ChatRowContent chat={chat} now={now} terms={terms} selection={chosen ? { selected: selection.selected } : null} />
    </button>
  )
}
