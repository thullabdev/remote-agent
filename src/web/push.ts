import { mkdir, readFile, chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generateVAPIDKeys, sendNotification, WebPushError } from 'web-push'
import { z } from 'zod'
import type { AwayMode } from '../bridge/notifier.ts'
import type { Log } from '../bridge/prompts.ts'
import type { ChatLog } from './chat-log.ts'
import type { Hub } from './hub.ts'
import type { PushSubscriptionRecord } from './protocol.ts'

const PREVIEW_CHARS = 140
const PROMPT_TTL_SECONDS = 3600
const REPORT_TTL_SECONDS = 600
const GONE_STATUSES = [404, 410]
const VAPID_FILE = 'vapid.json'

export type PushOptions = { urgency: 'high' | 'normal'; ttlSeconds: number }
export type PushSend = (subscription: PushSubscriptionRecord, payload: string, options: PushOptions) => Promise<{ status: number }>

export type PushEvent = { kind: 'prompt' | 'report'; chatId: string; title: string; text: string }

export type PushDeps = {
  chatLog: Pick<ChatLog, 'addPushSubscription' | 'removePushSubscription' | 'listPushSubscriptions'>
  hub: Pick<Hub, 'anyActive'>
  away: Pick<AwayMode, 'isAway'>
  vapid: { publicKey: string; privateKey: string; subject: string }
  send?: PushSend
  log: Log
}

/** Web Push for the web channel: who gets a push, what it says, and pruning of subscriptions the push service has dropped. */
export class PushService {
  private readonly send: PushSend

  constructor(private readonly deps: PushDeps) {
    this.send = deps.send ?? (async (subscription, payload, options) => defaultSend(deps.vapid, subscription, payload, options))
  }

  publicKey(): string {
    return this.deps.vapid.publicKey
  }

  subscribe(subscription: PushSubscriptionRecord): void {
    this.deps.chatLog.addPushSubscription(subscription)
  }

  unsubscribe(endpoint: string): void {
    this.deps.chatLog.removePushSubscription(endpoint)
  }

  async notify(event: PushEvent): Promise<void> {
    if (this.deps.hub.anyActive()) {
      return
    }
    if (event.kind === 'report' && !this.deps.away.isAway()) {
      return
    }
    const isPrompt = event.kind === 'prompt'
    const options: PushOptions = isPrompt
      ? { urgency: 'high', ttlSeconds: PROMPT_TTL_SECONDS }
      : { urgency: 'normal', ttlSeconds: REPORT_TTL_SECONDS }
    const payload = JSON.stringify({ chatId: event.chatId, title: event.title, preview: preview(event.text), kind: event.kind })
    const subscriptions = this.deps.chatLog.listPushSubscriptions()
    await Promise.allSettled(subscriptions.map(subscription => this.deliver(subscription, payload, options)))
  }

  private async deliver(subscription: PushSubscriptionRecord, payload: string, options: PushOptions): Promise<void> {
    const host = hostOf(subscription.endpoint)
    try {
      const { status } = await this.send(subscription, payload, options)
      if (GONE_STATUSES.includes(status)) {
        this.deps.chatLog.removePushSubscription(subscription.endpoint)
      } else if (status < 200 || status >= 300) {
        this.deps.log(`web push to ${host} failed with status ${status}`)
      }
    } catch (error) {
      this.deps.log(`web push to ${host} failed: ${scrub(error, subscription)}`)
    }
  }
}

/** The first 140 characters, cut on code points so a surrogate pair is never split. */
function preview(text: string): string {
  return Array.from(text).slice(0, PREVIEW_CHARS).join('')
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return 'unknown host'
  }
}

/** The error text with the endpoint and keys removed, so a log line never carries them. */
function scrub(error: unknown, subscription: PushSubscriptionRecord): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth].reduce(
    (current, secret) => (secret === '' ? current : current.split(secret).join('[redacted]')),
    text,
  )
}

async function defaultSend(
  vapid: PushDeps['vapid'],
  subscription: PushSubscriptionRecord,
  payload: string,
  options: PushOptions,
): Promise<{ status: number }> {
  try {
    const result = await sendNotification(subscription, payload, {
      vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: options.ttlSeconds,
      urgency: options.urgency,
    })
    return { status: result.statusCode }
  } catch (error) {
    if (error instanceof WebPushError) {
      return { status: error.statusCode }
    }
    throw error
  }
}

const VapidFileSchema = z.object({ publicKey: z.string().min(1), privateKey: z.string().min(1) })

/**
 * Reads the VAPID key pair from `<dataDir>/vapid.json`, creating it (mode 0600) on first use.
 * A file that exists but cannot be read or parsed is an error: regenerating would invalidate every subscription.
 */
export async function loadOrCreateVapid(dataDir: string): Promise<{ publicKey: string; privateKey: string }> {
  const file = join(dataDir, VAPID_FILE)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Cannot read ${file}: ${(error as Error).message}`)
    }
    return createVapid(dataDir, file)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${file} is not valid JSON; fix or remove it (removing it invalidates every push subscription)`)
  }
  const keys = VapidFileSchema.safeParse(parsed)
  if (!keys.success) {
    throw new Error(`${file} does not hold a VAPID key pair; fix or remove it (removing it invalidates every push subscription)`)
  }
  return keys.data
}

async function createVapid(dataDir: string, file: string): Promise<{ publicKey: string; privateKey: string }> {
  const keys = generateVAPIDKeys()
  const pair = { publicKey: keys.publicKey, privateKey: keys.privateKey }
  await mkdir(dataDir, { recursive: true })
  await writeFile(file, `${JSON.stringify(pair, null, 2)}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
  return pair
}
