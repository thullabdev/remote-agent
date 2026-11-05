import { expect, test } from 'bun:test'
import { loadConfig } from '../../src/bridge/config.ts'

const telegram = {
  TELEGRAM_BOT_TOKEN: '123456:ABC-def_ghi',
  TELEGRAM_CHAT_ID: '-1001234567890',
  TELEGRAM_ALLOWED_USER_ID: '42',
}

const web = {
  REMOTE_AGENT_WEB_ALLOWED_LOGIN: 'alice@example.com',
  REMOTE_AGENT_WEB_ORIGINS: 'https://box.tail1234.ts.net',
}

const base = {
  REMOTE_AGENT_CHANNELS: 'telegram',
  ...telegram,
  HOME: '/home/u',
  XDG_RUNTIME_DIR: '/run/user/1000',
}

test('loads a valid environment with defaults', () => {
  expect(loadConfig(base)).toEqual({
    channels: ['telegram'],
    telegram: { botToken: '123456:ABC-def_ghi', chatId: -1001234567890, allowedUserId: 42 },
    web: null,
    socketPath: '/run/user/1000/remote-agent/bridge.sock',
    dbPath: '/home/u/.local/state/remote-agent/bridge.db',
    reminderAfterMs: 30 * 60_000,
    home: '/home/u',
    claudeConfigPath: '/home/u/.claude.json',
  })
})

test('allows overriding Claude Code config path', () => {
  const config = loadConfig({ ...base, CLAUDE_CONFIG_PATH: '/tmp/claude.json' })
  expect(config.claudeConfigPath).toBe('/tmp/claude.json')
})

test('honours explicit overrides', () => {
  const config = loadConfig({ ...base, REMOTE_AGENT_SOCKET: '/tmp/b.sock', REMOTE_AGENT_DB: '/tmp/b.db', REMOTE_AGENT_REMINDER_MINUTES: '5' })
  expect(config.socketPath).toBe('/tmp/b.sock')
  expect(config.dbPath).toBe('/tmp/b.db')
  expect(config.reminderAfterMs).toBe(5 * 60_000)
})

test('names the missing variable', () => {
  expect(() => loadConfig({ ...base, TELEGRAM_BOT_TOKEN: undefined })).toThrow('TELEGRAM_BOT_TOKEN')
})

test('rejects a non-supergroup chat id', () => {
  expect(() => loadConfig({ ...base, TELEGRAM_CHAT_ID: '42' })).toThrow('TELEGRAM_CHAT_ID')
})

test('defaults to channels ["web"] and requires REMOTE_AGENT_WEB_ALLOWED_LOGIN and REMOTE_AGENT_WEB_ORIGINS', () => {
  const config = loadConfig({ HOME: '/home/u', XDG_RUNTIME_DIR: '/run/user/1000', ...web })
  expect(config.channels).toEqual(['web'])
  expect(() => loadConfig({ HOME: '/home/u', REMOTE_AGENT_WEB_ORIGINS: 'https://box.tail1234.ts.net' })).toThrow('REMOTE_AGENT_WEB_ALLOWED_LOGIN')
  expect(() => loadConfig({ HOME: '/home/u', REMOTE_AGENT_WEB_ALLOWED_LOGIN: 'alice@example.com' })).toThrow('REMOTE_AGENT_WEB_ORIGINS')
})

test('web only: no Telegram vars needed and telegram is null', () => {
  const config = loadConfig({ HOME: '/home/u', XDG_RUNTIME_DIR: '/run/user/1000', REMOTE_AGENT_CHANNELS: 'web', ...web })
  expect(config.telegram).toBeNull()
  expect(config.web).toEqual({
    port: 8787,
    allowedLogin: 'alice@example.com',
    origins: ['https://box.tail1234.ts.net'],
    token: null,
    staticDir: null,
    vapidSubject: 'mailto:remote-agent@localhost',
  })
})

test('telegram only: requires the three TELEGRAM_ vars and web is null', () => {
  const config = loadConfig({ ...base })
  expect(config.telegram).not.toBeNull()
  expect(config.web).toBeNull()
  expect(() => loadConfig({ HOME: '/home/u', REMOTE_AGENT_CHANNELS: 'telegram' })).toThrow('TELEGRAM_BOT_TOKEN')
  expect(() => loadConfig({ HOME: '/home/u', REMOTE_AGENT_CHANNELS: 'telegram', TELEGRAM_BOT_TOKEN: telegram.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: telegram.TELEGRAM_CHAT_ID })).toThrow('TELEGRAM_ALLOWED_USER_ID')
})

