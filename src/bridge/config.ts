import { z } from 'zod'
import { defaultSocketPath } from '../../mod/remote-agent/hooks/protocol.ts'

export const STARTUP_TIMEOUT_MS = 30_000
export const END_GRACE_MS = 5_000

export type ChannelName = 'web' | 'telegram'

export type TelegramConfig = { botToken: string; chatId: number; allowedUserId: number }

export type WebConfig = {
  port: number
  allowedLogin: string
  origins: string[]
  token: string | null
  staticDir: string | null
  vapidSubject: string
}

export type Config = {
  channels: ChannelName[]
  /** Set only when `telegram` is selected. */
  telegram: TelegramConfig | null
  /** Set only when `web` is selected. */
  web: WebConfig | null
  socketPath: string
  dbPath: string
  reminderAfterMs: number
  home: string
  /** Raw entries; `~` is expanded by TrustedFolders. */
  projects: string[]
  claudeConfigPath: string
}

const DEFAULT_VAPID_SUBJECT = 'mailto:remote-agent@localhost'

function splitList(raw: string): string[] {
  return raw.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
}

const optionalText = z.string().optional().transform(raw => {
  const trimmed = raw?.trim() ?? ''
  return trimmed === '' ? null : trimmed
})

const ChannelsSchema = z.string().default('web').transform((raw, ctx) => {
  const names = splitList(raw)
  if (names.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must name at least one channel (web or telegram)' })
  }
  const channels: ChannelName[] = []
  for (const name of names) {
    if (name !== 'web' && name !== 'telegram') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown channel "${name}" (expected web or telegram)` })
      continue
    }
    if (!channels.includes(name)) {
      channels.push(name)
    }
  }
  return channels
})

const EnvSchema = z.object({
  REMOTE_AGENT_CHANNELS: ChannelsSchema,
  REMOTE_AGENT_SOCKET: z.string().optional(),
  REMOTE_AGENT_DB: z.string().optional(),
  REMOTE_AGENT_REMINDER_MINUTES: z.coerce.number().positive().default(30),
  REMOTE_AGENT_PROJECTS: z.string().optional(),
  CLAUDE_CONFIG_PATH: z.string().optional(),
  XDG_RUNTIME_DIR: z.string().optional(),
  HOME: z.string({ required_error: 'HOME is required' }),
})

const TelegramEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string({ required_error: 'TELEGRAM_BOT_TOKEN is required' }).regex(/^\d+:[A-Za-z0-9_-]+$/, 'TELEGRAM_BOT_TOKEN must look like 123456:ABC...'),
  TELEGRAM_CHAT_ID: z.coerce.number({ required_error: 'TELEGRAM_CHAT_ID is required' }).int().negative('TELEGRAM_CHAT_ID must be a supergroup id (negative, -100...)'),
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number({ required_error: 'TELEGRAM_ALLOWED_USER_ID is required' }).int().positive(),
})

/** A VAPID subject is a contact URI: `mailto:` or `https:`. Empty or blank means the default. */
const VapidSubjectSchema = z.string().optional().transform((raw, ctx) => {
  const trimmed = raw?.trim() ?? ''
  if (trimmed === '') {
    return DEFAULT_VAPID_SUBJECT
  }
  if (!/^(mailto|https):/i.test(trimmed)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must start with mailto: or https: (for example mailto:you@example.com)' })
    return trimmed
  }
  return trimmed
})

const WebEnvSchema = z.object({
  REMOTE_AGENT_WEB_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  REMOTE_AGENT_WEB_ALLOWED_LOGIN: z.string({ required_error: 'REMOTE_AGENT_WEB_ALLOWED_LOGIN is required' }).trim().min(1, 'REMOTE_AGENT_WEB_ALLOWED_LOGIN is required'),
  REMOTE_AGENT_WEB_ORIGINS: z.string({ required_error: 'REMOTE_AGENT_WEB_ORIGINS is required' })
    .transform(splitList)
    .pipe(z.array(z.string()).min(1, 'REMOTE_AGENT_WEB_ORIGINS is required')),
  REMOTE_AGENT_WEB_TOKEN: optionalText,
  REMOTE_AGENT_WEB_STATIC: optionalText,
  REMOTE_AGENT_VAPID_SUBJECT: VapidSubjectSchema,
})

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const common = EnvSchema.safeParse(env)
  if (!common.success) {
    throw new Error(`Invalid configuration: ${describeIssues(common.error).join('; ')}`)
  }
  const values = common.data
  const telegram = values.REMOTE_AGENT_CHANNELS.includes('telegram') ? TelegramEnvSchema.safeParse(env) : null
  const web = values.REMOTE_AGENT_CHANNELS.includes('web') ? WebEnvSchema.safeParse(env) : null
  const problems = [telegram, web].flatMap(result => (result !== null && !result.success ? describeIssues(result.error) : []))
  if (problems.length > 0) {
    throw new Error(`Invalid configuration: ${problems.join('; ')}`)
  }
  const telegramValues = telegram?.success ? telegram.data : null
  const webValues = web?.success ? web.data : null
  return {
    channels: values.REMOTE_AGENT_CHANNELS,
    telegram: telegramValues === null
      ? null
      : {
          botToken: telegramValues.TELEGRAM_BOT_TOKEN,
          chatId: telegramValues.TELEGRAM_CHAT_ID,
          allowedUserId: telegramValues.TELEGRAM_ALLOWED_USER_ID,
        },
    web: webValues === null
      ? null
      : {
          port: webValues.REMOTE_AGENT_WEB_PORT,
          allowedLogin: webValues.REMOTE_AGENT_WEB_ALLOWED_LOGIN,
          origins: webValues.REMOTE_AGENT_WEB_ORIGINS,
          token: webValues.REMOTE_AGENT_WEB_TOKEN,
          staticDir: webValues.REMOTE_AGENT_WEB_STATIC,
          vapidSubject: webValues.REMOTE_AGENT_VAPID_SUBJECT,
        },
    socketPath: values.REMOTE_AGENT_SOCKET ?? defaultSocketPath(values),
    dbPath: values.REMOTE_AGENT_DB ?? `${values.HOME}/.local/state/remote-agent/bridge.db`,
    reminderAfterMs: values.REMOTE_AGENT_REMINDER_MINUTES * 60_000,
    home: values.HOME,
    projects: splitList(values.REMOTE_AGENT_PROJECTS ?? ''),
    claudeConfigPath: values.CLAUDE_CONFIG_PATH ?? `${values.HOME}/.claude.json`,
  }
}
