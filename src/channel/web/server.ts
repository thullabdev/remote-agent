import { stat } from 'node:fs/promises'
import type { Server, ServerWebSocket } from 'bun'
import { extname, join, resolve, sep } from 'node:path'
import type { WebConfig } from '../../bridge/config.ts'
import type { Log } from '../../bridge/prompts.ts'
import { authorize } from './auth.ts'
import type { ChatLog } from './chat-log.ts'
import { closeQuietly, Hub } from './hub.ts'
import { ClientEventSchema } from './protocol.ts'

const MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024
const MAX_FRAME_BYTES = 16 * 1024 * 1024
const WS_IDLE_TIMEOUT_SECONDS = 120
const REAP_INTERVAL_MS = 30_000
const STALE_AFTER_MS = 90_000

type SocketData = { after: number; id: string | null }

export type WebServerDeps = {
  config: WebConfig
  chatLog: ChatLog
  api: (request: Request) => Promise<Response | null>
  hub: Hub
  log: Log
  port?: number
  idleMs?: number
}

export type WebServer = { port: number; hostname: string; stop(): void }

function json(body: unknown, status: number): Response {
  return Response.json(body, { status })
}

/** The only thing a client sees of an internal failure; the detail goes to the log. */
function internalError(log: Log, message: string, error: unknown): Response {
  log(message, error)
  return json({ error: 'internal error' }, 500)
}

/** Parses the `after` query value; null when it is missing or not a whole number. */
function parseAfter(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** Maps a request path under `staticDir`, or null when it would leave that directory. */
function resolveStaticPath(staticDir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.split(/[\\/]/).includes('..')) {
    return null
  }
  const root = resolve(staticDir)
  const target = resolve(root, `.${decoded}`)
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    return null
  }
  return target
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function fileResponse(path: string, noCache: boolean): Promise<Response> {
  const headers = noCache ? { 'Cache-Control': 'no-cache' } : undefined
  return new Response(Bun.file(path), { headers })
}

/** Serves a file under `staticDir`; a path with no extension that is missing falls back to index.html. */
async function serveStatic(staticDir: string | null, pathname: string): Promise<Response> {
  if (staticDir === null) {
    return json({ error: 'not found' }, 404)
  }
  const target = resolveStaticPath(staticDir, pathname)
  if (target === null) {
    return json({ error: 'not found' }, 404)
  }
  if (await isFile(target)) {
    return fileResponse(target, false)
  }
  if (extname(pathname) !== '') {
    return json({ error: 'not found' }, 404)
  }
  const index = join(resolve(staticDir), 'index.html')
  if (await isFile(index)) {
    return fileResponse(index, true)
  }
  return json({ error: 'not found' }, 404)
}

function frameText(raw: string | Buffer): string {
  return typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
}

/** Origin and Fetch Metadata as logged for a refused request; absent headers show as "(absent)". */
function originDetails(request: Request): string {
  const field = (name: string): string => JSON.stringify((request.headers.get(name) ?? '(absent)').slice(0, 200))
  return `origin=${field('Origin')} fetch-site=${field('Sec-Fetch-Site')} fetch-mode=${field('Sec-Fetch-Mode')} fetch-dest=${field('Sec-Fetch-Dest')}`
}

