import { Archive, LoaderCircle, Pin, PinOff, X } from 'lucide-react'
import { Button } from '../ui/button.tsx'
import type { SelectionGroup } from './selection.ts'

type SelectionBarProps = {
  selectedCount: number
  group: SelectionGroup | null
  allSelectedPinned: boolean
  busy: boolean
  onCancel(): void
  onPin(): void
  onArchive(): void
}

/** The header while sessions are selected: how many, then pin or archive for them, then cancel. */
export function SelectionBar({ selectedCount, group, allSelectedPinned, busy, onCancel, onPin, onArchive }: SelectionBarProps) {
  const none = selectedCount === 0
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" aria-live="polite">
      <div className="min-w-0 flex-1 truncate text-sm font-medium">{selectedCount > 0 ? `${selectedCount} selected` : 'Select sessions'}</div>
      <Button variant="ghost" size="icon" aria-label="Cancel selection" onClick={onCancel}>
        <X aria-hidden="true" />
      </Button>
      {group === 'live' ? (
        <Button aria-label={allSelectedPinned ? 'Unpin selected' : 'Pin selected'} onClick={onPin} disabled={none || busy}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : allSelectedPinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          <span>{allSelectedPinned ? 'Unpin' : 'Pin'}</span>
        </Button>
      ) : (
        <Button aria-label="Archive selected" onClick={onArchive} disabled={none || busy}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Archive aria-hidden="true" />}
          <span className="sm:hidden">Archive</span>
          <span className="hidden sm:inline">Archive selected</span>
        </Button>
      )}
    </div>
  )
}
