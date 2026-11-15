// Lists what extensions store in the database, and purges one extension's data.
//   bun run extension list
//   bun run extension purge <id> --confirm <id>
// Purge needs the extension's folder removed from extensions/ first, so a running extension never loses its tables.

import { Database } from 'bun:sqlite'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { listStorage, purgeStorage } from '../src/channel/web/extension-admin.ts'
import { createExtensionStorageHost } from '../src/channel/web/extension-storage.ts'

const extensionsDir = resolve(import.meta.dir, '..', 'extensions')
const dbPath = process.env.REMOTE_AGENT_DB ?? join(homedir(), '.local/state/remote-agent/bridge.db')

function installedIds(): string[] {
  if (!existsSync(extensionsDir)) {
    return []
  }
  return readdirSync(extensionsDir)
    .map(entry => join(extensionsDir, entry, 'plugin.json'))
    .filter(path => existsSync(path))
    .map(path => (JSON.parse(readFileSync(path, 'utf8')) as { id: string }).id)
}

function main(argv: string[]): number {
  const [command, id] = argv
  if (!existsSync(dbPath)) {
    console.error(`no database at ${dbPath}`)
    return 1
  }
  const db = new Database(dbPath, { strict: true })
  // Creates the extension tables if this database has never had an extension, so list and purge work on a fresh file.
  createExtensionStorageHost(db)
  try {
    if (command === 'list') {
      const rows = listStorage(db, installedIds())
      if (rows.length === 0) {
        console.log('no extension data')
        return 0
      }
      for (const row of rows) {
        const collections = Object.entries(row.collections).map(([name, count]) => `${name}=${count}`).join(' ') || '-'
        console.log(`${row.id}${row.installed ? '' : ' (not installed)'}  kv=${row.kvKeys}  migrations=${row.migrations}  collections: ${collections}`)
      }
      return 0
    }
    if (command === 'purge' && id !== undefined) {
      const confirm = argv[argv.indexOf('--confirm') + 1]
      const result = purgeStorage(db, id, { installed: installedIds().includes(id), confirm: argv.includes('--confirm') ? confirm : undefined })
      console.log(`purged ${id}: ${result.tables.length} collection table(s), ${result.kvKeys} key(s), ${result.migrations} migration record(s)`)
      return 0
    }
    console.error('usage: bun run extension list | bun run extension purge <id> --confirm <id>')
    return 2
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  } finally {
    db.close()
  }
}

process.exit(main(process.argv.slice(2)))
