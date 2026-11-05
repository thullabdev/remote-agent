import { beforeEach, expect, test } from 'bun:test'
import type { PromptBody } from '../../mod/remote-agent/hooks/protocol.ts'
import { Store } from '../../src/bridge/store.ts'

let clock = 1_000
let store: Store
const permission: PromptBody = { kind: 'permission', tool: 'Bash', input: { command: 'ls' } }

beforeEach(() => {
  clock = 1_000
  store = new Store(':memory:', () => clock)
  store.upsertSession({ sessionId: 's1', cwd: '/home/u/Sites/app' })
})

test('upsertSession derives the project and reopens ended sessions', () => {
  store.endSession('s1')
  expect(store.getSession('s1')?.endedAt).toBe(1_000)
  const reopened = store.upsertSession({ sessionId: 's1', cwd: '/home/u/Sites/app' })
  expect(reopened).toEqual({ id: 's1', cwd: '/home/u/Sites/app', project: 'app', threadId: null, title: null, endedAt: null, spawned: false, tmuxName: null, startedAt: null, chatId: null })
})

test('threads are stored and looked up', () => {
  store.setSessionThread('s1', 't9')
  expect(store.findSessionByThread('t9')?.id).toBe('s1')
  expect(store.listActiveSessions().map(session => session.id)).toEqual(['s1'])
})

test('setSessionChat persists and survives endSession', () => {
  store.setSessionChat('s1', 'c1')
  store.endSession('s1')
  expect(store.getSession('s1')?.chatId).toBe('c1')
})

test('findSessionByChat returns ended sessions', () => {
  store.setSessionChat('s1', 'c1')
  store.endSession('s1')
  expect(store.findSessionByChat('c1')?.id).toBe('s1')
  expect(store.findSessionByChat('missing')).toBeUndefined()
})

test('insertPrompt is idempotent', () => {
  expect(store.insertPrompt('p1', 's1', permission)).toBe(true)
  expect(store.insertPrompt('p1', 's1', permission)).toBe(false)
  expect(store.getPrompt('p1')).toMatchObject({ id: 'p1', sessionId: 's1', body: permission, status: 'pending', answer: null, partial: {}, reminded: false })
})

test('resolvePrompt lets only the first answer win', () => {
  store.insertPrompt('p1', 's1', permission)
  expect(store.resolvePrompt('p1', { kind: 'permission', decision: 'allow' }, 'local')).toBe(true)
  expect(store.resolvePrompt('p1', { kind: 'permission', decision: 'deny' }, 'remote')).toBe(false)
  expect(store.getPrompt('p1')).toMatchObject({ status: 'answered', answer: { decision: 'allow' }, source: 'local' })
})

test('partial answers round-trip', () => {
  store.insertPrompt('p1', 's1', permission)
  store.setPartial('p1', { 'Q1?': 'A' })
  expect(store.getPrompt('p1')?.partial).toEqual({ 'Q1?': 'A' })
})

test('stale prompts are pending, unreminded and old enough', () => {
  store.insertPrompt('old', 's1', permission)
  clock = 5_000
  store.insertPrompt('new', 's1', permission)
  expect(store.listStalePrompts(2_000).map(prompt => prompt.id)).toEqual(['old'])
  store.markReminded('old')
  expect(store.listStalePrompts(2_000)).toEqual([])
  expect(store.listPendingPrompts().map(prompt => prompt.id)).toEqual(['old', 'new'])
})

test('prompt messages link back to prompt and question', () => {
  store.insertPrompt('p1', 's1', permission)
  store.addPromptMessage('p1', 'm2', 1)
  store.addPromptMessage('p1', 'm1', 0)
  expect(store.findPromptMessage('m2')).toEqual({ promptId: 'p1', questionIndex: 1 })
  expect(store.findPromptMessage('nope')).toBeUndefined()
  expect(store.listPromptMessageRefs('p1')).toEqual(['m1', 'm2'])
})

test('instructions are delivered exactly once', () => {
  const instruction = store.enqueueInstruction('s1', 'add tests')
  expect(store.listPendingInstructions('s1')).toEqual([instruction])
  expect(store.getInstruction(instruction.id)).toEqual(instruction)
  expect(store.markInstructionDelivered(instruction.id)).toBe(true)
  expect(store.markInstructionDelivered(instruction.id)).toBe(false)
  expect(store.listPendingInstructions('s1')).toEqual([])
})

test('createSpawnedSession records the tmux name and is not started yet', () => {
  const row = store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/Sites/api', tmuxName: 'ra-sp1' })
  expect(row).toEqual({
    id: 'sp1', cwd: '/home/u/Sites/api', project: 'api', threadId: null, title: null, endedAt: null,
    spawned: true, tmuxName: 'ra-sp1', startedAt: null, chatId: null,
  })
})

test('upsertSession from the mod keeps the spawn fields and the thread', () => {
  store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/Sites/api', tmuxName: 'ra-sp1' })
  store.setSessionThread('sp1', 't1')
  store.markSpawnedStarted('sp1')
  const row = store.upsertSession({ sessionId: 'sp1', cwd: '/home/u/Sites/api' })
  expect(row).toMatchObject({ threadId: 't1', spawned: true, tmuxName: 'ra-sp1', startedAt: 1_000 })
})

test('markSpawnedStarted is true once, and never for a terminal-started session', () => {
  store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/Sites/api', tmuxName: 'ra-sp1' })
  expect(store.markSpawnedStarted('sp1')).toBe(true)
  expect(store.markSpawnedStarted('sp1')).toBe(false)
  expect(store.markSpawnedStarted('s1')).toBe(false)
})

test('an existing database gains the spawn columns', async () => {
  const { Database } = await import('bun:sqlite')
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = `${await mkdtemp(`${tmpdir()}/ra-store-`)}/old.db`
  const old = new Database(path, { create: true })
  old.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, project TEXT NOT NULL, thread_id TEXT, created_at INTEGER NOT NULL, ended_at INTEGER)')
  old.exec("INSERT INTO sessions (id, cwd, project, created_at) VALUES ('o1', '/x/app', 'app', 1)")
  old.close()
  const migrated = new Store(path)
  expect(migrated.getSession('o1')).toMatchObject({ spawned: false, tmuxName: null, startedAt: null, title: null })
  migrated.close()
})

test('upsertSession keeps an ended spawned session ended', () => {
  store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/Sites/api', tmuxName: 'ra-sp1' })
  store.endSession('sp1')
  const row = store.upsertSession({ sessionId: 'sp1', cwd: '/home/u/Sites/api' })
  expect(row.endedAt).toBe(1_000)
})

test('resumeSpawnedSession reopens the existing session record and resets its runtime state', () => {
  store.createSpawnedSession({ id: 'sp1', cwd: '/home/u/Sites/api', tmuxName: 'ra-sp1' })
  store.setSessionThread('sp1', 'old-thread')
  store.setSessionChat('sp1', 'chat-1')
  store.markSpawnedStarted('sp1')
  store.endSession('sp1')

  expect(store.resumeSpawnedSession('sp1', 'ra-sp1')).toBe(true)
  expect(store.getSession('sp1')).toMatchObject({
    id: 'sp1',
    threadId: null,
    chatId: 'chat-1',
    endedAt: null,
    spawned: true,
    tmuxName: 'ra-sp1',
    startedAt: null,
  })
  expect(store.resumeSpawnedSession('sp1', 'ra-sp1')).toBe(false)
})
