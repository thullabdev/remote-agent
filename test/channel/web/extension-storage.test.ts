import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validatePluginManifest, type ExtensionManifest } from '../../../src/extension-sdk/index.ts'
import { createExtensionStorageHost, type ExtensionMigration, type ExtensionStorageHost } from '../../../src/channel/web/extension-storage.ts'
import { loadExtensions } from '../../../src/channel/web/extension-registry.ts'

function manifestFor(id: string, extra: Record<string, unknown> = {}): ExtensionManifest {
  return validatePluginManifest({
    id,
    name: id,
    version: '0.1.0',
    frontend: { entry: './f.ts' },
    backend: { entry: './b.ts' },
    permissions: ['storage'],
    storage: {
      collections: {
        sessions: { indexes: { owner: 'text', closedAt: 'integer', pinned: 'boolean' } },
      },
    },
    ...extra,
  })
}

const DEMO = 'remote-agent.demo'

describe('extension storage', () => {
  let db: Database
  let host: ExtensionStorageHost
  let clock: number

  beforeEach(() => {
    db = new Database(':memory:', { strict: true })
    clock = 1000
    host = createExtensionStorageHost(db, () => clock)
  })

  afterEach(() => {
    db.close()
  })

  describe('key/value', () => {
    it('round-trips JSON values, deletes, and lists keys by prefix', () => {
      const manifest = manifestFor(DEMO)
      host.prepare(manifest, [])
      const storage = host.storageFor(manifest)

      storage.set('settings:theme', { dark: true, accent: 'blue' })
      storage.set('settings:density', 'compact')
      storage.set('other', 1)

      expect(storage.get<unknown>('settings:theme')).toEqual({ dark: true, accent: 'blue' })
      expect(storage.get<unknown>('missing')).toBeUndefined()
      expect(storage.keys('settings:')).toEqual(['settings:density', 'settings:theme'])
      expect(storage.delete('other')).toBe(true)
      expect(storage.delete('other')).toBe(false)
    })

    it('keeps two extensions apart even with the same key', () => {
      const a = manifestFor(DEMO)
      const b = manifestFor('remote-agent.other')
      host.prepare(a, [])
      host.prepare(b, [])
      host.storageFor(a).set('shared', 'a')
      host.storageFor(b).set('shared', 'b')

      expect(host.storageFor(a).get<unknown>('shared')).toBe('a')
      expect(host.storageFor(b).get<unknown>('shared')).toBe('b')
    })

    it('rejects invalid keys, values JSON cannot hold, and values over 256 KB', () => {
      const manifest = manifestFor(DEMO)
      host.prepare(manifest, [])
      const storage = host.storageFor(manifest)

      expect(() => storage.set('../x', 1)).toThrow('invalid storage key')
      expect(() => storage.set('', 1)).toThrow('invalid storage key')
      expect(() => storage.set('ok', undefined)).toThrow('cannot be stored as JSON')
      expect(() => storage.set('big', 'x'.repeat(300 * 1024))).toThrow('larger than 256 KB')
    })
  })

  describe('collections', () => {
    it('inserts, reads back, and refuses a duplicate insert', () => {
      const manifest = manifestFor(DEMO)
      host.prepare(manifest, [])
      const sessions = host.storageFor(manifest).collection('sessions')

      sessions.insert('s1', { title: 'first' }, { owner: 'me', closedAt: null, pinned: true })

      expect(sessions.get<{ title: string }>('s1')).toEqual({ title: 'first' })
      expect(() => sessions.insert('s1', {}, {})).toThrow('already exists')
    })

    it('upserts and deletes', () => {
      const manifest = manifestFor(DEMO)
      host.prepare(manifest, [])
      const sessions = host.storageFor(manifest).collection('sessions')

      sessions.upsert('s1', { v: 1 }, { owner: 'me' })
      sessions.upsert('s1', { v: 2 }, { owner: 'you' })

      expect(sessions.get<unknown>('s1')).toEqual({ v: 2 })
      expect(sessions.query({ where: { owner: 'you' } }).map(row => row.id)).toEqual(['s1'])
      expect(sessions.delete('s1')).toBe(true)
      expect(sessions.get<unknown>('s1')).toBeUndefined()
    })

    it('filters by equality, boolean, and range on indexed fields, with ordering and limit', () => {
      const manifest = manifestFor(DEMO)
      host.prepare(manifest, [])
      const sessions = host.storageFor(manifest).collection('sessions')
      sessions.insert('a', { n: 'a' }, { owner: 'me', closedAt: 10, pinned: true })
      sessions.insert('b', { n: 'b' }, { owner: 'me', closedAt: 30, pinned: false })
      sessions.insert('c', { n: 'c' }, { owner: 'you', closedAt: 20, pinned: true })

      expect(sessions.query({ where: { owner: 'me' } }).map(row => row.id)).toEqual(['a', 'b'])
      expect(sessions.query({ where: { pinned: true } }).map(row => row.id)).toEqual(['a', 'c'])
      expect(sessions.query({ where: { closedAt: { gte: 15, lt: 30 } } }).map(row => row.id)).toEqual(['c'])
      expect(sessions.query({ orderBy: { field: 'closedAt', dir: 'desc' }, limit: 2 }).map(row => row.id)).toEqual(['b', 'c'])
    })

    it('refuses to filter or order on a field that is not indexed', () => {
      const manifest = manifestFor(DEMO)
      host.prepare(manifest, [])
      const sessions = host.storageFor(manifest).collection('sessions')

      expect(() => sessions.query({ where: { title: 'x' } as any })).toThrow('only indexed fields')
      expect(() => sessions.query({ orderBy: { field: 'title' } })).toThrow('only indexed fields')
      expect(() => sessions.query({ limit: 0 })).toThrow('limit must be')
    })

    it('checks indexed values against their declared type', () => {
      const manifest = manifestFor(DEMO)
      host.prepare(manifest, [])
      const sessions = host.storageFor(manifest).collection('sessions')

      expect(() => sessions.insert('x', {}, { owner: 5 as any })).toThrow('is text')
      expect(() => sessions.insert('x', {}, { closedAt: 1.5 })).toThrow('is integer')
      expect(() => sessions.insert('x', {}, { nope: 'x' })).toThrow('not an indexed field')
    })

    it('throws for a collection the manifest does not declare', () => {
      const manifest = manifestFor(DEMO)
      host.prepare(manifest, [])

      expect(() => host.storageFor(manifest).collection('secrets')).toThrow('not declared')
    })

    it('creates the table with the extension namespace and indexed columns', () => {
      host.prepare(manifestFor(DEMO), [])
      const table = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'ext_*'").all()

      expect(table.map(row => row.name)).toEqual(['ext_remote_agent_demo__sessions'])
    })

    it('adds a column for a field that was added to the manifest later', () => {
      host.prepare(manifestFor(DEMO), [])
      const wider = manifestFor(DEMO, {
        storage: { collections: { sessions: { indexes: { owner: 'text', closedAt: 'integer', pinned: 'boolean', folder: 'text' } } } },
      })
      host.prepare(wider, [])
      const columns = db.query<{ name: string }, []>('PRAGMA table_info(ext_remote_agent_demo__sessions)').all().map(row => row.name)

      expect(columns).toContain('folder')
    })
  })

  describe('migrations', () => {
    it('runs each version once, in order, and records it', () => {
      const manifest = manifestFor(DEMO)
      const ran: number[] = []
      const migrations: ExtensionMigration[] = [
        { version: 1, up: () => void ran.push(1) },
        { version: 2, up: () => void ran.push(2) },
      ]

      host.prepare(manifest, migrations)
      host.prepare(manifest, migrations)

      expect(ran).toEqual([1, 2])
      const applied = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM extension_migrations').get()
      expect(applied?.count).toBe(2)
    })

    it('rolls back everything, including earlier steps, when a migration fails', () => {
      const manifest = manifestFor(DEMO)
      const migrations: ExtensionMigration[] = [
        { version: 1, up: ({ storage }) => storage.set('v1', true) },
        {
          version: 2,
          up: () => {
            throw new Error('bad data')
          },
        },
      ]

      expect(() => host.prepare(manifest, migrations)).toThrow('bad data')
      const left = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM extension_migrations').get()
      expect(left?.count).toBe(0)
      expect(host.storageFor(manifest).get<unknown>('v1')).toBeUndefined()
    })

    it('refuses a database that has a newer migration than the code', () => {
      const manifest = manifestFor(DEMO)
      host.prepare(manifest, [
        { version: 1, up: () => {} },
        { version: 2, up: () => {} },
      ])

      expect(() => host.prepare(manifest, [{ version: 1, up: () => {} }])).toThrow('refusing to start')
    })

    it('rejects migrations that are not numbered 1, 2, 3', () => {
      expect(() => host.prepare(manifestFor(DEMO), [{ version: 2, up: () => {} }])).toThrow('numbered 1, 2, 3')
    })
  })

  describe('footprint and purge', () => {
    it('reports what an extension stores, and purge removes all of it', () => {
      const manifest = manifestFor(DEMO)
      host.prepare(manifest, [])
      const storage = host.storageFor(manifest)
      storage.set('a', 1)
      storage.collection('sessions').insert('s1', {}, { owner: 'me' })

      expect(host.footprint(manifest)).toEqual({ kvKeys: 1, collections: { sessions: 1 } })

      host.purge(manifest)

      expect(host.footprint(manifest)).toEqual({ kvKeys: 0, collections: { sessions: 0 } })
      const table = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE name = 'ext_remote_agent_demo__sessions'").get()
      expect(table).toBeNull()
    })
  })
})

