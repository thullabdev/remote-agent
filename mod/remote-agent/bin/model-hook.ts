// Command hook for Claude Code's PostModelSwitch event: tells the Bridge which model the session now runs on, so the
// chat header can show it at once rather than after the next turn. Any failure ends silently with exit 0.
import { BridgeClient } from '../hooks/bridge-client.ts'
import { BRIDGE_ORIGIN, defaultSocketPath, type ModelRequest } from '../hooks/protocol.ts'

export function parseModelInput(raw: string): ModelRequest | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.session_id !== 'string' || typeof record.cwd !== 'string' || typeof record.to_model !== 'string') {
    return null
  }
  if (record.session_id === '' || record.cwd === '' || record.to_model === '') {
    return null
  }
  return { session: { sessionId: record.session_id, cwd: record.cwd }, model: record.to_model }
}

async function main(): Promise<void> {
  const request = parseModelInput(await Bun.stdin.text())
  if (request === null) {
    return
  }
  const socketPath = defaultSocketPath({ XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, HOME: process.env.HOME })
  const bridge = new BridgeClient(async (route, init) => {
    const response = await fetch(`${BRIDGE_ORIGIN}${route}`, {
      method: init?.method ?? 'GET',
      body: init?.body,
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(5_000),
      unix: socketPath,
    })
    return { status: response.status, text: await response.text() }
  })
  await bridge.model(request)
}

if (import.meta.main) {
  try {
    await main()
  } catch {
    // Exit 0 with no output: the header keeps the model it showed before.
  }
}
