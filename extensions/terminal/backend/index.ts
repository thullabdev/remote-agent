import type { ExtensionBackendApi } from '../../../../src/extension-sdk/index.ts'
import { createPtyManager, type PtyManager } from './pty.ts'

/** One WebSocket connection carries one terminal tab (one sid). Later: multiplex many sids on one WS. */
type WsState = { sid: string | null }

let ptyManager: PtyManager | null = null

export function onActivate(api: ExtensionBackendApi) {
  const allowedLogin = process.env.REMOTE_AGENT_WEB_ALLOWED_LOGIN ?? ''
  const origins = (process.env.REMOTE_AGENT_WEB_ORIGINS ?? '').split(',').filter(Boolean)

  ptyManager = createPtyManager({
    maxSessions: 8,
    idleAfterMs: 24 * 60 * 60 * 1000,
    log: (message, error) => {
      console.log(`[terminal] ${message}`)
      if (error !== undefined) {
        console.error(error)
      }
    },
  })

  // ws -> sid for this connection (one sid per WS in v1).
  const wsState = new WeakMap<object, WsState>()

  function stateOf(ws: object): WsState {
    let state = wsState.get(ws)
    if (state === undefined) {
      state = { sid: null }
      wsState.set(ws, state)
    }
    return state
  }

  function send(ws: object, message: object): void {
    ;(ws as { send(data: string): void }).send(JSON.stringify(message))
  }

  api.backend.registerWebSocketRoute('/terminal/ws', {
    open(ws) {
      // Auth was already enforced by startWebServer's authorize() before the upgrade.
      // The allowlisted login is the only user; sessions belong to that login.
      void allowedLogin
      void origins
    },
    message(ws, raw) {
      const pty = ptyManager
      if (pty === null) {
        send(ws, { type: 'error', message: 'terminal backend not ready' })
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
      } catch {
        return
      }
      const msg = parsed as { type?: string; sid?: string; cols?: number; rows?: number; data?: string }
      const state = stateOf(ws)

      switch (msg.type) {
        case 'open': {
          if (msg.sid === undefined || msg.cols === undefined || msg.rows === undefined) {
            send(ws, { type: 'error', message: 'open requires sid, cols, rows' })
            return
          }
          try {
            pty.open(msg.sid, msg.cols, msg.rows, msg.cwd ?? process.env.HOME ?? '/', allowedLogin)
            state.sid = msg.sid
          } catch (error) {
            send(ws, { type: 'error', sid: msg.sid, message: error instanceof Error ? error.message : String(error) })
            return
          }
          const unsub = pty.onOutput(msg.sid, data => {
            send(ws, { type: 'output', sid: msg.sid, data })
          })
          ;(ws as { __unsub?: () => void }).__unsub = unsub
          break
        }
        case 'input': {
          if (msg.sid === undefined || msg.data === undefined) {
            send(ws, { type: 'error', message: 'input requires sid, data' })
            return
          }
          try {
            pty.input(msg.sid, msg.data)
          } catch (error) {
            send(ws, { type: 'error', sid: msg.sid, message: error instanceof Error ? error.message : String(error) })
          }
          break
        }
        case 'resize': {
          if (msg.sid === undefined || msg.cols === undefined || msg.rows === undefined) {
            send(ws, { type: 'error', message: 'resize requires sid, cols, rows' })
            return
          }
          try {
            pty.resize(msg.sid, msg.cols, msg.rows)
          } catch (error) {
            send(ws, { type: 'error', sid: msg.sid, message: error instanceof Error ? error.message : String(error) })
          }
          break
        }
        case 'close': {
          if (msg.sid === undefined) {
            send(ws, { type: 'error', message: 'close requires sid' })
            return
          }
          try {
            pty.close(msg.sid)
          } catch (error) {
            send(ws, { type: 'error', sid: msg.sid, message: error instanceof Error ? error.message : String(error) })
          }
          break
        }
        default:
          send(ws, { type: 'error', message: `unknown type: ${msg.type}` })
      }
    },
    close(ws) {
      const pty = ptyManager
      const state = stateOf(ws)
      if (state.sid !== null && pty !== null) {
        // Detach: WebSocket closed but the PTY stays alive. The idle timer reaps after 24h.
        pty.detach(state.sid)
      }
      const unsub = (ws as { __unsub?: () => void }).__unsub
      if (unsub !== undefined) {
        unsub()
      }
    },
  })
}

export function onDeactivate() {
  ptyManager = null
}
