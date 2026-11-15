import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validatePluginManifest } from '../../../src/extension-sdk/index.ts'
import { createExtensionStorageHost } from '../../../src/channel/web/extension-storage.ts'
import pluginJson from '../plugin.json'
import { createSessionRoutes, MAX_OPEN_SESSIONS, type TmuxOps } from './routes.ts'
import { createSessionRepository, type SessionRepository } from './sessions.ts'

const OWNER = 'owner@example.com'
let clock = 1_000

function post(path: string, body: unknown): Request {
  return new Request(`http://local${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
}

describe('session routes', () => {
  let dir: string
  let db: Database
  let repo: SessionRepository
  let created: Array<{ name: string; cwd: string }>
  let killed: string[]
  let tmux: TmuxOps
  let tmuxAvailable: boolean
  let tmuxFailure: string | null
  let routes: ReturnType<typeof createSessionRoutes>
  let next: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ra-routes-'))
    db = new Database(':memory:', { strict: true })
    const manifest = validatePluginManifest(pluginJson)
    const host = createExtensionStorageHost(db)
    host.prepare(manifest, [])
    clock = 1_000
    repo = createSessionRepository(host.storageFor(manifest), () => clock)
    created = []
    killed = []
    tmuxAvailable = true
    tmuxFailure = null
    next = 0
    tmux = {
      available: async () => tmuxAvailable,
      create: async input => {
        if (tmuxFailure !== null) {
          throw new Error(tmuxFailure)
        }
        created.push({ name: input.name, cwd: input.cwd })
      },
      kill: async name => {
        killed.push(name)
      },
    }
    routes = createSessionRoutes({
      owner: OWNER,
      repo,
      tmux,
      newSid: () => `term-${++next}`,
      nameFor: sid => `ra-term-${sid}`,
      shell: '/bin/sh',
      home: dir,
    })
  })

  // Using rmSync in afterEach keeps the temp folder list clean across tests.
  function cleanup(): void {
    rmSync(dir, { recursive: true, force: true })
  }

  it('creates a session in the given folder, stores it, and returns it', async () => {
    const response = await routes.create(post('/sessions', { cwd: dir, chatId: 'chat-1' }))
    const body = (await response.json()) as { sid: string; cwd: string; createdAt: number }

    expect(response.status).toBe(201)
    expect(body).toEqual({ sid: 'term-1', cwd: dir, createdAt: 1_000 })
    expect(created).toEqual([{ name: 'ra-term-term-1', cwd: dir }])
    expect(repo.get('term-1')).toMatchObject({ launchCwd: dir, chatId: 'chat-1', owner: OWNER })
    cleanup()
  })

  it('starts in home when no folder is given', async () => {
    const response = await routes.create(post('/sessions', {}))

    expect(response.status).toBe(201)
    expect(created[0]?.cwd).toBe(dir)
    cleanup()
  })

  it('refuses a missing folder by name, and stores nothing', async () => {
    const response = await routes.create(post('/sessions', { cwd: '/no/such/folder/ra' }))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toContain('/no/such/folder/ra')
    expect(created).toEqual([])
    expect(repo.listOpen(OWNER)).toEqual([])
    cleanup()
  })

  it('refuses a session past the limit, and says how many are open', async () => {
    for (let i = 0; i < MAX_OPEN_SESSIONS; i++) {
      repo.create({ sid: `open-${i}`, owner: OWNER, launchCwd: dir, chatId: null, tmuxName: `ra-term-open-${i}` })
    }

    const response = await routes.create(post('/sessions', { cwd: dir }))
    const body = (await response.json()) as { error: string; open: number }

    expect(response.status).toBe(409)
    expect(body.open).toBe(MAX_OPEN_SESSIONS)
    expect(created).toEqual([])
    cleanup()
  })

  it('says tmux is missing, and stores nothing', async () => {
    tmuxAvailable = false

    const response = await routes.create(post('/sessions', { cwd: dir }))

    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toBe('tmux is not installed on this machine')
    expect(repo.listOpen(OWNER)).toEqual([])
    cleanup()
  })

  it('reports a tmux failure, and stores nothing', async () => {
    tmuxFailure = 'tmux could not start the session'

    const response = await routes.create(post('/sessions', { cwd: dir }))

    expect(response.status).toBe(500)
    expect(repo.listOpen(OWNER)).toEqual([])
    cleanup()
  })

  it('rejects a body that is not a JSON object, or a bad chat id', async () => {
    expect((await routes.create(post('/sessions', '[1,2]'))).status).toBe(400)
    expect((await routes.create(post('/sessions', '{bad json'))).status).toBe(400)
    expect((await routes.create(post('/sessions', { cwd: dir, chatId: 42 }))).status).toBe(400)
    expect(created).toEqual([])
    cleanup()
  })

  it('lists only the caller\'s open sessions, newest first, without internal fields', async () => {
    await routes.create(post('/sessions', { cwd: dir }))
    clock += 5
    await routes.create(post('/sessions', { cwd: dir }))
    repo.create({ sid: 'theirs', owner: 'someone@else.com', launchCwd: dir, chatId: null, tmuxName: 'ra-term-theirs' })

    const body = (await (await routes.list()).json()) as { sessions: Array<Record<string, unknown>> }

    expect(body.sessions.map(s => s.sid)).toEqual(['term-2', 'term-1'])
    expect(Object.keys(body.sessions[0] ?? {}).sort()).toEqual(['chatId', 'createdAt', 'cwd', 'lastAttachedAt', 'project', 'sid'])
    cleanup()
  })

  it('closes the caller\'s session: kills tmux and records the close', async () => {
    await routes.create(post('/sessions', { cwd: dir }))

    const response = await routes.close(post('/sessions/close', { sid: 'term-1' }))

    expect(response.status).toBe(200)
    expect(killed).toEqual(['ra-term-term-1'])
    expect(repo.get('term-1')?.closeReason).toBe('user')
    cleanup()
  })

  it('does not close another owner\'s session, and does not close one twice', async () => {
    repo.create({ sid: 'theirs', owner: 'someone@else.com', launchCwd: dir, chatId: null, tmuxName: 'ra-term-theirs' })
    await routes.create(post('/sessions', { cwd: dir }))

    expect((await routes.close(post('/sessions/close', { sid: 'theirs' }))).status).toBe(404)
    expect((await routes.close(post('/sessions/close', { sid: 'term-1' }))).status).toBe(200)
    expect((await routes.close(post('/sessions/close', { sid: 'term-1' }))).status).toBe(404)
    expect(killed).toEqual(['ra-term-term-1'])
    expect(repo.get('theirs')?.closedAt).toBeNull()
    cleanup()
  })

  it('needs a sid to close', async () => {
    expect((await routes.close(post('/sessions/close', {}))).status).toBe(400)
    cleanup()
  })
})
