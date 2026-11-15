import { useEffect, useRef, useCallback, useState } from 'react'
import type { Terminal as TerminalType } from 'xterm'
import * as Lucide from 'lucide-react'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { cn } from '../../../src/ui/lib/utils.ts'

export type TerminalSession = {
  id: string
  cwd: string
  login: string
  connected: boolean
  bytesIn?: number
  bytesOut?: number
}

type TerminalPanelProps = {
  terminals: TerminalSession[]
  activeTerminalId: string | null
  onNew(): void
  onClose(sid: string): void
  /** 'compact' uses tighter padding; 'comfortable' is the default. */
  density?: 'compact' | 'comfortable'
}

/** xterm.js is imported lazily inside useEffect so the component renders server-side (SSR)
 * without a DOM. The addons (fit, webgl, links, search, unicode11) are loaded from the xterm
 * package in a follow-up; v1 uses the core Terminal with manual resize. */
export function TerminalPanel({ terminals, activeTerminalId, onNew, onClose, density }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [term, setTerm] = useState<TerminalType | null>(null)
  const [dimensions, setDimensions] = useState({ cols: 80, rows: 24 })

  const activeTerminal = terminals.find(t => t.id === activeTerminalId) ?? null

  // Fit the xterm grid to its container on mount and on resize.
  useEffect(() => {
    if (activeTerminalId === null || containerRef.current === null || term === null) {
      return
    }
    term.resize(dimensions.cols, dimensions.rows)
  }, [activeTerminalId, dimensions, term])

  // Debounced container resize observer.
  useEffect(() => {
    if (containerRef.current === null) {
      return
    }
    const container = containerRef.current
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        // Approximate cols/rows from character cell size (10px wide, 20px high).
        setDimensions({ cols: Math.max(10, Math.floor(width / 10)), rows: Math.max(5, Math.floor(height / 20)) })
      }
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // Lazy-load xterm.js only in the browser (not during SSR).
  useEffect(() => {
    if (activeTerminalId === null || containerRef.current === null) {
      return
    }
    let mounted = true
    import('xterm').then(({ Terminal }) => {
      if (!mounted) {
        return
      }
      const terminal = new Terminal({ cols: dimensions.cols, rows: dimensions.rows })
      terminal.open(containerRef.current!)
      setTerm(terminal)
    })
    return () => {
      mounted = false
    }
  }, [activeTerminalId, containerRef.current, dimensions.cols, dimensions.rows])

  const handleNew = () => onNew()
  const handleClose = (sid: string, event: React.MouseEvent) => {
    event.stopPropagation()
    onClose(sid)
  }

  if (terminals.length === 0) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-8 text-center md:flex">
        <div className="grid size-16 place-items-center rounded-3xl bg-card shadow-sm">
          <Lucide.X className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="mt-5 font-display text-xl font-semibold tracking-tight">No terminal sessions</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Open a shell over Tailscale. Sessions survive reloads.
        </p>
        <Button className="mt-5" variant="outline" onClick={handleNew}>
          <Lucide.Plus className="size-4 mr-2" aria-hidden="true" />
          Start terminal
        </Button>
      </div>
    )
  }

  const effectiveDensity = density ?? 'comfortable'
  const padY = effectiveDensity === 'compact' ? 'py-1' : 'py-1.5'
  const padX = effectiveDensity === 'compact' ? 'px-2' : 'px-3'

  return (
    <div className="min-w-0 flex-1 flex-col">
      {/* Header */}
      <header className={`flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-card/80 backdrop-blur ${padX} ${padY}`}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Terminal</span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {terminals.map(session => (
            <button
              key={session.id}
              onClick={(e) => {
                // Tab selection is handled by the host (activeTerminalId).
                void e
              }}
              className={cn(
                'flex items-center gap-2 rounded-xl border px-2.5 py-1 text-xs transition-colors',
                session.id === activeTerminalId
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-transparent hover:bg-accent',
              )}
            >
              <span className="truncate max-w-[120px]">{session.id}</span>
              <button onClick={e => handleClose(session.id, e)} className="ml-1 p-0.5 opacity-60 hover:opacity-100">
                <Lucide.X className="size-3.5" aria-hidden="true" />
              </button>
            </button>
          ))}
          <Button size="icon-sm" variant="ghost" onClick={handleNew} title="New terminal">
            <Lucide.Plus className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">{activeTerminal?.connected ? 'Connected' : 'Disconnected'}</div>
      </header>

      {/* xterm.js viewport */}
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 bg-background"
        style={{
          fontFamily: 'IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      />

      {/* Status bar */}
      <footer className={`shrink-0 border-t border-border/60 bg-muted/50 text-xs ${padX} ${padY}`}>
        {activeTerminal !== null ? (
          <span className="mr-4">{activeTerminal.id}</span>
        ) : null}
        {activeTerminal !== null ? (
          <span className="mr-4">{activeTerminal.login}</span>
        ) : null}
        {activeTerminal !== null ? (
          <span className="mr-4 truncate max-w-[200px]">{activeTerminal.cwd}</span>
        ) : null}
        <span className="flex items-center gap-1">
          {activeTerminal !== null && activeTerminal.connected ? (
            <span className="size-1.5 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
          ) : (
            <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
          )}
          <span>{activeTerminal?.connected ? 'connected' : 'disconnected'}</span>
        </span>
        {activeTerminal !== null && activeTerminal.bytesOut !== undefined ? (
          <span className="ml-4">{activeTerminal.bytesOut} B out</span>
        ) : null}
      </footer>
    </div>
  )
}
