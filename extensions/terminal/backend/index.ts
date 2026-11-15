import { z } from 'zod'
import type { ExtensionApi } from '../../../src/extension-sdk/index.ts'
import { createPtyManager, type PtyManager } from './pty.ts'

/** Route path under /api/extensions/remote-agent.terminal (the host adds the prefix). One WebSocket carries one terminal tab. */
export const TERMINAL_WS_PATH = '/ws'

const MAX_SESSIONS = 8
const IDLE_AFTER_MS = 24 * 60 * 60 * 1000
const MAX_INPUT_CHARS = 64 * 1024

const Sid = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)
const Cols = z.number().int().min(1).max(500)
const Rows = z.number().int().min(1).max(200)

/** Every frame from the browser is validated before it touches a PTY. */
const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), sid: Sid, cols: Cols, rows: Rows, cwd: z.string().max(4096).optional() }),
  z.object({ type: z.literal('input'), sid: Sid, data: z.string().max(MAX_INPUT_CHARS) }),
  z.object({ type: z.literal('resize'), sid: Sid, cols: Cols, rows: Rows }),
  z.object({ type: z.literal('close'), sid: Sid }),
])
export type ClientMessage = z.infer<typeof ClientMessage>

/** What one WebSocket is attached to. Stored per socket, never shared. */
type Attachment = { sid: string; onOutput: (data: string) => void; onExit: (code: number | null) => void }

const attachments = new WeakMap<object, Attachment>()
let manager: PtyManager | null = null

export function onActivate(api: ExtensionApi) {
  // The Tailscale login the host already authorized. The upgrade is refused before this route runs for anyone else.
  // With no login configured, nothing may open a shell.
  const ownerLogin = process.env.REMOTE_AGENT_WEB_ALLOWED_LOGIN ?? ''

  manager = createPtyManager({
    maxSessions: MAX_SESSIONS,
    idleAfterMs: IDLE_AFTER_MS,
    log: (message, error) => {
      console.log(`[terminal] ${message}`)
      if (error !== undefined) {
        console.error(error)
      }
    },
  })
  const pty = manager

  api.backend.registerWebSocketRoute(TERMINAL_WS_PATH, {
    open(rawSocket) {
      if (ownerLogin === '') {
        send(rawSocket, { type: 'error', message: 'terminal is disabled: REMOTE_AGENT_WEB_ALLOWED_LOGIN is not set' })
        ;(rawSocket as { close(code?: number, reason?: string): void }).close(1008, 'terminal disabled')
      }
    },

    message(rawSocket, raw) {
      if (ownerLogin === '') {
        return
      }
      const parsed = parseClientMessage(raw)
      if (parsed === null) {
        send(rawSocket, { type: 'error', message: 'invalid terminal message' })
        return
      }
      const attached = attachments.get(rawSocket)

      switch (parsed.type) {
        case 'open': {
          if (attached !== undefined) {
            send(rawSocket, { type: 'error', sid: parsed.sid, message: 'this connection already has a terminal open' })
            return
          }
          const sid = parsed.sid
          const onOutput = (data: string) => send(rawSocket, { type: 'output', sid, data })
          const onExit = (code: number | null) => {
            attachments.delete(rawSocket)
            send(rawSocket, { type: 'exit', sid, code })
          }
          try {
            const result = pty.open({ sid, cols: parsed.cols, rows: parsed.rows, cwd: parsed.cwd, ownerLogin, onOutput, onExit })
            attachments.set(rawSocket, { sid, onOutput, onExit })
            send(rawSocket, { type: 'ready', sid, cwd: result.cwd, created: result.created })
            send(rawSocket, { type: 'replay', sid, data: result.replay })
          } catch (error) {
            send(rawSocket, { type: 'error', sid, message: messageOf(error) })
          }
          return
        }

        case 'input': {
          if (attached === undefined || attached.sid !== parsed.sid) {
            send(rawSocket, { type: 'error', sid: parsed.sid, message: 'session is not open on this connection' })
            return
          }
          runOrReport(rawSocket, parsed.sid, () => pty.input(parsed.sid, ownerLogin, parsed.data))
          return
        }

        case 'resize': {
          if (attached === undefined || attached.sid !== parsed.sid) {
            send(rawSocket, { type: 'error', sid: parsed.sid, message: 'session is not open on this connection' })
            return
          }
          runOrReport(rawSocket, parsed.sid, () => pty.resize(parsed.sid, ownerLogin, parsed.cols, parsed.rows))
          return
        }

        case 'close': {
          // Closing needs no attachment: a tab can be closed from a socket that never opened it.
          runOrReport(rawSocket, parsed.sid, () => pty.close(parsed.sid, ownerLogin))
          if (attached?.sid === parsed.sid) {
            attachments.delete(rawSocket)
          }
          return
        }
      }
    },

    close(rawSocket) {
      const attached = attachments.get(rawSocket)
      attachments.delete(rawSocket)
      if (attached !== undefined) {
        // The shell keeps running after the socket goes (reload, network blip). It is reaped after the idle timeout.
        pty.detach(attached.sid, attached.onOutput)
      }
    },
  })
}

export function onDeactivate() {
  manager?.dispose()
  manager = null
}

function parseClientMessage(raw: string | Buffer): ClientMessage | null {
  let json: unknown
  try {
    json = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
  } catch {
    return null
  }
  const result = ClientMessage.safeParse(json)
  return result.success ? result.data : null
}

function runOrReport(socket: object, sid: string, action: () => void): void {
  try {
    action()
  } catch (error) {
    send(socket, { type: 'error', sid, message: messageOf(error) })
  }
}

function send(socket: object, message: Record<string, unknown>): void {
  ;(socket as { send(data: string): void }).send(JSON.stringify(message))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
