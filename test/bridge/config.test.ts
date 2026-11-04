import { expect, test } from 'bun:test'
import { loadConfig } from '../../src/bridge/config.ts'

const base = {
  TELEGRAM_BOT_TOKEN: '123456:ABC-def_ghi',
  TELEGRAM_CHAT_ID: '-1001234567890',
  TELEGRAM_ALLOWED_USER_ID: '42',
  HOME: '/home/u',
  XDG_RUNTIME_DIR: '/run/user/1000',
}

test('loads a valid environment with defaults', () => {
  expect(loadConfig(base)).toEqual({
    botToken: '123456:ABC-def_ghi',
    chatId: -1001234567890,
    allowedUserId: 42,
    socketPath: '/run/user/1000/remote-agent/bridge.sock',
    dbPath: '/home/u/.local/state/remote-agent/bridge.db',
    reminderAfterMs: 30 * 60_000,
    home: '/home/u',
    projects: [],
  })
})

test('reads the project list', () => {
  const config = loadConfig({ ...base, REMOTE_AGENT_PROJECTS: ' ~/Sites/api , /srv/app,, ' })
  expect(config.projects).toEqual(['~/Sites/api', '/srv/app'])
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
