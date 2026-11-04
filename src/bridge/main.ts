import { createBridge, defaultLog } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig(process.env)
const bridge = await createBridge(config, { log: defaultLog })
await bridge.start()

let stopping = false
async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return
  }
  stopping = true
  defaultLog(`${signal} received, shutting down`)
  try {
    await bridge.stop()
  } catch (error) {
    defaultLog('shutdown failed', error)
  } finally {
    process.exit(0)
  }
}
process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
