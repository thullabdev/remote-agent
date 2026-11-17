import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

/** The title row every side tab shares: the title on the left, the tab's actions on the right. */
export function SidePanelHeader({ title, titleId, actions, padX = 'px-3' }: { title: string; titleId?: string; actions?: ReactNode; padX?: string }) {
  return (
    <header className={cn('flex h-14 shrink-0 items-center gap-2', padX)}>
      <h2 id={titleId} className="min-w-0 flex-1 truncate font-display text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {actions}
    </header>
  )
}