/** Starts the HTTP and WebSocket server on loopback: auth, then /ws, then the API, then static files. */
export function startWebServer(deps: WebServerDeps): WebServer {
  const { config, chatLog, hub, log } = deps
  const staleAfterMs = deps.idleMs ?? STALE_AFTER_MS
  const sockets = new Set<ServerWebSocket<SocketData>>()

  /** Routes one request; any throw becomes the generic 500 in `fetch`. */
  async function handle(request: Request, server: Server<SocketData>): Promise<Response | undefined> {
    const auth = authorize(request, { allowedLogin: config.allowedLogin, origins: config.origins, token: config.token })
    if (!auth.ok) {
      // Method, path and the fixed reason only: never the query string, login or token.
      // For origin refusals, also the Origin and Fetch Metadata headers (short, client-chosen values), quoted so each stays on one line.
      const origin = auth.reason === 'origin not allowed' ? ` ${originDetails(request)}` : ''
      log(`web request refused: ${request.method} ${new URL(request.url).pathname} ${auth.status} ${auth.reason}${origin}`)
      return json({ error: auth.reason }, auth.status)
    }
    const url = new URL(request.url)
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return json({ error: 'expected a WebSocket upgrade' }, 400)
      }
      const after = parseAfter(url.searchParams.get('after')) ?? chatLog.currentSeq()
      if (server.upgrade(request, { data: { after, id: null } })) {
        return undefined
      }
      return json({ error: 'expected a WebSocket upgrade' }, 400)
    }
    const handled = await deps.api(request)
    if (handled !== null) {
      return handled
    }
    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'not found' }, 404)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'not found' }, 404)
    }
    return serveStatic(config.staticDir, url.pathname)
  }

  const server = Bun.serve<SocketData, string>({
    hostname: '127.0.0.1',
    port: deps.port ?? config.port,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    websocket: {
      maxPayloadLength: MAX_FRAME_BYTES,
      idleTimeout: WS_IDLE_TIMEOUT_SECONDS,
      sendPings: true,
      open(ws) {
        sockets.add(ws)
        try {
          // Synchronous from hello to registration, so no live event can land between replay and the client joining.
          ws.send(JSON.stringify({ type: 'hello', seq: chatLog.currentSeq() }))
          ws.data.id = hub.add(ws)
          hub.replay(ws.data.id, ws.data.after)
        } catch (error) {
          log('web socket handshake failed', error)
          if (ws.data.id !== null) {
            hub.remove(ws.data.id)
            ws.data.id = null
          }
          closeQuietly(ws, 1011, 'handshake failed')
        }
      },
      message(ws, raw) {
        try {
          const id = ws.data.id
          if (id === null) {
            return
          }
          hub.touch(id)
          let parsed: unknown
          try {
            parsed = JSON.parse(frameText(raw))
          } catch {
            return
          }
          const event = ClientEventSchema.safeParse(parsed)
          if (!event.success) {
            return
          }
          if (event.data.type === 'presence') {
            hub.setPresence(id, { visible: event.data.visible, focused: event.data.focused, chatId: event.data.chatId })
          } else {
            ws.send(JSON.stringify({ type: 'pong' }))
          }
        } catch (error) {
          log('web socket frame failed', error)
        }
      },
      pong(ws) {
        try {
          if (ws.data.id !== null) {
            hub.touch(ws.data.id)
          }
        } catch (error) {
          log('web socket pong failed', error)
        }
      },
      close(ws) {
        try {
          sockets.delete(ws)
          if (ws.data.id !== null) {
            hub.remove(ws.data.id)
            ws.data.id = null
          }
        } catch (error) {
          log('web socket close failed', error)
        }
      },
    },
    fetch(request, server) {
      return handle(request, server).catch(error => internalError(log, 'web request failed', error))
    },
    error(error) {
      return internalError(log, 'web request failed', error)
    },
  })

  // Subscribed only once the port is bound, so a failed bind leaks no subscription or timer.
  const unsubscribe = chatLog.subscribe(event => {
    try {
      hub.broadcast(event)
    } catch (error) {
      log('web broadcast failed', error)
    }
  })
  const reaper = setInterval(() => {
    try {
      hub.reapStale(staleAfterMs)
    } catch (error) {
      log('web stale-client sweep failed', error)
    }
  }, REAP_INTERVAL_MS)

  return {
    port: server.port ?? 0,
    hostname: server.hostname ?? '127.0.0.1',
    stop(): void {
      unsubscribe()
      clearInterval(reaper)
      hub.closeAll(1001, 'server stopping')
      for (const socket of sockets) {
        closeQuietly(socket, 1001, 'server stopping')
      }
      sockets.clear()
      server.stop(true)
    },
  }
}
