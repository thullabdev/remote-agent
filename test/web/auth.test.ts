import { expect, test } from 'bun:test'
import { type AuthConfig, authorize } from '../../src/web/auth.ts'

const ORIGIN = 'https://agent.example.ts.net'
const LOGIN = 'owner@example.com'
const TOKEN = 'a-long-random-bearer-token'

const config: AuthConfig = { allowedLogin: LOGIN, origins: [ORIGIN], token: TOKEN }

function request(init: { method?: string; headers?: Record<string, string>; url?: string } = {}): Request {
  return new Request(init.url ?? 'http://127.0.0.1:8787/api/sessions', {
    method: init.method ?? 'GET',
    headers: init.headers,
  })
}

const websocketUpgrade = (headers: Record<string, string>): Record<string, string> => ({
  Upgrade: 'websocket',
  Connection: 'Upgrade',
  ...headers,
})

test('GET without Origin but Sec-Fetch-Site same-origin is allowed', () => {
  const result = authorize(request({ headers: { 'Tailscale-User-Login': LOGIN, 'Sec-Fetch-Site': 'same-origin' } }), config)
  expect(result).toEqual({ ok: true })
})

test('GET without Origin and without Sec-Fetch-Site is 403', () => {
  const result = authorize(request({ headers: { 'Tailscale-User-Login': LOGIN } }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('GET without Origin and Sec-Fetch-Site cross-site is 403', () => {
  const result = authorize(request({ headers: { 'Tailscale-User-Login': LOGIN, 'Sec-Fetch-Site': 'cross-site' } }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('GET without Origin and Sec-Fetch-Site same-site is 403', () => {
  const result = authorize(request({ headers: { 'Tailscale-User-Login': LOGIN, 'Sec-Fetch-Site': 'same-site' } }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('GET with a mismatching Origin is 403 even if Sec-Fetch-Site is same-origin', () => {
  const headers = { 'Tailscale-User-Login': LOGIN, Origin: 'https://evil.example.com', 'Sec-Fetch-Site': 'same-origin' }
  const result = authorize(request({ headers }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('WebSocket upgrade without Origin is 403 even with Sec-Fetch-Site same-origin', () => {
  const headers = websocketUpgrade({ 'Tailscale-User-Login': LOGIN, 'Sec-Fetch-Site': 'same-origin' })
  const result = authorize(request({ headers }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('POST without Origin is 403 even with Sec-Fetch-Site same-origin', () => {
  const headers = { 'Tailscale-User-Login': LOGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }
  const result = authorize(request({ method: 'POST', headers }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('allows the configured login with a matching Origin', () => {
  const result = authorize(request({ headers: { 'Tailscale-User-Login': LOGIN, Origin: ORIGIN } }), config)
  expect(result).toEqual({ ok: true })
})

test('rejects a different Tailscale-User-Login with 403', () => {
  const result = authorize(request({ headers: { 'Tailscale-User-Login': 'intruder@example.com', Origin: ORIGIN } }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'login not allowed' })
})

test('rejects a missing Tailscale-User-Login with 401', () => {
  const result = authorize(request({ headers: { Origin: ORIGIN } }), config)
  expect(result).toEqual({ ok: false, status: 401, reason: 'missing identity' })
})

test('rejects a missing Origin with 403', () => {
  const result = authorize(request({ headers: { 'Tailscale-User-Login': LOGIN } }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('rejects a mismatching Origin with 403', () => {
  const result = authorize(request({ headers: { 'Tailscale-User-Login': LOGIN, Origin: 'https://evil.example.com' } }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('rejects a missing Origin with 403 on a WebSocket upgrade', () => {
  const result = authorize(request({ headers: websocketUpgrade({ 'Tailscale-User-Login': LOGIN }) }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('rejects a mismatching Origin with 403 on a WebSocket upgrade', () => {
  const result = authorize(
    request({ headers: websocketUpgrade({ 'Tailscale-User-Login': LOGIN, Origin: 'https://evil.example.com' }) }),
    config,
  )
  expect(result).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('accepts a matching Origin on a WebSocket upgrade', () => {
  const result = authorize(request({ headers: websocketUpgrade({ 'Tailscale-User-Login': LOGIN, Origin: ORIGIN }) }), config)
  expect(result).toEqual({ ok: true })
})

test('POST without application/json content type is 403', () => {
  const headers = { 'Tailscale-User-Login': LOGIN, Origin: ORIGIN, 'Content-Type': 'text/plain' }
  const result = authorize(request({ method: 'POST', headers }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'content type must be application/json' })
})

test('POST with application/json content type is allowed', () => {
  const headers = { 'Tailscale-User-Login': LOGIN, Origin: ORIGIN, 'Content-Type': 'application/json; charset=utf-8' }
  const result = authorize(request({ method: 'POST', headers }), config)
  expect(result).toEqual({ ok: true })
})

test('PUT, PATCH and DELETE also require application/json', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const headers = { 'Tailscale-User-Login': LOGIN, Origin: ORIGIN }
    const result = authorize(request({ method, headers }), config)
    expect(result).toEqual({ ok: false, status: 403, reason: 'content type must be application/json' })
  }
})

test('a valid bearer token substitutes for the login header but still needs a matching Origin', () => {
  const withOrigin = authorize(request({ headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN } }), config)
  expect(withOrigin).toEqual({ ok: true })

  const withoutOrigin = authorize(request({ headers: { Authorization: `Bearer ${TOKEN}` } }), config)
  expect(withoutOrigin).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })

  const wrongOrigin = authorize(request({ headers: { Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.example.com' } }), config)
  expect(wrongOrigin).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('a wrong bearer token without a login header is 401', () => {
  const result = authorize(request({ headers: { Authorization: 'Bearer wrong-token', Origin: ORIGIN } }), config)
  expect(result).toEqual({ ok: false, status: 401, reason: 'missing identity' })
})

test('a bearer token is ignored when the server has no token configured', () => {
  const noToken: AuthConfig = { ...config, token: null }
  const result = authorize(request({ headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN } }), noToken)
  expect(result).toEqual({ ok: false, status: 401, reason: 'missing identity' })
})

test('origins in config are normalised: trailing slash and host case do not matter', () => {
  const loose: AuthConfig = { ...config, origins: ['HTTPS://Agent.Example.ts.net/'] }
  const result = authorize(request({ headers: { 'Tailscale-User-Login': LOGIN, Origin: ORIGIN } }), loose)
  expect(result).toEqual({ ok: true })
})

test('an unparseable Origin header is a mismatch', () => {
  const result = authorize(request({ headers: { 'Tailscale-User-Login': LOGIN, Origin: 'not a url' } }), config)
  expect(result).toEqual({ ok: false, status: 403, reason: 'origin not allowed' })
})

test('the reason string never contains the token or the login', () => {
  const cases: Request[] = [
    request({ headers: { 'Tailscale-User-Login': 'intruder@example.com', Origin: ORIGIN } }),
    request({ headers: { Authorization: `Bearer ${TOKEN}` } }),
    request({ headers: { 'Tailscale-User-Login': LOGIN, Origin: 'https://evil.example.com' } }),
    request({ method: 'POST', headers: { 'Tailscale-User-Login': LOGIN, Origin: ORIGIN } }),
    request({ headers: { Authorization: 'Bearer wrong-token', Origin: ORIGIN } }),
  ]
  for (const req of cases) {
    const result = authorize(req, config)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).not.toContain(TOKEN)
      expect(result.reason).not.toContain(LOGIN)
      expect(result.reason).not.toContain('evil.example.com')
    }
  }
})
