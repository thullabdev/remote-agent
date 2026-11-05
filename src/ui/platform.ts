declare global {
  interface Window {
    remoteAgentDesktop?: { bridgeToken: string }
  }
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && (
    window.remoteAgentDesktop !== undefined ||
    (typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent))
  )
}

export function webSocketUrl(after: number): string {
  const url = new URL('/ws', window.location.href)
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('after', String(after))
  const token = window.remoteAgentDesktop?.bridgeToken
  if (token !== undefined) {
    url.searchParams.set('bridgeToken', token)
  }
  return url.toString()
}
