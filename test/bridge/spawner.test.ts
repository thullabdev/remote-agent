import { beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Launcher } from '../../src/bridge/launcher.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { CONFIG_UNREADABLE, NOT_TRUSTED, READY, STALE_PICKER, Spawner, USAGE, type Schedule } from '../../src/bridge/spawner.ts'
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
    'systemd-run', '--user', '--scope', '--quiet', '--collect',
    'tmux', 'new-session', '-d', '-s', 'ra-00000002', '-c', `${home}/Sites/api`,
    'claude', '--session-id', sessionId,
  ])
  expect(store.getSession(sessionId)).toMatchObject({ spawned: true, tmuxName: 'ra-00000002', threadId: channel.threads[0]?.ref, startedAt: null, endedAt: null })
  expect(channel.texts.map(text => text.text)).toEqual(['⏳ Starting… attach with: tmux attach -t ra-00000002'])
  expect(timers.map(timer => timer.ms)).toEqual([30_000])
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
