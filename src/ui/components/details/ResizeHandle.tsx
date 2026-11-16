import type { KeyboardEvent, PointerEvent } from 'react'

type ResizeHandleProps = {
  /** Which side of the panel the handle sits on. Only the width changes; the edge decides the direction. */
  edge: 'left' | 'right'
  label: string
  handle: {
    onPointerDown(event: PointerEvent<HTMLElement>): void
    onPointerMove(event: PointerEvent<HTMLElement>): void
    onPointerUp(event: PointerEvent<HTMLElement>): void
    onPointerCancel(event: PointerEvent<HTMLElement>): void
    onKeyDown(event: KeyboardEvent<HTMLElement>): void
  }
  ariaValues: { 'aria-valuemin': number; 'aria-valuemax': number; 'aria-valuenow': number }
}

/** The thin drag strip on a desktop panel's edge. Hidden on the narrow layout, where the panel is a sheet. */
export function ResizeHandle({ edge, label, handle, ariaValues }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      {...ariaValues}
      {...handle}
      className={`absolute inset-y-0 z-20 hidden w-2 cursor-col-resize touch-none outline-none hover:bg-primary/15 focus-visible:bg-primary/25 md:block ${edge === 'left' ? '-left-1' : '-right-1'}`}
    />
  )
}
