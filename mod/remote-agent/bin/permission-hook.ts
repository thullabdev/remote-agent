// Command hook for Claude Code's PermissionRequest event. See docs/adr/0002-permission-requests-via-command-hook.md.
// Any failure ends silently with exit 0 so Claude Code's own dialog decides.
import { BridgeClient } from '../hooks/bridge-client.ts'
import { BRIDGE_ORIGIN, defaultSocketPath } from '../hooks/protocol.ts'
import { parseHookInput, runPermissionFlow } from './permission-flow.ts'

async function main(): Promise<void> {
  const input = parseHookInput(await Bun.stdin.text())
  if (input === null) {
    return
  }
  const socketPath = defaultSocketPath({ XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, HOME: process.env.HOME })
  const bridge = new BridgeClient(async (route, init) => {
    const response = await fetch(`${BRIDGE_ORIGIN}${route}`, {
      method: init?.method ?? 'GET',
      body: init?.body,
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(35_000),
      unix: socketPath,
    })
    return { status: response.status, text: await response.text() }
  })
  const output = await runPermissionFlow(input, { bridge, newId: () => crypto.randomUUID(), sleep: ms => Bun.sleep(ms), now: Date.now })
  if (output !== null) {
    process.stdout.write(JSON.stringify(output))
  }
}

try {
  await main()
} catch {
  // Exit 0 with no output: the native dialog decides.
}
