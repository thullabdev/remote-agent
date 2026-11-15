import { useCallback, useEffect, useRef, useState } from 'react'
import type { ITheme, Terminal as XtermTerminal } from '@xterm/xterm'
import { ArrowLeft, Plus, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
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

type Density = 'compact' | 'comfortable'

type TerminalPanelProps = {
  terminals: TerminalSession[]
  activeTerminalId: string | null
  /** Back to the chat list, or the General view. The terminal stays running; only its view is left. */
  onBack(): void
  onNew(): void
  /** Called after the session has been asked to close on the server. */
  onClose(sid: string): void
  density?: Density
}

/** Extension id from plugin.json. The host serves the terminal WebSocket under /api/extensions/<id>/. */
const TERMINAL_EXTENSION_ID = 'remote-agent.terminal'
const TERMINAL_WS_ROUTE = `/api/extensions/${TERMINAL_EXTENSION_ID}/ws`
const MAX_BACKOFF_MS = 15_000

/** What the server sends back over the terminal WebSocket. */
type ServerMessage =
  | { type: 'ready'; sid: string; cwd: string; created: boolean }
  | { type: 'replay'; sid: string; data: string }
  | { type: 'output'; sid: string; data: string }
  | { type: 'exit'; sid: string; code: number | null }
  | { type: 'error'; sid?: string; message: string }

type ViewportState = 'connecting' | 'connected' | 'reconnecting' | 'exited' | 'error'

type ViewportStatus = { state: ViewportState; cwd: string | null; message: string | null }

export function terminalSocketUrl(location: Location): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}${TERMINAL_WS_ROUTE}`
}

/** Asks the server to kill a session. Used for tabs that are not currently attached. */
export function requestSessionClose(sid: string): void {
  const socket = new WebSocket(terminalSocketUrl(window.location))
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'close', sid }))
    socket.close()
  }
  socket.onerror = () => {
    // Best effort: the tab is removed either way, and the idle timer reaps anything left behind.
  }
}

/** Terminal colours from the app's CSS tokens, so the terminal follows theme, accent and dark mode. */
export function themeFromCss(element: Element): ITheme {
  const style = getComputedStyle(element)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    background: token('--background', '#111111'),
    foreground: token('--foreground', '#eaeaea'),
    cursor: token('--primary', '#eaeaea'),
    selectionBackground: token('--accent', '#33405c'),
  }
}

export function TerminalPanel({ terminals, activeTerminalId, onBack, onNew, onClose, density = 'comfortable' }: TerminalPanelProps) {
  const [statuses, setStatuses] = useState<Record<string, ViewportStatus>>({})

  // A reload with ?terminal=<sid> has no entry in the list yet; the tab still has to reattach to its session.
  const tabs: TerminalSession[] =
    activeTerminalId === null || terminals.some(terminal => terminal.id === activeTerminalId)
      ? terminals
      : [...terminals, { id: activeTerminalId, cwd: '', login: '', connected: false }]

  // Bumped by Retry to remount the active viewport, which reopens its session.
  const [attempts, setAttempts] = useState<Record<string, number>>({})

  const activeTab = tabs.find(terminal => terminal.id === activeTerminalId) ?? null
  const activeStatus: ViewportStatus | undefined = activeTerminalId === null ? undefined : statuses[activeTerminalId]

  const reportStatus = useCallback((sid: string, patch: Partial<ViewportStatus>) => {
    setStatuses(current => ({
      ...current,
      [sid]: { state: 'connecting', cwd: null, message: null, ...current[sid], ...patch },
    }))
  }, [])

  const retry = (sid: string) => {
    setStatuses(current => ({ ...current, [sid]: { state: 'connecting', cwd: null, message: null } }))
    setAttempts(current => ({ ...current, [sid]: (current[sid] ?? 0) + 1 }))
  }

  const handleClose = (sid: string) => {
    requestSessionClose(sid)
    setStatuses(current => {
      const { [sid]: _removed, ...rest } = current
      return rest
    })
    onClose(sid)
  }

  if (tabs.length === 0) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-8 text-center md:flex">
        <div className="grid size-16 place-items-center rounded-3xl bg-card shadow-sm">
          <X className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="mt-5 font-display text-xl font-semibold tracking-tight">No terminal sessions</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Open a shell over Tailscale. Sessions survive reloads.</p>
        <Button className="mt-5" variant="outline" onClick={onNew}>
          <Plus className="mr-2 size-4" aria-hidden="true" />
          Start terminal
        </Button>
      </div>
    )
  }

  const padX = density === 'compact' ? 'px-2' : 'px-3'
  const padY = density === 'compact' ? 'py-1' : 'py-1.5'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className={cn('flex shrink-0 items-center gap-2 border-b border-border/60 bg-card/80 backdrop-blur', padX, padY)}>
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Back to chats" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <span className="shrink-0 text-sm font-medium text-foreground">Terminal</span>
        <div role="tablist" className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map(tab => {
            const selected = tab.id === activeTerminalId
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={selected}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-xl border pl-2.5 pr-1 py-1 text-xs transition-colors',
                  selected ? 'border-primary bg-primary text-primary-foreground' : 'border-transparent bg-muted text-muted-foreground hover:bg-accent',
                )}
              >
                <span className="max-w-[140px] truncate">{tab.id}</span>
                <button
                  type="button"
                  aria-label={`Close ${tab.id}`}
                  className="rounded-md p-0.5 opacity-60 hover:opacity-100"
                  onClick={() => handleClose(tab.id)}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onNew} title="New terminal" aria-label="New terminal">
          <Plus className="size-3.5" aria-hidden="true" />
        </Button>
      </header>

      {activeTerminalId !== null ? (
        <TerminalViewport
          key={`${activeTerminalId}:${attempts[activeTerminalId] ?? 0}`}
          sid={activeTerminalId}
          cwd={activeTab?.cwd ?? ''}
          density={density}
          onStatus={patch => reportStatus(activeTerminalId, patch)}
        />
      ) : null}

      <footer className={cn('flex shrink-0 items-center gap-4 border-t border-border/60 bg-muted/50 text-xs text-muted-foreground', padX, padY)}>
        {activeTerminalId !== null ? <span className="truncate">{activeTerminalId}</span> : null}
        {activeTab !== null && activeTab.login !== '' ? <span>{activeTab.login}</span> : null}
        {(activeStatus?.cwd ?? activeTab?.cwd) ? <span className="min-w-0 truncate">{activeStatus?.cwd ?? activeTab?.cwd}</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className={cn('size-1.5 rounded-full', dotClass(activeStatus?.state))} aria-hidden="true" />
          <span>{stateLabel(activeStatus)}</span>
        </span>
        {activeTerminalId !== null && activeStatus?.state === 'error' ? (
          <Button size="sm" variant="outline" onClick={() => retry(activeTerminalId)}>
            Retry
          </Button>
        ) : null}
      </footer>
    </div>
  )
}

/** One xterm instance on one WebSocket. It owns the connection, reconnects with backoff, and reattaches with `replay`. */
function TerminalViewport({ sid, cwd, density, onStatus }: { sid: string; cwd: string; density: Density; onStatus(patch: Partial<ViewportStatus>): void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus

  useEffect(() => {
    const host = hostRef.current
    if (host === null) {
      return
    }
    let disposed = false
    let finished = false
    let ready = false
    let backoffAttempt = 0
    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let term: XtermTerminal | null = null
    let resizeObserver: ResizeObserver | null = null
    let themeObserver: MutationObserver | null = null

    const send = (message: Record<string, unknown>) => {
      if (socket !== null && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message))
      }
    }

    const connect = () => {
      const ws = new WebSocket(terminalSocketUrl(window.location))
      socket = ws
      ws.onopen = () => {
        if (term === null) {
          return
        }
        send({ type: 'open', sid, cols: term.cols, rows: term.rows, ...(cwd === '' ? {} : { cwd }) })
      }
      ws.onmessage = event => {
        if (term === null) {
          return
        }
        let message: ServerMessage
        try {
          message = JSON.parse(String(event.data)) as ServerMessage
        } catch {
          return
        }
        switch (message.type) {
          case 'ready':
            ready = true
            backoffAttempt = 0
            statusRef.current({ state: 'connected', cwd: message.cwd, message: null })
            return
          case 'replay':
            // The buffer is the whole history so far: start from a clean screen, then write it.
            term.reset()
            term.write(message.data)
            return
          case 'output':
            term.write(message.data)
            return
          case 'exit':
            finished = true
            term.write(`\r\n\x1b[2m[shell exited${message.code === null ? '' : ` with code ${message.code}`}]\x1b[0m\r\n`)
            statusRef.current({ state: 'exited', message: null })
            return
          case 'error':
            if (!ready) {
              // The session could not be opened (already attached elsewhere, limit reached, another user's). Show it; Retry reopens.
              finished = true
              statusRef.current({ state: 'error', message: message.message })
              socket?.close()
              return
            }
            term.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`)
            return
        }
      }
      ws.onclose = () => {
        if (disposed || finished) {
          return
        }
        ready = false
        statusRef.current({ state: 'reconnecting', message: null })
        const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** backoffAttempt)
        backoffAttempt += 1
        retryTimer = setTimeout(connect, delay)
      }
    }

    // xterm is loaded on the client only, so the panel can render (and be tested) without a DOM.
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(([{ Terminal }, { FitAddon }]) => {
      if (disposed) {
        return
      }
      const fit = new FitAddon()
      term = new Terminal({
        cursorBlink: true,
        scrollback: 5000,
        fontFamily: 'IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: density === 'compact' ? 12 : 13,
        theme: themeFromCss(document.documentElement),
      })
      term.loadAddon(fit)
      term.open(host)
      fit.fit()
      term.onData(data => send({ type: 'input', sid, data }))
      term.onResize(({ cols, rows }) => send({ type: 'resize', sid, cols, rows }))
      resizeObserver = new ResizeObserver(() => fit.fit())
      resizeObserver.observe(host)
      themeObserver = new MutationObserver(() => {
        if (term !== null) {
          term.options.theme = themeFromCss(document.documentElement)
        }
      })
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
      statusRef.current({ state: 'connecting', message: null })
      connect()
    })

    return () => {
      disposed = true
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
      }
      resizeObserver?.disconnect()
      themeObserver?.disconnect()
      socket?.close()
      term?.dispose()
    }
    // The viewport is keyed by sid and retry count in the parent, so the inputs here never change for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid])

  return <div ref={hostRef} className={cn('min-h-0 flex-1 bg-background', density === 'compact' ? 'p-1' : 'p-2')} />
}

function stateLabel(status: ViewportStatus | undefined): string {
  switch (status?.state) {
    case 'connected':
      return 'connected'
    case 'reconnecting':
      return 'reconnecting…'
    case 'exited':
      return 'exited'
    case 'error':
      return status.message ?? 'error'
    case 'connecting':
    case undefined:
      return 'connecting…'
  }
}

function dotClass(state: ViewportState | undefined): string {
  switch (state) {
    case 'connected':
      return 'bg-green-500'
    case 'error':
      return 'bg-red-500'
    case 'exited':
      return 'bg-muted-foreground'
    default:
      return 'bg-amber-500'
  }
}
