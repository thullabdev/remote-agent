import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ITheme, Terminal as XtermTerminal } from '@xterm/xterm'
import { Maximize2, Minimize2, Plus, Terminal as TerminalIcon, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { cn } from '../../../src/ui/lib/utils.ts'
import type { SideTabContext } from '../../../src/ui/extension-slots.ts'
import { chatFolder, startTerminal } from './actions.ts'
import { FolderPicker } from './FolderPicker.tsx'
import { projectName, tabLabel } from './grouping.ts'
import { refreshSessions, removeSession, startSessionEvents, useSelectedTerminalId, useTerminalSessions, selectTerminal, type TerminalSession } from './store.ts'
import { closeSession } from './sessions-client.ts'
import { attachTouchScroll } from './touch-scroll.ts'

export type { TerminalSession } from './store.ts'

type Density = 'compact' | 'comfortable'

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
  | { type: 'error'; sid?: string; code?: string; message: string }

type ViewportState = 'connecting' | 'connected' | 'reconnecting' | 'exited' | 'error'

/** `code` is set for an open that the server refused with a reason the UI acts on, such as `not_found`. */
type ViewportStatus = { state: ViewportState; cwd: string | null; message: string | null; code: string | null }

export function terminalSocketUrl(location: Location): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}${TERMINAL_WS_ROUTE}`
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

/** One xterm instance on one WebSocket. It owns the connection, reconnects with backoff, and reattaches with `replay`. */
function TerminalViewport({ sid, density, onStatus }: { sid: string; density: Density; onStatus(patch: Partial<ViewportStatus>): void }) {
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
    let detachTouchScroll: (() => void) | null = null
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
        // The folder is stored on the server with the session; the client only says how big its screen is.
        send({ type: 'open', sid, cols: term.cols, rows: term.rows })
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
            statusRef.current({ state: 'connected', cwd: message.cwd, message: null, code: null })
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
            statusRef.current({ state: 'exited', message: null, code: null })
            return
          case 'error':
            if (!ready) {
              // The session could not be opened (already attached elsewhere, limit reached, another user's). Show it; Retry reopens.
              finished = true
              statusRef.current({ state: 'error', message: message.message, code: message.code ?? null })
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
        statusRef.current({ state: 'reconnecting', message: null, code: null })
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
      // Touch drags scroll tmux's scrollback through wheel events, since a finger sends no wheel of its own.
      detachTouchScroll = attachTouchScroll(host, () => ({ cols: term?.cols ?? 80, rows: term?.rows ?? 24 }), data => send({ type: 'input', sid, data }))
      resizeObserver = new ResizeObserver(() => fit.fit())
      resizeObserver.observe(host)
      themeObserver = new MutationObserver(() => {
        if (term !== null) {
          term.options.theme = themeFromCss(document.documentElement)
        }
      })
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
      statusRef.current({ state: 'connecting', message: null, code: null })
      connect()
    })

    return () => {
      disposed = true
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
      }
      resizeObserver?.disconnect()
      themeObserver?.disconnect()
      detachTouchScroll?.()
      socket?.close()
      term?.dispose()
    }
    // The viewport is keyed by sid and retry count in the parent, so the inputs here never change for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid])

  return <div ref={hostRef} className={cn('min-h-0 flex-1 touch-none bg-background', density === 'compact' ? 'p-1' : 'p-2')} />
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

/**
 * One shell in the tab row: a label that selects it, and a close control that shows on hover or when the tab is selected.
 * The folder reads first; the foreground command follows, muted.
 */
function TerminalTab({ term, selected, onSelect, onClose }: { term: TerminalSession; selected: boolean; onSelect(sid: string): void; onClose(sid: string): void }) {
  const label = tabLabel(term)
  const folder = projectName(term.cwd)
  const command = term.command ? label.slice(folder.length) : ''
  return (
    <div className="group relative flex shrink-0 items-center">
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        title={`${label} · ${term.cwd}`}
        onClick={() => onSelect(term.id)}
        className={cn(
          'max-w-[220px] truncate py-2 text-xs transition-colors',
          selected ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <span>{folder}</span>
        {command !== '' ? <span className="text-muted-foreground"> {command.trimStart()}</span> : null}
      </button>
      <button
        type="button"
        aria-label={`Close ${label}`}
        title="Close this terminal"
        onClick={() => onClose(term.id)}
        className={cn(
          'mr-1 grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground',
          selected ? 'opacity-70' : 'opacity-0 group-hover:opacity-70 focus-visible:opacity-70',
        )}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
      {selected ? <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" aria-hidden="true" /> : null}
    </div>
  )
}

/**
 * The terminal side tab: a "Terminal" header with the add button, the shell pills when more than one is open, and the emulator of
 * the selected shell. Add starts a shell in the active chat's folder; with no folder, it asks which trusted project to use.
 */
export function TerminalsSideTab({ activeChat, notify, density }: SideTabContext) {
  const terminals = useTerminalSessions()
  const selected = useSelectedTerminalId(terminals)
  const [statuses, setStatuses] = useState<Record<string, ViewportStatus>>({})
  // Bumped by Retry to remount the viewport, which reopens its session.
  const [attempts, setAttempts] = useState<Record<string, number>>({})
  const [picking, setPicking] = useState(false)
  // Full screen covers the whole app. It is drawn in a portal, since the side column's transform would otherwise contain it.
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    // The events socket keeps the list current; the one-off read fills it before the first frame arrives.
    startSessionEvents()
    void refreshSessions().catch(() => {
      // The terminal extension may be unreachable; the empty state still shows.
    })
  }, [])

  const reportStatus = useCallback((sid: string, patch: Partial<ViewportStatus>) => {
    setStatuses(current => ({
      ...current,
      [sid]: { state: 'connecting', cwd: null, message: null, code: null, ...current[sid], ...patch },
    }))
  }, [])

  const retry = (sid: string) => {
    setStatuses(current => ({ ...current, [sid]: { state: 'connecting', cwd: null, message: null, code: null } }))
    setAttempts(current => ({ ...current, [sid]: (current[sid] ?? 0) + 1 }))
  }

  const handleClose = (sid: string) => {
    // The pill goes only once the server has killed the shell. If that fails, the pill stays and the status says why.
    closeSession(sid)
      .then(() => {
        setStatuses(current => {
          const { [sid]: _removed, ...rest } = current
          return rest
        })
        removeSession(sid)
      })
      .catch(error => {
        reportStatus(sid, { state: 'error', message: error instanceof Error ? error.message : 'could not close the terminal' })
      })
  }

  const folder = chatFolder(activeChat)
  const addTerminal = () => {
    if (folder === undefined || activeChat === null) {
      setPicking(true)
      return
    }
    void startTerminal({ cwd: folder, chatId: activeChat.id }, notify)
  }

  const folderOf = (sid: string | null): string | undefined => terminals.find(terminal => terminal.id === sid)?.cwd
  const activeTab = terminals.find(terminal => terminal.id === selected) ?? null
  const activeStatus: ViewportStatus | undefined = selected === null ? undefined : statuses[selected]
  const padX = density === 'compact' ? 'px-3' : 'px-4'

  const panel = (
    <section aria-labelledby="side-terminal-title" className="relative flex min-h-0 flex-1 flex-col">
      <header className={cn('flex h-14 shrink-0 items-center gap-2', padX)}>
        <h2 id="side-terminal-title" className="min-w-0 flex-1 truncate font-display text-xl font-semibold tracking-tight">
          Terminal
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          aria-pressed={fullscreen}
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
          onClick={() => setFullscreen(value => !value)}
        >
          {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </Button>
        <Button size="icon" className="hidden md:inline-flex" aria-label="New terminal" title={folder === undefined ? 'Start a terminal in a project' : 'Start a terminal in this session\'s folder'} onClick={addTerminal}>
          <Plus aria-hidden="true" />
        </Button>
      </header>


      {terminals.length > 1 ? (
        <div
          role="tablist"
          aria-label="Open terminals"
          className={cn('flex shrink-0 gap-4 overflow-x-auto overflow-y-hidden border-b border-border/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', padX)}
        >
          {terminals.map(term => (
            <TerminalTab key={term.id} term={term} selected={term.id === selected} onSelect={sid => selectTerminal(sid)} onClose={handleClose} />
          ))}
        </div>
      ) : null}

      {selected !== null ? (
        <footer className={cn('flex shrink-0 items-center gap-4 border-b border-border/60 text-xs text-muted-foreground', padX, 'py-1.5')}>
          {activeTab !== null && activeTab.cwd !== '' ? (
            <span className="min-w-0 truncate" title="The folder this shell was started in">
              Started in {activeTab.cwd}
            </span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <span className={cn('size-1.5 rounded-full', dotClass(activeStatus?.state))} aria-hidden="true" />
            <span>{stateLabel(activeStatus)}</span>
          </span>
          {activeStatus?.state === 'error' ? (
            <Button size="sm" variant="outline" onClick={() => retry(selected)}>
              Retry
            </Button>
          ) : null}
        </footer>
      ) : null}

      {selected !== null ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <TerminalViewport
            key={`${selected}:${attempts[selected] ?? 0}`}
            sid={selected}
            density={density}
            onStatus={patch => reportStatus(selected, patch)}
          />
          {activeStatus?.code === 'not_found' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 px-8 text-center">
              <p className="font-display text-lg font-semibold tracking-tight">This shell has ended</p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Its session is closed, so there is nothing to reattach to.</p>
              <Button className="mt-4" variant="outline" onClick={() => void startTerminal({ cwd: folderOf(selected) }, notify)}>
                Start a new shell{folderOf(selected) === undefined ? '' : ' here'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="grid size-16 place-items-center rounded-3xl bg-card shadow-sm">
            <TerminalIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="mt-5 font-display text-xl font-semibold tracking-tight">No terminal sessions</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Start a shell in this session's folder, or pick a project.</p>
          <Button className="mt-5" variant="outline" onClick={addTerminal}>
            <Plus className="mr-2 size-4" aria-hidden="true" />
            Start terminal
          </Button>
        </div>
      )}


      <Button size="icon" className="absolute bottom-4 right-4 z-20 size-14 rounded-full shadow-lg md:hidden" aria-label="New terminal" title="New terminal" onClick={addTerminal}>
        <Plus className="size-6" aria-hidden="true" />
      </Button>

      <FolderPicker open={picking} onOpenChange={setPicking} onPick={cwd => void startTerminal({ cwd }, notify)} />
    </section>
  )

  if (fullscreen) {
    return createPortal(<div className="fixed inset-0 z-50 flex flex-col bg-background">{panel}</div>, document.body)
  }
  return panel
}
