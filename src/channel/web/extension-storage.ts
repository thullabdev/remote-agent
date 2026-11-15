import type { Database } from 'bun:sqlite'
import type { ExtensionManifest } from '../../extension-sdk/index.ts'
import {
  assertIndexType,
  assertValidCollectionName,
  assertValidField,
  assertValidKey,
  columnType,
  DEFAULT_QUERY_LIMIT,
  encodeDoc,
  MAX_QUERY_LIMIT,
  storedIndexValue,
  tableName,
  type Collection,
  type CollectionQuery,
  type CollectionSpec,
  type ExtensionStorage,
  type IndexType,
  type IndexValue,
  type RangeBounds,
} from '../../extension-sdk/storage.ts'

/** A schema or data change an extension ships. Versions are 1, 2, 3, ... and run once each, in order. */
export type ExtensionMigration = {
  version: number
  up(context: { storage: ExtensionStorage }): void
}

export type Footprint = { kvKeys: number; collections: Record<string, number> }

/** The host side of extension storage: one instance per database, shared by every extension. */
export type ExtensionStorageHost = {
  /** Creates the extension's declared collections and runs its pending migrations. Throws, rolling back, on any failure. */
  prepare(manifest: ExtensionManifest, migrations: ExtensionMigration[]): void
  /** The storage an extension is handed. Only valid for an extension that has been prepared. */
  storageFor(manifest: ExtensionManifest): ExtensionStorage
  footprint(manifest: ExtensionManifest): Footprint
  /** Deletes the extension's key/value rows, its collection tables, and its migration records. */
  purge(manifest: ExtensionManifest): void
}

