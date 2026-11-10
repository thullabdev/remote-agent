import { beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Launcher } from '../../src/bridge/launcher.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { BAD_MODEL, CONFIG_UNREADABLE, NOT_SPAWNED, NOT_TRUSTED, READY, STALE_PICKER, Spawner, USAGE, parseNewArgs, type Schedule } from '../../src/bridge/spawner.ts'
import { Store } from '../../src/bridge/store.ts'
import { TrustedFolders } from '../../src/bridge/trusted.ts'
import { ChatLog } from '../../src/channel/web/chat-log.ts'
import { transcriptPath } from '../../src/channel/web/transcript/path.ts'
import { WebChannel } from '../../src/channel/web/web-channel.ts'
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

async function writeProjectsConfig(): Promise<void> {
  const configProjects = Object.fromEntries(projects.map(path => [
    path.startsWith('~/') ? `${home}${path.slice(1)}` : path,
    { hasTrustDialogAccepted: true },
  ]))
  await writeFile(configPath, JSON.stringify({ projects: configProjects }))
}

function build(): Spawner {
  const notifier = new Notifier(store, channel, new AwayMode(false), () => {})
  return new Spawner({
    store,
    channel,
    notifier,
    launcher: new Launcher(tmux.run),
    trusted: new TrustedFolders({ home, configPath, projects: [] }),
    home,
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
  projects = ['~/Sites/api', '~/Sites/gone']
  configPath = `${home}/.claude.json`
  await writeProjectsConfig()
  store = new Store(':memory:')
  channel = new FakeChannel()
  tmux = new FakeTmux()
  timers = []
  ids = 0
  spawner = build()
})

test('/new posts one button per existing listed project', async () => {
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
  expect(channel.threads.map(thread => thread.title)).toEqual(['api · New session'])
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

test('parseNewArgs takes --model or -m before or after the path', () => {
  expect(parseNewArgs('')).toEqual({ path: '', model: null, resume: false })
  expect(parseNewArgs('~/Sites/My Projects/app')).toEqual({ path: '~/Sites/My Projects/app', model: null, resume: false })
  expect(parseNewArgs('--model opus ~/Sites/My Projects/app')).toEqual({ path: '~/Sites/My Projects/app', model: 'opus', resume: false })
  expect(parseNewArgs('~/Sites/api -m claude-sonnet-5-5')).toEqual({ path: '~/Sites/api', model: 'claude-sonnet-5-5', resume: false })
  expect(parseNewArgs('--model haiku')).toEqual({ path: '', model: 'haiku', resume: false })
  expect(parseNewArgs('--resume ~/Sites/api')).toEqual({ path: '~/Sites/api', model: null, resume: true })
  expect(parseNewArgs('--resume --model opus ~/Sites/api')).toEqual({ path: '~/Sites/api', model: 'opus', resume: true })
  expect(parseNewArgs('--model')).toBeNull()
  expect(parseNewArgs('--model gpt-5 ~/Sites/api')).toBeNull()
  expect(parseNewArgs('--model --dangerously-skip-permissions ~/Sites/api')).toBeNull()
})

test('/new with a model launches claude with --model and says so', async () => {
  expect(await spawner.newCommand(null, '--model opus ~/Sites/api')).toBe('🚀 Starting api with opus. Open its topic.')
  expect(tmux.calls[0]?.slice(-2)).toEqual(['--model', 'opus'])
})

test('/new with an unknown model is refused without launching', async () => {
  expect(await spawner.newCommand(null, '--model gpt-5 ~/Sites/api')).toBe(BAD_MODEL)
  expect(tmux.calls).toEqual([])
  expect(channel.threads).toEqual([])
})

test('the picker remembers the model given to /new', async () => {
  expect(await spawner.newCommand(null, '-m sonnet')).toBeNull()
  expect(channel.buttons[0]?.text).toBe('Start a session with sonnet in:')
  expect(await spawner.startFromPicker('00000001', 0)).toBe('🚀 Starting api with sonnet. Open its topic.')
  expect(tmux.calls[0]?.slice(-2)).toEqual(['--model', 'sonnet'])
})

test('/new --resume lists histories for a trusted folder and forks the selected transcript', async () => {
  const projectDir = `${home}/.claude/projects/${`${home}/Sites/api`.replace(/[/.]/g, '-')}`
  await mkdir(projectDir, { recursive: true })
  await writeFile(`${projectDir}/history-0001.jsonl`, `${JSON.stringify({
    type: 'user',
    message: { content: 'Fix the API tests' },
  })}\n`)
  expect(await spawner.newCommand(null, '--resume ~/Sites/api')).toBeNull()
  expect(channel.buttons[0]).toMatchObject({
    text: `Resume a history from api:`,
    buttons: [{ label: expect.stringContaining('Fix the API tests'), data: { kind: 'launch', pickerId: '00000001', choice: 0 } }],
  })
  expect(await spawner.startFromPicker('00000001', 0)).toBe('Forking api. Open its topic.')
  expect(tmux.calls[0]?.slice(-6)).toEqual([
    'claude', '--resume', 'history-0001', '--fork-session', '--session-id', idFor(2),
  ])
})

test('/new --resume without a folder asks for a project before listing its histories', async () => {
  const projectDir = `${home}/.claude/projects/${`${home}/Sites/api`.replace(/[/.]/g, '-')}`
  await mkdir(projectDir, { recursive: true })
  await writeFile(transcriptPath(home, `${home}/Sites/api`, 'history-0001'), `${JSON.stringify({
    type: 'user',
    message: { content: 'Continue the API work' },
  })}\n`)
  expect(await spawner.newCommand('general', '--resume')).toBeNull()
  expect(channel.buttons[0]?.text).toBe('Choose a project to resume from:')
  expect(await spawner.startFromPicker('00000001', 0)).toBe('Session histories listed.')
  expect(channel.buttons[1]?.text).toBe('Resume a history from api:')
  expect(await spawner.startFromPicker('00000002', 0)).toBe('Forking api. Open its topic.')
})

test('/new --resume refuses untrusted folders and reports when no histories exist', async () => {
  expect(await spawner.newCommand(null, '--resume ~/Sites/secret')).toBe(NOT_TRUSTED)
  expect(await spawner.newCommand(null, '--resume ~/Sites/api')).toBe(`No session histories found in ${home}/Sites/api.`)
  expect(channel.buttons).toEqual([])
  expect(tmux.calls).toEqual([])
})

test('/new with a listed path containing spaces launches there', async () => {
  projects.push('~/Sites/My Projects/app')
  await writeProjectsConfig()
  expect(await spawner.newCommand('t9', '~/Sites/My Projects/app')).toBe('🚀 Starting app. Open its topic.')
  expect(tmux.calls[0]).toContain(`${home}/Sites/My Projects/app`)
})

test('unlisted, subfolder and relative paths are refused without launching', async () => {
  expect(await spawner.newCommand(null, '~/Sites/secret')).toBe(NOT_TRUSTED)
  expect(await spawner.newCommand(null, '~/Sites')).toBe(NOT_TRUSTED)
  expect(await spawner.newCommand(null, 'Sites/api')).toBe(NOT_TRUSTED)
  expect(tmux.calls).toEqual([])
  expect(channel.threads).toEqual([])
})

test('/new without projects or a path explains the usage', async () => {
  projects = []
  await writeProjectsConfig()
  spawner = build()
  expect(await spawner.newCommand(null, '')).toBe(USAGE)
})

test('/new reports a missing Claude config explicitly', async () => {
  configPath = `${home}/missing.json`
  spawner = build()
  expect(await spawner.newCommand(null, '')).toBe(CONFIG_UNREADABLE)
})

test('an unknown picker is stale', async () => {
  expect(await spawner.startFromPicker('deadbeef', 0)).toBe(STALE_PICKER)
  await spawner.newCommand(null, '')
  expect(await spawner.startFromPicker('00000001', 5)).toBe(STALE_PICKER)
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
  spawner = new Spawner({ store, channel, notifier, launcher: new Launcher(tmux.run), trusted: new TrustedFolders({ home, configPath, projects: [] }), home, log: () => {}, schedule, sleep: () => gate })
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

test('a spawned session ends up with one chat linked via chat_id and thread_id', async () => {
  const chatLog = new ChatLog(store)
  const webChannel = new WebChannel(chatLog, () => {}, store)
  const notifier = new Notifier(store, webChannel, new AwayMode(false), () => {}, webChannel)
  spawner = new Spawner({
    store,
    channel: webChannel,
    notifier,
    launcher: new Launcher(tmux.run),
    trusted: new TrustedFolders({ home, configPath, projects: [] }),
    home,
    log: () => {},
    schedule,
    sleep: async () => {},
    newId: () => idFor(++ids),
  })

  expect(await spawner.newCommand(null, '~/Sites/api')).toBe('🚀 Starting api. Open its topic.')

  const session = store.getSession(idFor(1))!
  expect(session.chatId).not.toBeNull()
  expect(session.threadId).toBe(session.chatId)
  const chats = chatLog.listChats().filter(chat => chat.id !== 'general')
  expect(chats).toHaveLength(1)
  expect(chats[0]).toMatchObject({ id: session.chatId, spawned: true, cwd: `${home}/Sites/api`, project: 'api' })
})

function webSpawner(): { chatLog: ChatLog; webChannel: WebChannel } {
  const chatLog = new ChatLog(store)
  const webChannel = new WebChannel(chatLog, () => {}, store)
  const notifier = new Notifier(store, webChannel, new AwayMode(false), () => {}, webChannel)
  spawner = new Spawner({
    store,
    channel: webChannel,
    notifier,
    launcher: new Launcher(tmux.run),
    trusted: new TrustedFolders({ home, configPath, projects: [] }),
    home,
    log: () => {},
    schedule,
    sleep: async () => {},
    newId: () => idFor(++ids),
  })
  return { chatLog, webChannel }
}

const statusCards = (chatLog: ChatLog, chatId: string) =>
  chatLog.listMessages(chatId, { limit: 50 }).messages.filter(message => message.kind === 'session_status')

test('on the web a launch shows one startup card that moves from starting to ready, with the folder on it', async () => {
  const { chatLog } = webSpawner()
  await spawner.newCommand(null, '~/Sites/api')
  const chatId = store.getSession(idFor(1))!.chatId!
  expect(statusCards(chatLog, chatId)).toMatchObject([{ state: 'starting', cwd: `${home}/Sites/api` }])

  await spawner.onSessionStarted(idFor(1))

  const cards = statusCards(chatLog, chatId)
  expect(cards).toHaveLength(1)
  expect(cards[0]).toMatchObject({ state: 'ready', cwd: `${home}/Sites/api` })
  const texts = chatLog.listMessages(chatId, { limit: 50 }).messages.filter(message => message.kind === 'system')
  expect(texts).toEqual([])
})

test('on the web a session that never starts turns the card into a failure with the screen as its details', async () => {
  const { chatLog } = webSpawner()
  await spawner.newCommand(null, '~/Sites/api')
  const chatId = store.getSession(idFor(1))!.chatId!
  tmux.screen = 'Please run /login\n'
  timers[0]?.run()
  await flush()
  const cards = statusCards(chatLog, chatId)
  expect(cards).toHaveLength(1)
  expect(cards[0]).toMatchObject({ state: 'failed', message: 'The session did not start within 30s' })
  expect(cards[0]?.kind === 'session_status' && cards[0].detail).toContain('Please run /login')
})

test('the web channel reports a launched session starting only once, so the card is not repeated by the mod report', async () => {
  const { chatLog, webChannel } = webSpawner()
  await spawner.newCommand(null, '~/Sites/api')
  const session = store.getSession(idFor(1))!
  webChannel.report(session, { kind: 'session_started' } as never)
  const messages = chatLog.listMessages(session.chatId!, { limit: 50 }).messages
  expect(messages.filter(message => message.kind === 'system')).toEqual([])
})