describe('storage permission at the loader', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ra-storage-loader-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function extension(id: string, permissions: string[], body: string): void {
    const extDir = join(dir, id)
    mkdirSync(join(extDir, 'backend'), { recursive: true })
    writeFileSync(
      join(extDir, 'plugin.json'),
      JSON.stringify({ id, name: id, version: '0.1.0', frontend: { entry: './f.ts' }, backend: { entry: './backend/index.ts' }, permissions })
    )
    writeFileSync(join(extDir, 'backend/index.ts'), body)
  }

  const registrar = { onHttpRoute: () => {}, onWebSocketRoute: () => {}, onFrontendPanel: () => {} }
  const quiet = () => {}

  it('hands storage only to an extension that requests it', async () => {
    const db = new Database(':memory:', { strict: true })
    const storage = createExtensionStorageHost(db)
    extension(
      'remote-agent.with-storage',
      ['storage'],
      `export function onActivate(api) { globalThis.__withStorage = typeof api.backend.storage?.set }`
    )
    extension(
      'remote-agent.without-storage',
      [],
      `export function onActivate(api) { globalThis.__withoutStorage = typeof api.backend.storage }`
    )

    await loadExtensions(dir, { registrar, storage, log: quiet })

    expect((globalThis as any).__withStorage).toBe('function')
    expect((globalThis as any).__withoutStorage).toBe('undefined')
  })

  it('skips an extension that ships migrations without asking for storage', async () => {
    const db = new Database(':memory:', { strict: true })
    const storage = createExtensionStorageHost(db)
    extension(
      'remote-agent.sneaky',
      [],
      `export const migrations = [{ version: 1, up() {} }]\nexport function onActivate() { globalThis.__sneaky = true }`
    )

    const instances = await loadExtensions(dir, { registrar, storage, log: quiet })

    expect(instances.length).toBe(0)
    expect((globalThis as any).__sneaky).toBeUndefined()
  })
})
