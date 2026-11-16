import { useSyncExternalStore } from 'react'
import { listSessions, TERMINAL_API, type SessionView } from './sessions-client.ts'

/** A terminal session as the terminal UI shows it. `connected` means a browser has it open right now. */
export type TerminalSession = {
  id: string
  /** The folder the shell was started in. It does not follow `cd`. */
  cwd: string
  login: string
  connected: boolean
  bytesIn?: number
  bytesOut?: number
  project?: string
  chatId?: string | null
  createdAt?: number
  /** What the shell is running in the foreground; its own name when idle. Null or absent when unknown. */
  command?: string | null
}

/**
 * The terminal extension's copy of the server's open sessions. The sidebar, dashboard card and panel all read it, so they agree.
 * It is a cache: the server is the source of truth, and each refresh replaces it.
 */
let current: TerminalSession[] = []
/** The shell the person chose to see. Only meaningful while it is open; see `resolveSelected`. */
let selectedSid: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): TerminalSession[] {
  return current
}

function selectedSnapshot(): string | null {
  return selectedSid
}

/** Shows a shell in the side tab. */
export function selectTerminal(sid: string): void {
  selectedSid = sid
  emit()
}

/**
 * The shell the side tab shows: the chosen one while it is open, otherwise the newest open one (the list is newest first),
 * or none when no shell is open.
 */
export function resolveSelected(sessions: TerminalSession[], chosen: string | null): string | null {
  if (chosen !== null && sessions.some(session => session.id === chosen)) {
    return chosen
  }
  return sessions[0]?.id ?? null
}

/** The current list, read without React. */
export function currentSessions(): TerminalSession[] {
  return current
}

export function setSessions(next: TerminalSession[]): void {
  current = next
  emit()
}

export function addSession(session: TerminalSession): void {
  setSessions([session, ...current.filter(existing => existing.id !== session.id)])
}

export function removeSession(sid: string): void {
  setSessions(current.filter(existing => existing.id !== sid))
}

/** Reads the server's list of open sessions and replaces the cache with it. */
export async function refreshSessions(): Promise<TerminalSession[]> {
  const sessions = (await listSessions()).map(terminalOf)
  setSessions(sessions)
  return sessions
}

/** The WebSocket the server pushes session changes on. Same origin as the page, so the host's auth and origin checks apply. */
export function eventsSocketUrl(location: Location): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}${TERMINAL_API}/events`
}

/** Applies one frame from the server: a `sessions` frame replaces the list. Returns whether the frame was used. */
export function applySessionsFrame(data: string): boolean {
  let frame: unknown
  try {
    frame = JSON.parse(data)
  } catch {
    return false
  }
  if (typeof frame !== 'object' || frame === null || (frame as { type?: unknown }).type !== 'sessions') {
    return false
  }
  const sessions = (frame as { sessions?: unknown }).sessions
  if (!Array.isArray(sessions)) {
    return false
  }
  setSessions((sessions as SessionView[]).map(terminalOf))
  return true
}

const MAX_RECONNECT_MS = 15_000
/** The server sends the list every 15 seconds, so 40 seconds of silence means the connection is gone even without a close. */
export const STALE_AFTER_MS = 40_000
const WATCH_EVERY_MS = 5_000
/** On return to the page, a socket quiet for longer than a heartbeat and a half is replaced. */
const RESUME_STALE_MS = 20_000
let subscribed = false

/** Whether an open connection has gone quiet for too long to trust. */
export function isStale(lastFrameAt: number, now: number, limitMs: number = STALE_AFTER_MS): boolean {
  return now - lastFrameAt > limitMs
}

/**
 * Keeps the list current. Subscribes to the server's session events, reconnects with backoff when the socket closes, and treats a
 * quiet socket as dead. When the page is shown again or the network returns, it reconnects at once and reads the list over HTTP too.
 * Starting it twice does nothing. The server sends the whole list on every connect, so a reconnect cannot leave it stale.
 */
export function startSessionEvents(url: string = eventsSocketUrl(window.location)): void {
  if (subscribed) {
    return
  }
  subscribed = true
  let socket: WebSocket | null = null
  let attempt = 0
  let lastFrameAt = 0
  let retry: ReturnType<typeof setTimeout> | null = null

  const schedule = (delay: number) => {
    if (retry !== null) {
      clearTimeout(retry)
    }
    retry = setTimeout(() => {
      retry = null
      open()
    }, delay)
  }

  const open = () => {
    const next = new WebSocket(url)
    socket = next
    next.onopen = () => {
      attempt = 0
      lastFrameAt = Date.now()
    }
    next.onmessage = event => {
      lastFrameAt = Date.now()
      applySessionsFrame(String(event.data))
    }
    next.onclose = () => {
      if (socket === next) {
        socket = null
      }
      const delay = Math.min(MAX_RECONNECT_MS, 500 * 2 ** attempt)
      attempt += 1
      schedule(delay)
    }
  }

  // A socket that stops hearing from the server is closed, which starts the reconnect above.
  setInterval(() => {
    if (socket !== null && socket.readyState === WebSocket.OPEN && isStale(lastFrameAt, Date.now())) {
      socket.close()
    }
  }, WATCH_EVERY_MS)

  // Coming back to the page or the network: reconnect now rather than after the backoff, and read the list again.
  const comeBack = () => {
    // After sleep a socket can still say it is open while it is dead: a long silence means it must be replaced.
    if (socket !== null && socket.readyState === WebSocket.OPEN && isStale(lastFrameAt, Date.now(), RESUME_STALE_MS)) {
      socket.close()
    }
    if (socket === null) {
      attempt = 0
      schedule(0)
    }
    void refreshSessions().catch(() => {
      // Unreachable for now; the socket keeps trying.
    })
  }
  window.addEventListener('online', comeBack)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      comeBack()
    }
  })

  open()
}

/** The list entry for a session the server reported or just created. */
export function terminalOf(view: Pick<SessionView, 'sid' | 'cwd'> & Partial<Pick<SessionView, 'chatId' | 'createdAt' | 'attached' | 'command'>>): TerminalSession {
  return {
    id: view.sid,
    cwd: view.cwd,
    login: '',
    connected: view.attached ?? false,
    chatId: view.chatId ?? null,
    createdAt: view.createdAt,
    command: view.command ?? null,
  }
}

/** The open sessions, newest first, re-rendering the caller when they change. */
export function useTerminalSessions(): TerminalSession[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** The shell the side tab shows, given the open sessions. Re-renders the caller when either changes. */
export function useSelectedTerminalId(sessions: TerminalSession[]): string | null {
  const chosen = useSyncExternalStore(subscribe, selectedSnapshot, selectedSnapshot)
  return resolveSelected(sessions, chosen)
}

/** For tests only. */
export function resetSessionsForTesting(next: TerminalSession[] = []): void {
  selectedSid = null
  setSessions(next)
}
