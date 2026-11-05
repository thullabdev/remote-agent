import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Server } from 'bun'
import { TelegramChannel } from '../channel/telegram/adapter.ts'
import type { Channel } from '../channel/types.ts'
import { createApi } from '../channel/web/api.ts'
import { bindAway } from '../channel/web/away-events.ts'
import { ChatLog } from '../channel/web/chat-log.ts'
import { Hub } from '../channel/web/hub.ts'
import { loadOrCreateVapid, PushService } from '../channel/web/push.ts'
import { startWebServer, type WebServer } from '../channel/web/server.ts'
import { TranscriptReader } from '../channel/web/transcript/reader.ts'
import { WebChannel } from '../channel/web/web-channel.ts'
import { DEFAULT_VAPID_SUBJECT, STALE_SESSION_AFTER_MS, type Config } from './config.ts'
import { createHandler } from './http.ts'
import { Inbound } from './inbound.ts'
import { Launcher } from './launcher.ts'
import { AwayMode, Notifier } from './notifier.ts'
import { PromptService, type Log } from './prompts.ts'
import { Spawner } from './spawner.ts'
import { Store } from './store.ts'
import { TrustedFolders } from './trusted.ts'

export const defaultLog: Log = (message, error) => {
  if (error === undefined) {
    console.error(`[bridge] ${message}`)
    return
  }
  console.error(`[bridge] ${message}`, error)
}

export type BridgeOptions = {
  log?: Log
  /** Replaces the real tmux launcher; tests pass one backed by a fake. */
  tmux?: Launcher
}

export type Bridge = {
  /** Attaches the Channel, reconciles Spawned Sessions, starts the reminders and announces the Bridge. */
  start(): Promise<void>
  /** Stops the sockets, the web server, the transcript tails and the reminders, then closes the store and removes the socket. Idempotent. */
  stop(): Promise<void>
  /** The port the web server is bound to; null when the web channel is not selected. */
  webPort: number | null
  socketPath: string
}

const REMINDER_INTERVAL_MS = 60_000

/**
 * Builds the Bridge: the Unix socket the mod talks to, and the one Channel the user talks through.
 * When both channels are selected the web channel wins and Telegram is not built.
 */
