import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { TelegramChannel } from '../channel/telegram/adapter.ts'
import { loadConfig } from './config.ts'
import { createHandler } from './http.ts'
import { Inbound } from './inbound.ts'
import { Launcher } from './launcher.ts'
import { AwayMode, Notifier } from './notifier.ts'
import { PromptService, type Log } from './prompts.ts'
import { Spawner } from './spawner.ts'
import { Store } from './store.ts'
import { TrustedFolders, TrustedFoldersUnavailable } from './trusted.ts'

const log: Log = (message, error) => {
  if (error === undefined) {
    console.error(`[bridge] ${message}`)
    return
  }
  console.error(`[bridge] ${message}`, error)
}

const config = loadConfig(process.env)
await mkdir(dirname(config.dbPath), { recursive: true, mode: 0o700 })
await mkdir(dirname(config.socketPath), { recursive: true, mode: 0o700 })
// mkdir leaves existing directories untouched, so tighten them explicitly.
await chmod(dirname(config.dbPath), 0o700)
await chmod(dirname(config.socketPath), 0o700)
await rm(config.socketPath, { force: true })

const store = new Store(config.dbPath)
const channel = new TelegramChannel(config, log)
const notifier = new Notifier(store, channel, new AwayMode(true), log)
const prompts = new PromptService(store, notifier, { reminderAfterMs: config.reminderAfterMs, log })
const trusted = new TrustedFolders({ configPath: config.claudeConfigPath, home: config.home, projects: config.projects })
const spawner = new Spawner({ store, channel, notifier, launcher: new Launcher(), trusted, log })
const inbound = new Inbound(store, prompts, notifier, spawner)

// bun-types rejects idleTimeout together with unix, but the runtime honours it.
// Long polls wait up to 25 s and the 10 s default would cut them.
const server = Bun.serve({
  unix: config.socketPath,
  idleTimeout: 60,
  fetch: createHandler({ prompts, notifier, store, log, activity: spawner }),
} as unknown as Bun.Serve.Options<undefined>)
await chmod(config.socketPath, 0o600)
await channel.start(inbound)
await spawner.reconcile().catch(error => {
  log('reconciling spawned sessions failed', error)
})
try {
  for (const entry of await trusted.untrustedProjects()) {
    log(`REMOTE_AGENT_PROJECTS entry is not a trusted folder and is left out of /new: ${entry}`)
  }
} catch (error) {
  if (!(error instanceof TrustedFoldersUnavailable)) {
    throw error
  }
  log('cannot read Claude Code trusted folders; /new will refuse every folder', error)
}
const retryUndelivered = (): void => {
  void notifier.redeliverUndelivered().catch(error => {
    log('redelivery sweep failed', error)
  })
}
retryUndelivered()
const reminders = setInterval(() => {
  void prompts.remindStale()
  retryUndelivered()
}, 60_000)
log(`listening on ${config.socketPath}`)
await channel.sendText(null, '🟢 Bridge started. Away mode is on.', null).catch(error => {
  log('startup message failed', error)
})

let stopping = false
async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return
  }
  stopping = true
  log(`${signal} received, shutting down`)
  try {
    clearInterval(reminders)
    server.stop(true)
    await channel.stop()
    store.close()
    await rm(config.socketPath, { force: true })
  } catch (error) {
    log('shutdown failed', error)
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
