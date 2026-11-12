// A tiny stand-in for `tailscale serve`: it forwards HTTP and WebSocket traffic to the throwaway Bridge and adds
// the Tailscale identity header, which a browser cannot add itself (not even on the WebSocket handshake).
// Env: PROXY_PORT, TARGET_PORT, LOGIN. Run with Bun.
const proxyPort = Number(process.env.PROXY_PORT)
const targetPort = Number(process.env.TARGET_PORT)
const login = process.env.LOGIN
if (!proxyPort || !targetPort || !login) {
  throw new Error('Set PROXY_PORT, TARGET_PORT and LOGIN')
}

const target = `127.0.0.1:${targetPort}`

Bun.serve({
  hostname: '127.0.0.1',
  port: proxyPort,
  async fetch(request, server) {
    const url = new URL(request.url)
    const path = `${url.pathname}${url.search}`

    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const upgraded = server.upgrade(request, { data: { path, origin: request.headers.get('origin') } })
      return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 500 })
    }

    const headers = new Headers(request.headers)
    headers.set('Tailscale-User-Login', login)
    headers.delete('host')
    // Ask for an uncompressed body: Bun's fetch decompresses but keeps the content-encoding header.
    headers.delete('accept-encoding')
    return fetch(`http://${target}${path}`, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    })
  },
  websocket: {
    open(socket) {
      const headers = { 'Tailscale-User-Login': login }
      if (socket.data.origin) {
        headers.Origin = socket.data.origin
      }
      const upstream = new WebSocket(`ws://${target}${socket.data.path}`, { headers })
      socket.data.upstream = upstream
      socket.data.pending = []
      upstream.addEventListener('open', () => {
        for (const message of socket.data.pending) {
          upstream.send(message)
        }
        socket.data.pending = []
      })
      upstream.addEventListener('message', event => socket.send(event.data))
      upstream.addEventListener('close', () => socket.close())
      upstream.addEventListener('error', () => socket.close())
    },
    message(socket, message) {
      const upstream = socket.data.upstream
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(message)
      } else {
        socket.data.pending.push(message)
      }
    },
    close(socket) {
      socket.data.upstream?.close()
    },
  },
})

console.log(`proxy: http://127.0.0.1:${proxyPort} -> http://${target}`)
