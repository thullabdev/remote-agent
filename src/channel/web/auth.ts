import { createHash, timingSafeEqual } from 'node:crypto'

export type AuthConfig = { allowedLogin: string; origins: string[]; token: string | null }

export type AuthResult = { ok: true } | { ok: false; status: 401 | 403; reason: string }

const LOGIN_HEADER = 'Tailscale-User-Login'
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Exact scheme + host + port; null when the value is not a parseable http(s) origin. */
function normalizeOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

/** Compares digests so the comparison takes the same time whatever the lengths are. */
function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right)
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
}

function isSafeMethod(request: Request): boolean {
  const method = request.method.toUpperCase()
  return method === 'GET' || method === 'HEAD'
}

/**
 * Browsers send no Origin on same-origin GET/HEAD page and asset loads, but do send it on WebSocket
 * upgrades and state-changing requests. So those GET/HEAD requests may omit Origin when Fetch Metadata
 * says the request came from this origin.
 *
 * A top-level page load (navigation, not an embedded frame) may also omit Origin from any site: an installed
 * app or a link from another app navigates cross-site. It cannot read the response cross-site, and the
 * page's own API calls are same-origin and still checked here.
 */
function originAbsentButSameOrigin(request: Request): boolean {
  if (!isSafeMethod(request) || isWebSocketUpgrade(request)) {
    return false
  }
  // "empty" is what Chrome reports for a top-level navigation the installed app starts; frames report "iframe" or "frame".
  const dest = request.headers.get('Sec-Fetch-Dest')
  if (request.headers.get('Sec-Fetch-Mode') === 'navigate' && (dest === 'document' || dest === 'empty')) {
    return true
  }
  const site = request.headers.get('Sec-Fetch-Site')
  return site === 'same-origin' || site === 'none'
}

function originAllowed(request: Request, config: AuthConfig): boolean {
  const header = request.headers.get('Origin')
  if (header === null) {
    return originAbsentButSameOrigin(request)
  }
  const origin = normalizeOrigin(header)
  if (origin === null) {
    return false
  }
  return config.origins.some(allowed => normalizeOrigin(allowed) === origin)
}

function identityResult(request: Request, config: AuthConfig): AuthResult | null {
  const authorization = request.headers.get('Authorization')
  if (config.token !== null && authorization !== null && authorization.startsWith('Bearer ')) {
    if (constantTimeEqual(authorization.slice('Bearer '.length), config.token)) {
      return null
    }
  }
  const login = request.headers.get(LOGIN_HEADER)
  if (login === null || login === '') {
    return { ok: false, status: 401, reason: 'missing identity' }
  }
  if (!constantTimeEqual(login, config.allowedLogin)) {
    return { ok: false, status: 403, reason: 'login not allowed' }
  }
  return null
}

function contentTypeAllowed(request: Request): boolean {
  const header = request.headers.get('Content-Type')
  if (header === null) {
    return false
  }
  const mediaType = header.split(';')[0]?.trim().toLowerCase()
  return mediaType === 'application/json'
}

/**
 * Gate for every HTTP request and WebSocket upgrade. Checks Origin first (mandatory for WebSocket
 * upgrades and non-GET/HEAD; for GET/HEAD it may be absent only with a same-origin Sec-Fetch-Site),
 * then identity (Tailscale login or bearer token), then the content type of state-changing methods.
 */
export function authorize(request: Request, config: AuthConfig): AuthResult {
  if (!originAllowed(request, config)) {
    return { ok: false, status: 403, reason: 'origin not allowed' }
  }
  const identity = identityResult(request, config)
  if (identity !== null) {
    return identity
  }
  if (STATE_CHANGING_METHODS.has(request.method.toUpperCase()) && !contentTypeAllowed(request)) {
    return { ok: false, status: 403, reason: 'content type must be application/json' }
  }
  return { ok: true }
}
