import { Check, ChevronRight, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { pickerWhen } from '../presentation.ts'
import { Button } from './ui/button.tsx'

/** Rows shown before "Show more": a long list of histories stays scannable. */
export const PICKER_VISIBLE = 5

export type PickerChoice = { label: string; choice: number; detail?: string; at?: number }

type PickerRowsProps = {
  buttons: PickerChoice[]
  onPick(choice: number): Promise<void>
  now?: number
}

/**
 * The choices of a picker as full-width rows: the time (or the label) first, the detail clamped under it, and a chevron.
 * A row stays readable at any length, where a pill would overflow. Only the first few show until asked for.
 */
export function PickerRows({ buttons, onPick, now = Date.now() }: PickerRowsProps) {
  const [expanded, setExpanded] = useState(false)
  // The choice made: its phase is pending while the bridge starts the Session, then done. Other rows stay disabled either way.
  const [picked, setPicked] = useState<{ choice: number; phase: 'pending' | 'done' } | null>(null)
  const visible = expanded ? buttons : buttons.slice(0, PICKER_VISIBLE)
  const hidden = buttons.length - visible.length

  const pick = (choice: number) => {
    setPicked({ choice, phase: 'pending' })
    onPick(choice).then(
      () => setPicked({ choice, phase: 'done' }),
      () => setPicked(null),
    )
  }

  return (
    <ul className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5" aria-label="Choices">
      {visible.map(button => {
        const chosen = picked?.choice === button.choice ? picked.phase : null
        // A history: its first message is the title and the date sits under it. A project: its name, with the folder under it.
        const isHistory = button.at !== undefined
        const title = isHistory ? (button.detail ?? button.label) : button.label
        const secondary = isHistory ? pickerWhen(button.at ?? 0, now) : button.detail
        return (
          <li key={button.choice} className="min-w-0">
            <button
              type="button"
              title={isHistory ? `${title} · ${secondary}` : (button.detail ?? button.label)}
              disabled={picked !== null}
              onClick={() => pick(button.choice)}
              className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-left transition-colors hover:bg-muted/70 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{title}</span>
                {secondary !== undefined && secondary !== '' && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span>
                )}
              </span>
              {chosen === 'pending' && (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> Starting…
                </span>
              )}
              {chosen === 'done' && (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                  <Check className="size-3.5" aria-hidden="true" /> Started
                </span>
              )}
              {chosen === null && (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
            </button>
          </li>
        )
      })}
      {hidden > 0 && (
        <li>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setExpanded(true)}>
            Show {hidden} more
          </Button>
        </li>
      )}
    </ul>
  )
}
