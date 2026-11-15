import type { Database } from 'bun:sqlite'

/** What the database holds for one extension id, whether or not its folder is still installed. */
export type StorageListing = {
  id: string
  installed: boolean
  kvKeys: number
  migrations: number
  /** Collection name → row count, from the namespaced tables that exist. */
  collections: Record<string, number>
}

/** The namespace prefix the host gives an extension's tables: the id with non-alphanumerics as `_`. */
export function namespaceOf(extensionId: string): string {
  return `ext_${extensionId.toLowerCase().replace(/[^a-z0-9]/g, '_')}__`
}

/** Every extension id with data in the database, plus the installed ones, with what each holds. */
export function listStorage(db: Database, installedIds: string[]): StorageListing[] {
  const fromKv = db.query<{ id: string }, []>('SELECT DISTINCT extension_id AS id FROM extension_kv').all().map(row => row.id)
  const fromMigrations = db.query<{ id: string }, []>('SELECT DISTINCT extension_id AS id FROM extension_migrations').all().map(row => row.id)
  const ids = [...new Set([...installedIds, ...fromKv, ...fromMigrations])].sort()
  return ids.map(id => {
    const kvKeys = db.query<{ count: number }, [string]>('SELECT COUNT(*) AS count FROM extension_kv WHERE extension_id = ?').get(id)?.count ?? 0
    const migrations = db.query<{ count: number }, [string]>('SELECT COUNT(*) AS count FROM extension_migrations WHERE extension_id = ?').get(id)?.count ?? 0
    const collections: Record<string, number> = {}
    for (const table of tablesOf(db, id)) {
      const name = table.slice(namespaceOf(id).length)
      collections[name] = db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM "${table}"`).get()?.count ?? 0
    }
    return { id, installed: installedIds.includes(id), kvKeys, migrations, collections }
  })
}

export type PurgeResult = { tables: string[]; kvKeys: number; migrations: number }

/**
 * Deletes everything the database holds for an extension: its collection tables, key/value rows, and migration records.
 * Refuses unless `confirm` repeats the id exactly, and refuses while the extension's folder is still installed.
 */
export function purgeStorage(db: Database, id: string, options: { installed: boolean; confirm: string | undefined }): PurgeResult {
  if (options.confirm !== id) {
    throw new Error(`purge is destructive: run again with --confirm ${id}`)
  }
  if (options.installed) {
    throw new Error(`${id} is still installed; remove its folder under extensions/ first, then purge`)
  }
  const tables = tablesOf(db, id)
  let result: PurgeResult = { tables, kvKeys: 0, migrations: 0 }
  db.transaction(() => {
    for (const table of tables) {
      db.exec(`DROP TABLE IF EXISTS "${table}"`)
    }
    result = {
      tables,
      kvKeys: db.query('DELETE FROM extension_kv WHERE extension_id = ?').run(id).changes,
      migrations: db.query('DELETE FROM extension_migrations WHERE extension_id = ?').run(id).changes,
    }
  })()
  return result
}

function tablesOf(db: Database, id: string): string[] {
  return db
    .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB ? ORDER BY name")
    .all(`${namespaceOf(id)}*`)
    .map(row => row.name)
}
