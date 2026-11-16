import type { SessionView } from './routes.ts'

/** The WebSocket route the browser subscribes to for session changes, under /api/extensions/remote-agent.terminal. */
export const EVENTS_WS_PATH = '/events'

/** A frame the server sends. The browser replaces its list with `sessions` every time. */
export type SessionsFrame = { type: 'sessions'; sessions: SessionView[] }

export type EventSocket = { send(data: string): void }

/**
 * The sockets subscribed to session changes. Each change is sent as the whole list, so a client that missed a frame is
 * right again with the next one, and no client has to merge deltas.
 */
export function createSessionEvents() {
  const sockets = new Set<EventSocket>()
  return {
    add(socket: EventSocket): void {
      sockets.add(socket)
    },
    remove(socket: EventSocket): void {
      sockets.delete(socket)
    },
    count(): number {
      return sockets.size
    },
    /** Sends the list to every subscriber. A socket that fails to take the frame is dropped. */
    publish(sessions: SessionView[]): void {
      const frame = frameOf(sessions)
      for (const socket of sockets) {
        try {
          socket.send(frame)
        } catch {
          sockets.delete(socket)
        }
      }
    },
  }
}

export function frameOf(sessions: SessionView[]): string {
  const frame: SessionsFrame = { type: 'sessions', sessions }
  return JSON.stringify(frame)
}
