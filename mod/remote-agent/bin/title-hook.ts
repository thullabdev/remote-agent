// Command hook for Claude Code's SessionStart and UserPromptSubmit events: forwards the session name so the
// Bridge can rename the Telegram topic. Any failure ends silently with exit 0.
import { BridgeClient } from '../hooks/bridge-client.ts'
import { BRIDGE_ORIGIN, defaultSocketPath, type TitleRequest } from '../hooks/protocol.ts'

export function parseTitleInput(raw: string): TitleRequest | null {
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
  if (typeof record.session_id !== 'string' || typeof record.cwd !== 'string' || typeof record.session_title !== 'string') {
    return null
  }
  if (record.session_id === '' || record.cwd === '' || record.session_title.trim() === '') {
    return null
  }
  return { session: { sessionId: record.session_id, cwd: record.cwd }, title: record.session_title }
}

async function main(): Promise<void> {
  const request = parseTitleInput(await Bun.stdin.text())
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
  await bridge.title(request)
}

if (import.meta.main) {
  try {
    await main()
  } catch {
    // Exit 0 with no output: the topic keeps its current name.
  }
}
