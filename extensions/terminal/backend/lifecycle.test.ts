import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { validatePluginManifest } from '../../../src/extension-sdk/index.ts'
import { createExtensionStorageHost } from '../../../src/channel/web/extension-storage.ts'
import pluginJson from '../plugin.json'
import { IDLE_AFTER_MS, reconcile, sweepIdle, type LifecycleDeps } from './lifecycle.ts'
import { createSessionRepository, type SessionRepository } from './sessions.ts'

const OWNER = 'owner@example.com'
const HOUR = 60 * 60 * 1000

describe('terminal lifecycle', () => {
  let repo: SessionRepository
  let now: number
  let alive: Set<string>
  let killed: string[]
  let attached: Set<string>
  let logs: string[]

  beforeEach(() => {
    const db = new Database(':memory:', { strict: true })
    const manifest = validatePluginManifest(pluginJson)
    const host = createExtensionStorageHost(db)
    host.prepare(manifest, [])
    now = 100 * HOUR
    repo = createSessionRepository(host.storageFor(manifest), () => now)
    alive = new Set()
    killed = []
    attached = new Set()
    logs = []
  })

  function deps(): LifecycleDeps {
    return {
      owner: OWNER,
      repo,
      alive: async name => alive.has(name),
      kill: async name => {
        killed.push(name)
        alive.delete(name)
      },
      isAttached: sid => attached.has(sid),
      now: () => now,
      log: message => logs.push(message),
    }
  }

  function session(sid: string, createdAt: number, owner = OWNER): void {
    now = createdAt
    repo.create({ sid, owner, launchCwd: '/work/app', chatId: null, tmuxName: `ra-term-${sid}` })
    alive.add(`ra-term-${sid}`)
  }

  it('closes stored sessions whose tmux session is gone, and keeps the rest', async () => {
    session('one', 10)
    session('two', 20)
    alive.delete('ra-term-two')

    const closed = await reconcile(deps())

    expect(closed).toBe(1)
    expect(repo.get('two')?.closeReason).toBe('missing')
    expect(repo.get('one')?.closedAt).toBeNull()
    expect(logs.length).toBe(1)
  })

  it('leaves surviving sessions and their idle clocks alone on restart', async () => {
    session('kept', 10)
    repo.touch('kept', 50 * HOUR)

    await reconcile(deps())

    expect(repo.get('kept')?.closedAt).toBeNull()
    expect(repo.get('kept')?.lastAttachedAt).toBe(50 * HOUR)
  })

  it('reaps a detached session after 12 hours, measured from its last detach', async () => {
    session('stale', 0)
    repo.touch('stale', 10 * HOUR)
    session('fresh', 0)
    repo.touch('fresh', 90 * HOUR)
    now = 100 * HOUR

    const reaped = await sweepIdle(deps())

    expect(reaped).toBe(1)
    expect(killed).toEqual(['ra-term-stale'])
    expect(repo.get('stale')).toMatchObject({ closeReason: 'idle' })
    expect(repo.get('fresh')?.closedAt).toBeNull()
    expect(IDLE_AFTER_MS).toBe(12 * HOUR)
  })

  it('never reaps an attached session, however old', async () => {
    session('busy', 0)
    attached.add('busy')
    now = 500 * HOUR

    expect(await sweepIdle(deps())).toBe(0)
    expect(repo.get('busy')?.closedAt).toBeNull()
  })

  it('starts the clock at creation for a session that was never attached', async () => {
    session('new', 0)
    now = IDLE_AFTER_MS - 1
    expect(await sweepIdle(deps())).toBe(0)
    now = IDLE_AFTER_MS + 1
    expect(await sweepIdle(deps())).toBe(1)
  })

  it('ignores other owners\' sessions', async () => {
    session('theirs', 0, 'someone@else.com')
    now = 500 * HOUR

    expect(await sweepIdle(deps())).toBe(0)
    expect(repo.get('theirs')?.closedAt).toBeNull()
  })
})
