import { beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Launcher } from '../../src/bridge/launcher.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { CONFIG_UNREADABLE, NOT_SPAWNED, NOT_TRUSTED, READY, STALE_PICKER, Spawner, USAGE, type Schedule } from '../../src/bridge/spawner.ts'
import { Store } from '../../src/bridge/store.ts'
import { TrustedFolders } from '../../src/bridge/trusted.ts'
import { FakeChannel, flush } from '../support/fake-channel.ts'
import { FakeTmux } from '../support/fake-tmux.ts'

type Timer = { run: () => void; ms: number; cancelled: boolean }

let home: string
let store: Store
let channel: FakeChannel
let tmux: FakeTmux
let timers: Timer[]
let projects: string[]
let configPath: string
let spawner: Spawner
let ids: number

const schedule: Schedule = (run, ms) => {
  const timer = { run, ms, cancelled: false }
  timers.push(timer)
  return () => {
    timer.cancelled = true
  }
}

function idFor(n: number): string {
  return `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
}

function build(): Spawner {
  const notifier = new Notifier(store, channel, new AwayMode(false), () => {})
  return new Spawner({
    store,
    channel,
    notifier,
    launcher: new Launcher(tmux.run),
    trusted: new TrustedFolders({ configPath, home, projects }),
    log: () => {},
    schedule,
    sleep: async () => {},
    newId: () => idFor(++ids),
  })
}

beforeEach(async () => {
  home = await realpath(await mkdtemp(`${tmpdir()}/ra-spawner-`))
  await mkdir(`${home}/Sites/api`, { recursive: true })
  await mkdir(`${home}/Sites/My Projects/app`, { recursive: true })
  await mkdir(`${home}/Sites/secret`, { recursive: true })
  configPath = `${home}/.claude.json`
  await writeFile(configPath, JSON.stringify({ projects: {
    [`${home}/Sites/api`]: { hasTrustDialogAccepted: true },
    [`${home}/Sites/My Projects/app`]: { hasTrustDialogAccepted: true },
    [`${home}/Sites/secret`]: { hasTrustDialogAccepted: false },
  } }))
  projects = ['~/Sites/api', '~/Sites/secret']
  store = new Store(':memory:')
  channel = new FakeChannel()
  tmux = new FakeTmux()
  timers = []
  ids = 0
  spawner = build()
})

test('/new posts one button per trusted configured project', async () => {
  expect(await spawner.newCommand(null, '')).toBeNull()
  expect(channel.buttons).toEqual([{
    thread: null,
    text: 'Start a session in:',
    buttons: [{ label: 'api', data: { kind: 'launch', pickerId: '00000001', choice: 0 } }],
  }])
})

test('tapping a project creates the thread first, then launches and arms the startup timer', async () => {
  await spawner.newCommand(null, '')
  const toast = await spawner.startFromPicker('00000001', 0)
  const sessionId = idFor(2)
  expect(toast).toBe('🚀 Starting api. Open its topic.')
  expect(channel.threads.map(thread => thread.title)).toEqual(['api · 00000002'])
  expect(tmux.calls[0]).toEqual([
    'env', '-u', 'TELEGRAM_BOT_TOKEN', '-u', 'TELEGRAM_CHAT_ID', '-u', 'TELEGRAM_ALLOWED_USER_ID',
    'systemd-run', '--user', '--scope', '--quiet', '--collect',
    'tmux', 'new-session', '-d', '-s', 'ra-00000002', '-c', `${home}/Sites/api`,
    'claude', '--session-id', sessionId,
  ])
  expect(store.getSession(sessionId)).toMatchObject({ spawned: true, tmuxName: 'ra-00000002', threadId: channel.threads[0]?.ref, startedAt: null, endedAt: null })
  expect(channel.texts.map(text => text.text)).toEqual(['⏳ Starting… attach with: tmux attach -t ra-00000002'])
  expect(timers.map(timer => timer.ms)).toEqual([30_000])
})

test('a failed Starting message still returns the toast for a running session', async () => {
  channel.sendTextFails = '⏳ Starting'
  expect(await spawner.newCommand(null, '~/Sites/api')).toBe('🚀 Starting api. Open its topic.')
  expect(tmux.alive.size).toBe(1)
  expect(store.getSession(idFor(ids))?.endedAt).toBeNull()
})

test('/new with a trusted path containing spaces launches there', async () => {
  expect(await spawner.newCommand('t9', '~/Sites/My Projects/app')).toBe('🚀 Starting app. Open its topic.')
  expect(tmux.calls[0]).toContain(`${home}/Sites/My Projects/app`)
})

test('untrusted, subfolder and relative paths are refused without launching', async () => {
  expect(await spawner.newCommand(null, '~/Sites/secret')).toBe(NOT_TRUSTED)
  expect(await spawner.newCommand(null, '~/Sites')).toBe(NOT_TRUSTED)
  expect(await spawner.newCommand(null, 'Sites/api')).toBe(NOT_TRUSTED)
  expect(tmux.calls).toEqual([])
  expect(channel.threads).toEqual([])
})

test('/new without projects or a path explains the usage', async () => {
  projects = []
  spawner = build()
  expect(await spawner.newCommand(null, '')).toBe(USAGE)
})

test('an unknown picker is stale', async () => {
  expect(await spawner.startFromPicker('deadbeef', 0)).toBe(STALE_PICKER)
  await spawner.newCommand(null, '')
  expect(await spawner.startFromPicker('00000001', 5)).toBe(STALE_PICKER)
})

test('an unreadable claude config is reported', async () => {
  await writeFile(configPath, '{oops')
  expect(await spawner.newCommand(null, '')).toBe(CONFIG_UNREADABLE)
  expect(await spawner.newCommand(null, '~/Sites/api')).toBe(CONFIG_UNREADABLE)
})

test('the first mod request posts Ready once, even when several arrive together', async () => {
  await spawner.newCommand(null, '~/Sites/api')
  const sessionId = idFor(1)
  await Promise.all([spawner.onSessionStarted(sessionId), spawner.onSessionStarted(sessionId), spawner.onSessionStarted(sessionId)])
  expect(channel.texts.filter(text => text.text === READY)).toHaveLength(1)
  expect(timers[0]?.cancelled).toBe(true)
  expect(store.getSession(sessionId)?.startedAt).not.toBeNull()
})

test('onSessionStarted ignores terminal-started and unknown sessions', async () => {
  store.upsertSession({ sessionId: 's1', cwd: '/x/app' })
  await spawner.onSessionStarted('s1')
  await spawner.onSessionStarted('nope')
  expect(channel.texts).toEqual([])
})

test('a session that never starts gets its screen posted, then is killed and closed', async () => {
  await spawner.newCommand(null, '~/Sites/api')
  const sessionId = idFor(1)
  tmux.screen = 'Welcome\nAPI key: password=hunter22\nPlease run /login\n'
  timers[0]?.run()
  await flush()
  const posted = channel.texts.at(-1)?.text ?? ''
  expect(posted).toStartWith('❌ Session did not start within 30s. Last output:')
  expect(posted).toContain('password=[REDACTED]')
  expect(posted).toContain('Please run /login')
  expect(tmux.alive.has('ra-00000001')).toBe(false)
  expect(store.getSession(sessionId)?.endedAt).not.toBeNull()
  expect(channel.threads[0]?.closed).toBe(true)
})

test('the startup timer does nothing once the session is ready', async () => {
  await spawner.newCommand(null, '~/Sites/api')
  await spawner.onSessionStarted(idFor(1))
  timers[0]?.run()
  await flush()
  expect(tmux.alive.has('ra-00000001')).toBe(true)
})

test('a failed launch is reported in the thread and the reply, and the thread is closed', async () => {
  tmux.launchFails = 'tmux: command not found'
  const reply = await spawner.newCommand(null, '~/Sites/api')
  expect(reply).toBe('❌ Could not start the session: tmux: command not found')
  expect(channel.texts.map(text => text.text)).toEqual(['❌ Could not start the session:\ntmux: command not found'])
  expect(channel.threads[0]?.closed).toBe(true)
  expect(store.getSession(idFor(1))?.endedAt).not.toBeNull()
  expect(timers).toEqual([])
})

test('when the topic cannot be created nothing is launched and the session is ended', async () => {
  channel.createThreadFails = true
  expect(await spawner.newCommand(null, '~/Sites/api')).toBe('❌ Could not create a topic for the session.')
  expect(tmux.calls).toEqual([])
  expect(store.getSession(idFor(1))?.endedAt).not.toBeNull()
})

test('a kill that fails still ends the session and closes the thread', async () => {
  await spawner.newCommand(null, '~/Sites/api')
  tmux.killFails = 'permission denied'
  timers[0]?.run()
  await flush()
  expect(store.getSession(idFor(1))?.endedAt).not.toBeNull()
  expect(channel.threads[0]?.closed).toBe(true)
})

test('a session that becomes ready while the timeout captures is left alone', async () => {
  await spawner.newCommand(null, '~/Sites/api')
  tmux.onCapture = () => spawner.onSessionStarted(idFor(1))
  timers[0]?.run()
  await flush()
  expect(tmux.alive.has('ra-00000001')).toBe(true)
  expect(store.getSession(idFor(1))?.endedAt).toBeNull()
  expect(channel.texts.some(text => text.text.includes('did not start'))).toBe(false)
  expect(channel.threads[0]?.closed).toBeFalsy()
})

async function startedSession(): Promise<{ id: string; thread: string }> {
  await spawner.newCommand(null, '~/Sites/api')
  const id = idFor(ids)
  await spawner.onSessionStarted(id)
  return { id, thread: store.getSession(id)?.threadId ?? '' }
}

test('/end exits gracefully and closes the thread', async () => {
  const { id, thread } = await startedSession()
  expect(await spawner.end(thread)).toBe('⏹ Ending the session…')
  await flush()
  expect(tmux.commands()).toEqual(['launch', 'has-session', 'send-keys', 'has-session'])
  expect(store.getSession(id)?.endedAt).not.toBeNull()
  expect(channel.threads[0]?.closed).toBe(true)
})

test('/end kills the session when /exit does not work within the grace period', async () => {
  const { id, thread } = await startedSession()
  tmux.exitWorks = false
  await spawner.end(thread)
  await flush()
  expect(tmux.commands()).toEqual(['launch', 'has-session', 'send-keys', 'has-session', 'kill-session'])
  expect(tmux.alive.size).toBe(0)
  expect(store.getSession(id)?.endedAt).not.toBeNull()
})

test('a second /end during the grace period is refused', async () => {
  const { id, thread } = await startedSession()
  let release = (): void => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const notifier = new Notifier(store, channel, new AwayMode(false), () => {})
  spawner = new Spawner({ store, channel, notifier, launcher: new Launcher(tmux.run), trusted: new TrustedFolders({ configPath, home, projects }), log: () => {}, schedule, sleep: () => gate })
  expect(await spawner.end(thread)).toBe('⏹ Ending the session…')
  await flush()
  expect(await spawner.end(thread)).toBe('⏹ Already ending.')
  expect(store.getSession(id)?.endedAt).toBeNull()
  release()
  await flush()
  expect(tmux.commands().filter(command => command === 'send-keys')).toHaveLength(1)
  expect(store.getSession(id)?.endedAt).not.toBeNull()
})

test('/end when tmux is already gone just closes the session', async () => {
  const { id, thread } = await startedSession()
  tmux.alive.clear()
  expect(await spawner.end(thread)).toBe('⚪ The session was already gone.')
  expect(store.getSession(id)?.endedAt).not.toBeNull()
})

test('/end refuses terminal-started sessions, ended sessions and the General topic', async () => {
  store.upsertSession({ sessionId: 's1', cwd: '/x/app' })
  store.setSessionThread('s1', 't77')
  expect(await spawner.end('t77')).toBe(NOT_SPAWNED)
  expect(await spawner.end('t-unknown')).toBe('This session has ended.')
  expect(await spawner.end(null)).toBe('Send /end inside a session topic.')
})

test('reconcile closes dead sessions and re-arms the timer for alive ones that never reported', async () => {
  store.createSpawnedSession({ id: 'gone', cwd: `${home}/Sites/api`, tmuxName: 'ra-gone' })
  store.setSessionThread('gone', 't1')
  store.createSpawnedSession({ id: 'ready', cwd: `${home}/Sites/api`, tmuxName: 'ra-ready' })
  store.markSpawnedStarted('ready')
  store.createSpawnedSession({ id: 'booting', cwd: `${home}/Sites/api`, tmuxName: 'ra-booting' })
  store.upsertSession({ sessionId: 'terminal', cwd: '/x/app' })
  tmux.alive.add('ra-ready')
  tmux.alive.add('ra-booting')
  await spawner.reconcile()
  expect(store.getSession('gone')?.endedAt).not.toBeNull()
  expect(store.getSession('ready')?.endedAt).toBeNull()
  expect(store.getSession('booting')?.endedAt).toBeNull()
  expect(store.getSession('terminal')?.endedAt).toBeNull()
  expect(timers.map(timer => timer.ms)).toEqual([30_000])
})

test('/end still closes the session when sending /exit fails', async () => {
  const { id, thread } = await startedSession()
  tmux.sendKeysFails = 'tmux exploded'
  expect(await spawner.end(thread)).toBe('⏹ Ending the session…')
  await flush()
  expect(store.getSession(id)?.endedAt).not.toBeNull()
  expect(channel.threads[0]?.closed).toBe(true)
})

test('/end still closes the session when /exit does not work and kill fails', async () => {
  const { id, thread } = await startedSession()
  tmux.exitWorks = false
  tmux.killFails = 'permission denied'
  expect(await spawner.end(thread)).toBe('⏹ Ending the session…')
  await flush()
  expect(store.getSession(id)?.endedAt).not.toBeNull()
  expect(channel.threads[0]?.closed).toBe(true)
})
