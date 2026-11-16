import type { CSSProperties, ReactNode } from 'react'
import { useResizableWidth } from '../../lib/use-resizable-width.ts'
import { ResizeHandle } from '../resize-handle.tsx'

/** The side panel's width rules. The width is remembered on this device, and is shared by every side tab. */
export const SIDE_PANEL_WIDTH = {
  storageKey: 'remote-agent.chat-list-width.v1',
  defaultWidth: 352, // 22rem, the previous fixed width
  min: 260,
  max: 560,
  keyboardStep: 16,
  edge: 'right' as const,
}

/**
 * The column every side tab shares: the panel's width, its resize handle on the right edge, and the background. Its
 * content is whatever the selected tab renders, which lays itself out inside this flex column.
 */
export function SidePanelFrame({ label, children }: { label: string; children: ReactNode }) {
  const { width, handle, ariaValues } = useResizableWidth(SIDE_PANEL_WIDTH)
  return (
    <aside
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background md:flex-none md:w-[var(--chat-list-width)]"
      style={{ '--chat-list-width': `${width}px` } as CSSProperties}
      aria-label={label}
    >
      {children}
      <ResizeHandle edge={SIDE_PANEL_WIDTH.edge} label="Resize side panel" handle={handle} ariaValues={ariaValues} />
    </aside>
  )
}
