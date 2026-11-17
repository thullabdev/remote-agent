import { ArrowLeft, X } from 'lucide-react'
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { useResizableWidth } from '../../lib/use-resizable-width.ts'
import { Button } from '../ui/button.tsx'
import { ResizeHandle } from '../resize-handle.tsx'
import { useSheetLayout } from './use-sheet-layout.ts'

/** The details panel's width rules. The width is remembered on this device. */
export const DETAILS_WIDTH = {
  storageKey: 'remote-agent.chat-details-width.v1',
  defaultWidth: 320, // 20rem, the previous fixed width
  min: 260,
  max: 560,
  keyboardStep: 16,
  edge: 'left' as const,
}

type DetailsPanelProps = {
  title: string
  /** Shown as a back arrow when the panel is inside another view, such as a sub-agent's activity. */
  onBack?: () => void
  onClose: () => void
  children: ReactNode
}

/**
 * The right-hand details panel: a resizable column on desktop and a sheet over the chat on the narrow layout. It owns the width,
 * the sheet's focus and Escape handling, and its header. What it shows is passed in as children.
 */
export function DetailsPanel({ title, onBack, onClose, children }: DetailsPanelProps) {
  const sheet = useSheetLayout()
  const closeButton = useRef<HTMLButtonElement>(null)
  const { width, handle, ariaValues } = useResizableWidth(DETAILS_WIDTH)

  // As a sheet the panel behaves like a dialog: it takes focus on open and Escape puts it away.
  useEffect(() => {
    if (sheet) {
      closeButton.current?.focus()
    }
  }, [sheet])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && sheet) {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheet, onClose])

  return (
    <aside
      role={sheet ? 'dialog' : 'complementary'}
      aria-modal={sheet ? true : undefined}
      aria-label="Session details"
      className="fixed inset-0 z-30 flex justify-end bg-black/30 md:static md:z-auto md:w-[var(--chat-info-width)] md:shrink-0 md:bg-transparent"
      style={{ '--chat-info-width': `${width}px` } as CSSProperties}
    >
      <button className="absolute inset-0 md:hidden" tabIndex={-1} onClick={onClose} aria-label="Close session information" />
      <div className="relative flex h-full w-[min(88vw,22rem)] flex-col bg-background shadow-2xl md:w-full md:shadow-none">
        <ResizeHandle edge={DETAILS_WIDTH.edge} label="Resize session details" handle={handle} ariaValues={ariaValues} />
        <header className="flex h-[4.25rem] shrink-0 items-center justify-between gap-2 px-4">
          {onBack !== undefined ? (
            <Button variant="ghost" size="icon-sm" aria-label="Back to session details" onClick={onBack}>
              <ArrowLeft aria-hidden="true" />
            </Button>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate font-display font-semibold">{title}</h2>
          <Button ref={closeButton} variant="ghost" size="icon-sm" aria-label="Close session information" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </header>
        {children}
      </div>
    </aside>
  )
}
