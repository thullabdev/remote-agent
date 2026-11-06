export function readBridgeConfig(env) {
  const mode = env.REMOTE_AGENT_DESKTOP_BRIDGE_MODE ?? 'managed'
  if (mode === 'managed') {
    return { mode }
  }
  if (mode !== 'existing') {
    throw new Error('REMOTE_AGENT_DESKTOP_BRIDGE_MODE must be "managed" or "existing".')
  }

  const rawUrl = env.REMOTE_AGENT_DESKTOP_BRIDGE_URL
  if (rawUrl === undefined || rawUrl.trim() === '') {
    throw new Error('REMOTE_AGENT_DESKTOP_BRIDGE_URL is required in existing mode.')
  }
  const url = new URL(rawUrl)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('REMOTE_AGENT_DESKTOP_BRIDGE_URL must be an http(s) origin with no path, query, or credentials.')
  }

  const rawToken = env.REMOTE_AGENT_DESKTOP_BRIDGE_TOKEN
  const token = rawToken === undefined || rawToken.trim() === '' ? null : rawToken

  return { mode, origin: url.origin, token }
}
