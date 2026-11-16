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
}

/**
 * The terminal extension's copy of the server's open sessions. The sidebar, dashboard card and panel all read it, so they agree.
 * It is a cache: the server is the source of truth, and each refresh replaces it.
 */
let current: TerminalSession[] = []
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
let subscribed = false

/**
 * Keeps the list current: subscribes to the server's session events and reconnects with backoff if the socket drops.
 * Starting it twice does nothing. The server sends the whole list on every connect, so a reconnect cannot leave it stale.
 */
export function startSessionEvents(url: string = eventsSocketUrl(window.location)): void {
  if (subscribed) {
    return
  }
  subscribed = true
  let attempt = 0
  const open = () => {
    const socket = new WebSocket(url)
    socket.onopen = () => {
      attempt = 0
    }
    socket.onmessage = event => {
      applySessionsFrame(String(event.data))
    }
    socket.onclose = () => {
      const delay = Math.min(MAX_RECONNECT_MS, 500 * 2 ** attempt)
      attempt += 1
      setTimeout(open, delay)
    }
  }
  open()
}

/** The list entry for a session the server reported or just created. */
export function terminalOf(view: Pick<SessionView, 'sid' | 'cwd'> & Partial<Pick<SessionView, 'chatId' | 'createdAt' | 'attached'>>): TerminalSession {
  return { id: view.sid, cwd: view.cwd, login: '', connected: view.attached ?? false, chatId: view.chatId ?? null, createdAt: view.createdAt }
}

/** The open sessions, newest first, re-rendering the caller when they change. */
export function useTerminalSessions(): TerminalSession[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** For tests only. */
export function resetSessionsForTesting(next: TerminalSession[] = []): void {
  setSessions(next)
}
