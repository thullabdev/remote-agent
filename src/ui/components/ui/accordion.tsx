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

export function Accordion({ id, title, defaultOpen, children }: { id: string; title: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const storage = browserStorage()
  const [open, setOpen] = useState(() => readOpen(storage, id, defaultOpen ?? false))
  const bodyId = useId()

  function toggle() {
    const next = !open
    setOpen(next)
    writeOpen(storage, id, next)
  }

  return (
    <section className="rounded-xl bg-card ring-1 ring-border/60">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="font-display text-sm font-semibold">{title}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open ? (
        <div id={bodyId} className="px-3 pb-3">
          {children}
        </div>
      ) : null}
    </section>
  )
}