test('both selected: requires everything', () => {
  const config = loadConfig({ ...base, REMOTE_AGENT_CHANNELS: 'web,telegram', ...web })
  expect(config.channels).toEqual(['web', 'telegram'])
  expect(config.telegram).not.toBeNull()
  expect(config.web).not.toBeNull()
  expect(() => loadConfig({ ...base, REMOTE_AGENT_CHANNELS: 'web,telegram' })).toThrow('REMOTE_AGENT_WEB_ALLOWED_LOGIN')
  expect(() => loadConfig({ HOME: '/home/u', REMOTE_AGENT_CHANNELS: 'web,telegram', ...web })).toThrow('TELEGRAM_BOT_TOKEN')
})

test('port defaults to 8787 and rejects non-integers', () => {
  expect(loadConfig({ HOME: '/home/u', ...web }).web?.port).toBe(8787)
  expect(loadConfig({ HOME: '/home/u', ...web, REMOTE_AGENT_WEB_PORT: '9000' }).web?.port).toBe(9000)
  expect(() => loadConfig({ HOME: '/home/u', ...web, REMOTE_AGENT_WEB_PORT: '87.5' })).toThrow('REMOTE_AGENT_WEB_PORT')
})

test('origins splits on commas and trims', () => {
  const config = loadConfig({ HOME: '/home/u', ...web, REMOTE_AGENT_WEB_ORIGINS: ' https://box.tail1234.ts.net , http://localhost:8787,, ' })
  expect(config.web?.origins).toEqual(['https://box.tail1234.ts.net', 'http://localhost:8787'])
})

test('each origin must be an exact http or https origin, and the error names the variable and the entry', () => {
  const withOrigins = (value: string) => loadConfig({ HOME: '/home/u', ...web, REMOTE_AGENT_WEB_ORIGINS: value })
  expect(() => withOrigins('box.tail1234.ts.net')).toThrow('REMOTE_AGENT_WEB_ORIGINS')
  expect(() => withOrigins('box.tail1234.ts.net')).toThrow('"box.tail1234.ts.net"')
  expect(() => withOrigins('https://box.tail1234.ts.net/')).toThrow('"https://box.tail1234.ts.net/"')
  expect(() => withOrigins('https://box.tail1234.ts.net/web')).toThrow('"https://box.tail1234.ts.net/web"')
  expect(() => withOrigins('ftp://box.tail1234.ts.net')).toThrow('"ftp://box.tail1234.ts.net"')
  expect(() => withOrigins('https://ok.example.com,box.tail1234.ts.net')).toThrow('"box.tail1234.ts.net"')
  expect(withOrigins('https://box.tail1234.ts.net:8443').web?.origins).toEqual(['https://box.tail1234.ts.net:8443'])
})

test('unknown channel name is rejected', () => {
  expect(() => loadConfig({ ...base, REMOTE_AGENT_CHANNELS: 'telegram,slack' })).toThrow('slack')
})

test('error message names the missing variable', () => {
  expect(() => loadConfig({ HOME: '/home/u', ...web, REMOTE_AGENT_WEB_ALLOWED_LOGIN: '' })).toThrow('REMOTE_AGENT_WEB_ALLOWED_LOGIN')
})

test('an empty VAPID subject falls back to the default and a non-mailto/https subject is rejected', () => {
  const withSubject = (value: string) => loadConfig({ HOME: '/home/u', ...web, REMOTE_AGENT_VAPID_SUBJECT: value })
  expect(withSubject('').web?.vapidSubject).toBe('mailto:remote-agent@localhost')
  expect(withSubject('   ').web?.vapidSubject).toBe('mailto:remote-agent@localhost')
  expect(withSubject('mailto:ops@example.com').web?.vapidSubject).toBe('mailto:ops@example.com')
  expect(withSubject('https://example.com').web?.vapidSubject).toBe('https://example.com')
  expect(() => withSubject('ops@example.com')).toThrow('REMOTE_AGENT_VAPID_SUBJECT')
  expect(() => withSubject('http://example.com')).toThrow('REMOTE_AGENT_VAPID_SUBJECT')
})

test('a VAPID subject must be a complete mailto or https URL', () => {
  const withSubject = (value: string) => loadConfig({ HOME: '/home/u', ...web, REMOTE_AGENT_VAPID_SUBJECT: value })
  expect(withSubject('mailto:ops@example.com').web?.vapidSubject).toBe('mailto:ops@example.com')
  expect(withSubject('https://push.example.com/contact').web?.vapidSubject).toBe('https://push.example.com/contact')
  expect(() => withSubject('https:')).toThrow('REMOTE_AGENT_VAPID_SUBJECT')
  expect(() => withSubject('https:x')).toThrow('REMOTE_AGENT_VAPID_SUBJECT')
  expect(() => withSubject('mailto:')).toThrow('REMOTE_AGENT_VAPID_SUBJECT')
  expect(() => withSubject('mailto:   ')).toThrow('REMOTE_AGENT_VAPID_SUBJECT')
})
