import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { validatePluginManifest } from '../../../src/extension-sdk/index.ts'
import { createExtensionStorageHost } from '../../../src/channel/web/extension-storage.ts'
import { listStorage, purgeStorage, namespaceOf } from '../../../src/channel/web/extension-admin.ts'

function manifest(id: string) {
  return validatePluginManifest({
    id,
    name: id,
    version: '0.1.0',
    frontend: { entry: './f.ts' },
    backend: { entry: './b.ts' },
    permissions: ['storage'],
    storage: { collections: { sessions: { indexes: { owner: 'text' } } } },
  })
}

function seeded(): Database {
  const db = new Database(':memory:', { strict: true })
  const host = createExtensionStorageHost(db)
  for (const id of ['remote-agent.keep', 'remote-agent.gone']) {
    const m = manifest(id)
    host.prepare(m, [{ version: 1, up: ({ storage }) => storage.set('k', 1) }])
    host.storageFor(m).collection('sessions').insert('s1', {}, { owner: 'me' })
  }
  return db
}

describe('extension admin', () => {
  it('lists each extension with its keys, migrations, and collection rows', () => {
    const db = seeded()
    const rows = listStorage(db, ['remote-agent.keep'])

    expect(rows).toEqual([
      { id: 'remote-agent.gone', installed: false, kvKeys: 1, migrations: 1, collections: { sessions: 1 } },
      { id: 'remote-agent.keep', installed: true, kvKeys: 1, migrations: 1, collections: { sessions: 1 } },
    ])
  })

  it('refuses to purge without the confirmation id', () => {
    expect(() => purgeStorage(seeded(), 'remote-agent.gone', { installed: false, confirm: undefined })).toThrow('--confirm remote-agent.gone')
    expect(() => purgeStorage(seeded(), 'remote-agent.gone', { installed: false, confirm: 'remote-agent.keep' })).toThrow('--confirm')
  })

  it('refuses to purge an extension whose folder is still installed', () => {
    expect(() => purgeStorage(seeded(), 'remote-agent.keep', { installed: true, confirm: 'remote-agent.keep' })).toThrow('still installed')
  })

  it('purges only the named extension', () => {
    const db = seeded()
    const result = purgeStorage(db, 'remote-agent.gone', { installed: false, confirm: 'remote-agent.gone' })

    expect(result).toEqual({ tables: [`${namespaceOf('remote-agent.gone')}sessions`], kvKeys: 1, migrations: 1 })
    const left = listStorage(db, [])
    expect(left.map(row => row.id)).toEqual(['remote-agent.keep'])
    expect(left[0]?.collections).toEqual({ sessions: 1 })
  })
})
