import { type ReactNode, useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils.ts'
import { type OpenStateStorage, readOpen, writeOpen } from './accordion-state.ts'

function browserStorage(): OpenStateStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * A flat, full-width disclosure. The chevron sits left of the title, and the body is indented to line up with the title.
 * `aside` renders on the right of the title row and stays visible when collapsed; it sits outside the toggle, so it can hold buttons.
 * `fill`: when true and open, the accordion grows to the height of its flex parent and its body scrolls within that height.
 * When false (the default), the accordion takes its natural height.
 */
export function Accordion({
  id,
  title,
  defaultOpen,
  aside,
  fill = false,
  children,
}: {
  id: string
  title: ReactNode
  defaultOpen?: boolean
  aside?: ReactNode
  fill?: boolean
  children: ReactNode
}) {
  const storage = browserStorage()
  const [open, setOpen] = useState(() => readOpen(storage, id, defaultOpen ?? false))
  const bodyId = useId()

  function toggle() {
    const next = !open
    setOpen(next)
    writeOpen(storage, id, next)
  }

  const filling = open && fill

  return (
    <section className={cn('border-t border-border/60 first:border-t-0', filling && 'flex min-h-0 flex-1 flex-col')}>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left"
        >
          <ChevronDown
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 font-display text-sm font-semibold">{title}</span>
        </button>
        {aside === undefined || aside === null ? null : <div className="flex shrink-0 items-center">{aside}</div>}
      </div>
      {open ? (
        <div id={bodyId} className={cn('pb-3 pl-6', filling && 'min-h-0 flex-1 overflow-auto')}>
          {children}
        </div>
      ) : null}
    </section>
  )
}