export async function createBridge(config: Config, options: BridgeOptions = {}): Promise<Bridge> {
  const log = options.log ?? defaultLog
  const useWeb = config.channels.includes('web')
  if (useWeb && config.channels.includes('telegram')) {
    log('both channels selected; starting the web channel only')
  }
  if (useWeb && config.web === null) {
    throw new Error('Web channel is not selected: add web to REMOTE_AGENT_CHANNELS')
  }

  await mkdir(dirname(config.dbPath), { recursive: true, mode: 0o700 })
  await mkdir(dirname(config.socketPath), { recursive: true, mode: 0o700 })
  // mkdir leaves existing directories untouched, so tighten them explicitly.
  await chmod(dirname(config.dbPath), 0o700)
  await chmod(dirname(config.socketPath), 0o700)
  await rm(config.socketPath, { force: true })

  const store = new Store(config.dbPath)
  const away = new AwayMode(true)
  const chatLog = useWeb ? new ChatLog(store) : null
  const webChannel = chatLog === null ? null : new WebChannel(chatLog, log, store)
  let webServer: WebServer | null = null
  let unixServer: Server<undefined> | null = null
  let unbindAway: (() => void) | null = null
  let reader: TranscriptReader | null = null
  try {
    let channel: Channel
    if (webChannel !== null) {
      channel = webChannel
    } else if (config.telegram !== null) {
      channel = new TelegramChannel(config.telegram, log)
    } else {
      throw new Error('Telegram channel is not selected: add telegram to REMOTE_AGENT_CHANNELS')
    }
    const notifier = new Notifier(store, channel, away, log, webChannel ?? undefined)
    const prompts = new PromptService(store, notifier, { reminderAfterMs: config.reminderAfterMs, log })
    const trusted = new TrustedFolders({ home: config.home, configPath: config.claudeConfigPath })
    const spawner = new Spawner({ store, channel, notifier, launcher: options.tmux ?? new Launcher(), trusted, home: config.home, log })
    const inbound = new Inbound(store, prompts, notifier, spawner)

    if (config.web !== null && chatLog !== null && webChannel !== null) {
      const web = config.web
      const vapid = await loadOrCreateVapid(dirname(config.dbPath))
      if (web.vapidSubject === DEFAULT_VAPID_SUBJECT) {
        log(`REMOTE_AGENT_VAPID_SUBJECT is not set: push services such as Apple's may reject ${DEFAULT_VAPID_SUBJECT}; set it to a mailto: or https: contact of yours`)
      }
      const hub = new Hub(chatLog)
      const push = new PushService({ chatLog, hub, away, vapid: { ...vapid, subject: web.vapidSubject }, log })
      const transcripts = new TranscriptReader({
        chatLog,
        store,
        home: config.home,
        log,
        onBusy: (sessionId, busy) => {
          webChannel.busyChanged(sessionId, busy)
        },
      })
      reader = transcripts
      webChannel.setTranscriptProbe(sessionId => transcripts.isActive(sessionId))
      webChannel.setTranscriptAttacher(
        sessionId => transcripts.attach(sessionId),
        sessionId => transcripts.detach(sessionId),
      )
      webChannel.setPushNotifier(event => push.notify(event))
      unbindAway = bindAway(away, chatLog)
      const api = createApi({
        chatLog,
        handlers: () => webChannel.handlers,
        store,
        away,
        spawner,
        projects: () => trusted.configuredProjects(),
        sink: webChannel,
        push,
        log,
      })
      webServer = startWebServer({ config: web, chatLog, api, hub, log })
    }

    // Bun.serve's unix option is typed without idleTimeout, but the runtime honours it.
    // Long polls wait up to 25 s and the 10 s default would cut them.
    unixServer = Bun.serve({
      unix: config.socketPath,
      idleTimeout: 60,
      fetch: createHandler({ prompts, notifier, store, log, activity: spawner }),
    } as unknown as Bun.Serve.Options<undefined>)
    await chmod(config.socketPath, 0o600)

    const socket = unixServer
    const httpServer = webServer
    const tails = reader
    const unbind = unbindAway
    let reminders: ReturnType<typeof setInterval> | null = null
    let stopped = false
    const retryUndelivered = (): void => {
      void notifier.redeliverUndelivered().catch(error => {
        log('redelivery sweep failed', error)
      })
    }

    return {
      webPort: httpServer?.port ?? null,
      socketPath: config.socketPath,
      async start(): Promise<void> {
        await channel.start(inbound)
        await spawner.reconcile().catch(error => {
          log('reconciling spawned sessions failed', error)
        })
        retryUndelivered()
        reminders = setInterval(() => {
          void prompts.remindStale()
          retryUndelivered()
          void notifier.closeStaleSessions(Date.now() - STALE_SESSION_AFTER_MS)
        }, REMINDER_INTERVAL_MS)
        // A restart resumes tailing for every Session that already has a chat.
        for (const session of store.listActiveSessions()) {
          if (session.chatId !== null) {
            tails?.attach(session.id)
          }
        }
        log(`listening on ${config.socketPath}`)
        const text = httpServer === null ? '🟢 Bridge started. Away mode is on.' : 'Bridge started. Away mode is on.'
        await channel.sendText(null, text, null).catch(error => {
          log('startup message failed', error)
        })
      },
      async stop(): Promise<void> {
        if (stopped) {
          return
        }
        stopped = true
        if (reminders !== null) {
          clearInterval(reminders)
        }
        socket.stop(true)
        httpServer?.stop()
        unbind?.()
        tails?.close()
        await channel.stop()
        store.close()
        await rm(config.socketPath, { force: true })
      },
    }
  } catch (error) {
    webServer?.stop()
    unixServer?.stop(true)
    unbindAway?.()
    reader?.close()
    store.close()
    throw error
  }
}
