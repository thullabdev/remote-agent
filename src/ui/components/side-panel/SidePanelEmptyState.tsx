import type { LucideIcon } from 'lucide-react'
import { Button } from '../ui/button.tsx'

/** A centred empty state for a side tab: an icon tile, a title, one muted line, and an optional action. */
export function SidePanelEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick(): void; icon?: LucideIcon }
}) {
  const ActionIcon = action?.icon
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="grid size-16 place-items-center rounded-3xl bg-card shadow-sm">
        <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="mt-5 font-display text-xl font-semibold tracking-tight">{title}</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {action === undefined ? null : (
        <Button className="mt-5" variant="outline" onClick={action.onClick}>
          {ActionIcon === undefined ? null : <ActionIcon className="mr-2 size-4" aria-hidden="true" />}
          {action.label}
        </Button>
      )}
    </div>
  )
}
