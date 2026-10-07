import { z } from 'zod'
import { defaultSocketPath } from '../../mod/remote-agent/hooks/protocol.ts'

export const STARTUP_TIMEOUT_MS = 30_000
export const END_GRACE_MS = 5_000

export type Config = {
  botToken: string
  chatId: number
  allowedUserId: number
  socketPath: string
  dbPath: string
  reminderAfterMs: number
  home: string
  /** Raw entries; `~` is expanded by TrustedFolders. */
  projects: string[]
  claudeConfigPath: string
}

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string({ required_error: 'TELEGRAM_BOT_TOKEN is required' }).regex(/^\d+:[A-Za-z0-9_-]+$/, 'TELEGRAM_BOT_TOKEN must look like 123456:ABC...'),
  TELEGRAM_CHAT_ID: z.coerce.number({ required_error: 'TELEGRAM_CHAT_ID is required' }).int().negative('TELEGRAM_CHAT_ID must be a supergroup id (negative, -100...)'),
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number({ required_error: 'TELEGRAM_ALLOWED_USER_ID is required' }).int().positive(),
  REMOTE_AGENT_SOCKET: z.string().optional(),
  REMOTE_AGENT_DB: z.string().optional(),
  REMOTE_AGENT_REMINDER_MINUTES: z.coerce.number().positive().default(30),
  REMOTE_AGENT_PROJECTS: z.string().optional(),
  CLAUDE_CONFIG_PATH: z.string().optional(),
  XDG_RUNTIME_DIR: z.string().optional(),
  HOME: z.string({ required_error: 'HOME is required' }),
})

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Invalid configuration: ${problems}`)
  }
  const values = parsed.data
  return {
    botToken: values.TELEGRAM_BOT_TOKEN,
    chatId: values.TELEGRAM_CHAT_ID,
    allowedUserId: values.TELEGRAM_ALLOWED_USER_ID,
    socketPath: values.REMOTE_AGENT_SOCKET ?? defaultSocketPath(values),
    dbPath: values.REMOTE_AGENT_DB ?? `${values.HOME}/.local/state/remote-agent/bridge.db`,
    reminderAfterMs: values.REMOTE_AGENT_REMINDER_MINUTES * 60_000,
    home: values.HOME,
    projects: (values.REMOTE_AGENT_PROJECTS ?? '').split(',').map(entry => entry.trim()).filter(entry => entry !== ''),
    claudeConfigPath: values.CLAUDE_CONFIG_PATH ?? `${values.HOME}/.claude.json`,
  }
}
