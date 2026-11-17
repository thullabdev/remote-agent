import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { validatePluginManifest } from '../../../src/extension-sdk/index.ts'
import { createExtensionStorageHost } from '../../../src/channel/web/extension-storage.ts'
import pluginJson from '../plugin.json'
import { createSessionRepository, projectOf, type SessionRepository } from './sessions.ts'

const OWNER = 'owner@example.com'

describe('session repository', () => {
  let db: Database
  let repo: SessionRepository
  let clock: number

  beforeEach(() => {
    db = new Database(':memory:', { strict: true })
    clock = 1_000
    const manifest = validatePluginManifest(pluginJson)
    const host = createExtensionStorageHost(db, () => clock)
    host.prepare(manifest, [])
    repo = createSessionRepository(host.storageFor(manifest), () => clock)
  })

  function make(sid: string, launchCwd: string, owner = OWNER, chatId: string | null = null) {
    clock += 10
    return repo.create({ sid, owner, launchCwd, chatId, tmuxName: `ra-term-${sid}` })
  }

  it('creates a session with its folder, project name, and open state', () => {
    const doc = make('term-1', '/home/me/projects/app', OWNER, 'chat-9')

    expect(doc).toMatchObject({ sid: 'term-1', owner: OWNER, launchCwd: '/home/me/projects/app', project: 'app', chatId: 'chat-9', closedAt: null, closeReason: null })
    expect(repo.get('term-1')).toEqual(doc)
  })

  it('lists only the owner\'s open sessions, newest first', () => {
    make('old', '/a')
    make('new', '/b')
    make('theirs', '/c', 'someone@else.com')
    repo.close('old', 'user')

    expect(repo.listOpen(OWNER).map(s => s.sid)).toEqual(['new'])
    expect(repo.countOpen(OWNER)).toBe(1)
  })

  it('finds the newest open session in a folder, and ignores closed ones', () => {
    make('first', '/work/app')
    make('second', '/work/app')
    make('elsewhere', '/work/other')

    expect(repo.findOpenByFolder(OWNER, '/work/app')?.sid).toBe('second')
    repo.close('second', 'user')
    expect(repo.findOpenByFolder(OWNER, '/work/app')?.sid).toBe('first')
    expect(repo.findOpenByFolder(OWNER, '/nowhere')).toBeUndefined()
  })

  it('keeps the launch folder fixed: the repository has no way to change it', () => {
    make('term-1', '/work/app')
    repo.touch('term-1', 5_000)

    expect(repo.get('term-1')?.launchCwd).toBe('/work/app')
    expect((repo as unknown as Record<string, unknown>).setFolder).toBeUndefined()
  })

  it('records the last attach time, and keeps the first close and its reason', () => {
    make('term-1', '/work/app')
    repo.touch('term-1', 5_000)
    expect(repo.get('term-1')?.lastAttachedAt).toBe(5_000)

    const first = repo.close('term-1', 'user')
    const second = repo.close('term-1', 'idle')

    expect(first?.closeReason).toBe('user')
    expect(second?.closeReason).toBe('user')
    expect(second?.closedAt).toBe(first?.closedAt)
  })

  it('does not record an attach time for a closed session', () => {
    make('term-1', '/work/app')
    repo.close('term-1', 'missing')
    repo.touch('term-1', 9_000)

    expect(repo.get('term-1')?.lastAttachedAt).toBeNull()
  })

  it('names the project after the last segment of the folder', () => {
    expect(projectOf('/home/me/projects/app')).toBe('app')
    expect(projectOf('/')).toBe('/')
  })
})
