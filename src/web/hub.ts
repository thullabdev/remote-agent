import type { ChatLog } from './chat-log.ts'
import type { ServerEvent } from './protocol.ts'

/** The part of a WebSocket the hub needs. Bun's ServerWebSocket satisfies it; tests pass a fake. */
export type HubSocket = {
  send(data: string): void
  close(code?: number, reason?: string): void
  getBufferedAmount(): number
}

export type ClientId = string
export type Presence = { visible: boolean; focused: boolean; chatId: string | null }

/** A client whose unsent bytes pass this is dropped rather than buffered. */
export const SLOW_CLIENT_BYTES = 8 * 1024 * 1024
const SLOW_CLOSE_CODE = 1013
const SEND_FAILED_CLOSE_CODE = 1011
const STALE_CLOSE_CODE = 1000

/** Closes a socket, swallowing any error: the caller has already dropped the client. */
export function closeQuietly(socket: HubSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason)
  } catch {
    // The socket is already gone; nothing else to do.
  }
}

type Client = { id: ClientId; socket: HubSocket; presence: Presence; lastSeen: number }

/** Live fan-out to the connected WebSocket clients, with presence and stale-client reaping. */
export class Hub {
  private readonly clients = new Map<ClientId, Client>()
  private nextId = 1

  constructor(
    private readonly chatLog: Pick<ChatLog, 'eventsAfter'>,
    private readonly now: () => number = Date.now,
  ) {}

  add(socket: HubSocket): ClientId {
    const id = `client-${this.nextId}`
    this.nextId += 1
    this.clients.set(id, { id, socket, presence: { visible: false, focused: false, chatId: null }, lastSeen: this.now() })
    return id
  }

  clientCount(): number {
    return this.clients.size
  }

  remove(id: ClientId): void {
    this.clients.delete(id)
  }

  setPresence(id: ClientId, presence: Presence): void {
    const client = this.clients.get(id)
    if (client !== undefined) {
      client.presence = presence
    }
  }

  anyActive(): boolean {
    return [...this.clients.values()].some(client => client.presence.visible && client.presence.focused)
  }

  touch(id: ClientId): void {
    const client = this.clients.get(id)
    if (client !== undefined) {
      client.lastSeen = this.now()
    }
  }

  broadcast(event: ServerEvent): void {
    for (const id of [...this.clients.keys()]) {
      this.send(id, event)
    }
  }

  /** Sends the events after `after` to one client, or a resync when they are no longer kept. */
  replay(id: ClientId, after: number): void {
    const events = this.chatLog.eventsAfter(after)
    if (events === 'resync') {
      this.send(id, { type: 'resync' })
      return
    }
    for (const event of events) {
      if (!this.send(id, event)) {
        return
      }
    }
  }

  /** Drops every client not heard from for longer than `maxIdleMs`. Returns how many were dropped. */
  reapStale(maxIdleMs: number): number {
    const cutoff = this.now() - maxIdleMs
    let reaped = 0
    for (const client of [...this.clients.values()]) {
      if (client.lastSeen < cutoff) {
        this.drop(client, STALE_CLOSE_CODE, 'no ping answered')
        reaped += 1
      }
    }
    return reaped
  }

  private send(id: ClientId, payload: ServerEvent): boolean {
    const client = this.clients.get(id)
    if (client === undefined) {
      return false
    }
    try {
      if (client.socket.getBufferedAmount() > SLOW_CLIENT_BYTES) {
        this.drop(client, SLOW_CLOSE_CODE, 'client too slow')
        return false
      }
      client.socket.send(JSON.stringify(payload))
      return true
    } catch {
      this.drop(client, SEND_FAILED_CLOSE_CODE, 'send failed')
      return false
    }
  }

  /** Removes a client and closes its socket so it does not stay connected while missing events. */
  private drop(client: Client, code: number, reason: string): void {
    this.clients.delete(client.id)
    closeQuietly(client.socket, code, reason)
  }
}