export function createExtensionStorageHost(db: Database, now: () => number = Date.now): ExtensionStorageHost {
  db.exec(`
    CREATE TABLE IF NOT EXISTS extension_migrations (
      extension_id TEXT NOT NULL, version INTEGER NOT NULL, applied_at INTEGER NOT NULL,
      PRIMARY KEY (extension_id, version)
    );
    CREATE TABLE IF NOT EXISTS extension_kv (
      extension_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (extension_id, key)
    );
  `)

  function collectionSpecs(manifest: ExtensionManifest): Array<[string, CollectionSpec]> {
    return Object.entries(manifest.storage.collections)
  }

  function ensureCollections(manifest: ExtensionManifest): void {
    for (const [name, spec] of collectionSpecs(manifest)) {
      assertValidCollectionName(name)
      const table = tableName(manifest.id, name)
      const fields = Object.entries(spec.indexes)
      for (const [field, type] of fields) {
        assertValidField(field)
        assertIndexType(type, field)
      }
      const columns = [
        'id TEXT PRIMARY KEY',
        'doc TEXT NOT NULL',
        'created_at INTEGER NOT NULL',
        'updated_at INTEGER NOT NULL',
        ...fields.map(([field, type]) => `"${field}" ${columnType(type)}`),
      ]
      db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${columns.join(', ')})`)
      // A field added to the manifest later gets its column; a field whose type changed is refused.
      const existing = new Map(db.query<{ name: string; type: string }, []>(`PRAGMA table_info("${table}")`).all().map(row => [row.name, row.type]))
      for (const [field, type] of fields) {
        const have = existing.get(field)
        if (have === undefined) {
          db.exec(`ALTER TABLE "${table}" ADD COLUMN "${field}" ${columnType(type)}`)
        } else if (have.toUpperCase() !== columnType(type)) {
          throw new Error(`indexed field "${field}" of ${table} changed type; add a migration instead`)
        }
        db.exec(`CREATE INDEX IF NOT EXISTS "${table}__${field}" ON "${table}" ("${field}")`)
      }
    }
  }

  function latestApplied(extensionId: string): number {
    const row = db.query<{ version: number | null }, [string]>('SELECT MAX(version) AS version FROM extension_migrations WHERE extension_id = ?').get(extensionId)
    return row?.version ?? 0
  }

  function storageFor(manifest: ExtensionManifest): ExtensionStorage {
    const specs = new Map(collectionSpecs(manifest))
    return {
      get<T = unknown>(key: string): T | undefined {
        assertValidKey(key)
        const row = db.query<{ value: string }, [string, string]>('SELECT value FROM extension_kv WHERE extension_id = ? AND key = ?').get(manifest.id, key)
        return row === null ? undefined : (JSON.parse(row.value) as T)
      },
      set(key: string, value: unknown): void {
        assertValidKey(key)
        const json = encodeDoc(value)
        db.query(
          `INSERT INTO extension_kv (extension_id, key, value, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(extension_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        ).run(manifest.id, key, json, now())
      },
      delete(key: string): boolean {
        assertValidKey(key)
        return db.query('DELETE FROM extension_kv WHERE extension_id = ? AND key = ?').run(manifest.id, key).changes > 0
      },
      keys(prefix = ''): string[] {
        return db
          .query<{ key: string }, [string, number, string]>('SELECT key FROM extension_kv WHERE extension_id = ? AND substr(key, 1, ?) = ? ORDER BY key')
          .all(manifest.id, prefix.length, prefix)
          .map(row => row.key)
      },
      collection(name: string): Collection {
        const spec = specs.get(name)
        if (spec === undefined) {
          throw new Error(`collection "${name}" is not declared in the manifest of ${manifest.id}`)
        }
        return makeCollection(tableName(manifest.id, name), spec.indexes, now)
      },
    }
  }

  function makeCollection(table: string, indexes: Record<string, IndexType>, clock: () => number): Collection {
    const fields = Object.keys(indexes)
    const quoted = fields.map(field => `"${field}"`)

    function valuesFor(indexed: Record<string, IndexValue> | undefined): Array<string | number | null> {
      const given = indexed ?? {}
      for (const field of Object.keys(given)) {
        if (!(field in indexes)) {
          throw new Error(`"${field}" is not an indexed field of this collection`)
        }
      }
      return fields.map(field => storedIndexValue(indexes[field] as IndexType, field, given[field]))
    }

    function write(id: string, doc: unknown, indexed: Record<string, IndexValue> | undefined, replace: boolean): void {
      const json = encodeDoc(doc)
      const values = valuesFor(indexed)
      const at = clock()
      const columns = ['id', 'doc', 'created_at', 'updated_at', ...quoted].join(', ')
      const placeholders = Array(4 + fields.length).fill('?').join(', ')
      const conflict = replace
        ? ` ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at${fields.map(field => `, "${field}" = excluded."${field}"`).join('')}`
        : ''
      try {
        db.query(`INSERT INTO "${table}" (${columns}) VALUES (${placeholders})${conflict}`).run(id, json, at, at, ...values)
      } catch (error) {
        if (!replace && error instanceof Error && error.message.includes('UNIQUE')) {
          throw new Error(`document "${id}" already exists`)
        }
        throw error
      }
    }

    return {
      insert: (id, doc, indexed) => write(id, doc, indexed, false),
      upsert: (id, doc, indexed) => write(id, doc, indexed, true),
      get<T = unknown>(id: string): T | undefined {
        const row = db.query<{ doc: string }, [string]>(`SELECT doc FROM "${table}" WHERE id = ?`).get(id)
        return row === null ? undefined : (JSON.parse(row.doc) as T)
      },
      delete(id: string): boolean {
        return db.query(`DELETE FROM "${table}" WHERE id = ?`).run(id).changes > 0
      },
      query<T = unknown>(query: CollectionQuery = {}): Array<{ id: string; doc: T }> {
        const clauses: string[] = []
        const params: Array<string | number | null> = []
        for (const [field, condition] of Object.entries(query.where ?? {})) {
          if (!(field in indexes)) {
            throw new Error(`only indexed fields can be filtered; "${field}" is not indexed`)
          }
          const type = indexes[field] as IndexType
          if (isRange(condition)) {
            for (const key of Object.keys(condition)) {
              if (!RANGE_OPS.has(key)) {
                throw new Error(`unknown range bound "${key}"`)
              }
              clauses.push(`"${field}" ${RANGE_OPS.get(key)} ?`)
              params.push(storedIndexValue(type, field, condition[key as keyof RangeBounds]))
            }
          } else {
            clauses.push(`"${field}" IS ?`)
            params.push(storedIndexValue(type, field, condition))
          }
        }
        let order = 'id ASC'
        if (query.orderBy !== undefined) {
          const { field, dir = 'asc' } = query.orderBy
          if (!(field in indexes)) {
            throw new Error(`only indexed fields can be ordered; "${field}" is not indexed`)
          }
          if (dir !== 'asc' && dir !== 'desc') {
            throw new Error('orderBy.dir must be "asc" or "desc"')
          }
          order = `"${field}" ${dir.toUpperCase()}, id ASC`
        }
        const limit = query.limit ?? DEFAULT_QUERY_LIMIT
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
          throw new Error(`limit must be an integer from 1 to ${MAX_QUERY_LIMIT}`)
        }
        const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
        return db
          .query<{ id: string; doc: string }, Array<string | number | null>>(`SELECT id, doc FROM "${table}" ${where} ORDER BY ${order} LIMIT ${limit}`)
          .all(...params)
          .map(row => ({ id: row.id, doc: JSON.parse(row.doc) as T }))
      },
    }
  }

  return {
    prepare(manifest, migrations) {
      const ordered = [...migrations].sort((a, b) => a.version - b.version)
      ordered.forEach((migration, index) => {
        if (migration.version !== index + 1) {
          throw new Error(`migrations of ${manifest.id} must be numbered 1, 2, 3, ... ; found ${migration.version} at position ${index + 1}`)
        }
      })
      const latestCode = ordered.at(-1)?.version ?? 0
      db.transaction(() => {
        ensureCollections(manifest)
        const applied = latestApplied(manifest.id)
        if (applied > latestCode) {
          throw new Error(`${manifest.id} has migration ${applied} applied but this build only knows up to ${latestCode}; refusing to start`)
        }
        const storage = storageFor(manifest)
        for (const migration of ordered) {
          if (migration.version <= applied) {
            continue
          }
          migration.up({ storage })
          db.query('INSERT INTO extension_migrations (extension_id, version, applied_at) VALUES (?, ?, ?)').run(manifest.id, migration.version, now())
        }
      })()
    },

    storageFor,

    footprint(manifest) {
      const kv = db.query<{ count: number }, [string]>('SELECT COUNT(*) AS count FROM extension_kv WHERE extension_id = ?').get(manifest.id)
      const collections: Record<string, number> = {}
      for (const [name] of collectionSpecs(manifest)) {
        const table = tableName(manifest.id, name)
        const exists = db.query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
        collections[name] = exists === null ? 0 : (db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM "${table}"`).get()?.count ?? 0)
      }
      return { kvKeys: kv?.count ?? 0, collections }
    },

    purge(manifest) {
      db.transaction(() => {
        for (const [name] of collectionSpecs(manifest)) {
          db.exec(`DROP TABLE IF EXISTS "${tableName(manifest.id, name)}"`)
        }
        db.query('DELETE FROM extension_kv WHERE extension_id = ?').run(manifest.id)
        db.query('DELETE FROM extension_migrations WHERE extension_id = ?').run(manifest.id)
      })()
    },
  }
}

const RANGE_OPS = new Map<string, string>([
  ['gt', '>'],
  ['gte', '>='],
  ['lt', '<'],
  ['lte', '<='],
])

function isRange(condition: IndexValue | RangeBounds): condition is RangeBounds {
  return typeof condition === 'object' && condition !== null
}
