import { describe, it, expect, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runUserVersionMigrations, userVersion, addColumnIfMissing } from '../../src/bridge/migrations.ts'
import { Store } from '../../src/bridge/store.ts'

describe('runUserVersionMigrations', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir !== null) {
      rmSync(dir, { recursive: true, force: true })
      dir = null
    }
  })

  function memory(): Database {
    return new Database(':memory:', { strict: true })
  }

  it('runs each step once and records the version', () => {
    const db = memory()
    const ran: number[] = []
    const steps = [1, 2, 3].map(version => ({ version, up: () => void ran.push(version) }))

    expect(runUserVersionMigrations(db, steps)).toBe(3)
    expect(userVersion(db)).toBe(3)
    expect(ran).toEqual([1, 2, 3])

    runUserVersionMigrations(db, steps)
    expect(ran).toEqual([1, 2, 3])
  })

  it('rolls back a failing step and leaves the last good version in place', () => {
    const db = memory()
    const steps = [
      { version: 1, up: (conn: Database) => conn.exec('CREATE TABLE one (x INTEGER)') },
      {
        version: 2,
        up: (conn: Database) => {
          conn.exec('CREATE TABLE two (x INTEGER)')
          throw new Error('boom')
        },
      },
    ]

    expect(() => runUserVersionMigrations(db, steps)).toThrow('boom')
    expect(userVersion(db)).toBe(1)
    const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name)
    expect(tables).toContain('one')
    expect(tables).not.toContain('two')
  })

  it('refuses a database that is newer than this build', () => {
    const db = memory()
    db.exec('PRAGMA user_version = 9')
    expect(() => runUserVersionMigrations(db, [{ version: 1, up: () => {} }])).toThrow('newer than this build')
  })

  it('rejects steps that are not numbered 1, 2, 3', () => {
    expect(() => runUserVersionMigrations(memory(), [{ version: 2, up: () => {} }])).toThrow('in order')
  })

  it('addColumnIfMissing adds a column once', () => {
    const db = memory()
    db.exec('CREATE TABLE t (id TEXT)')
    addColumnIfMissing(db, 't', 'extra', 'extra TEXT')
    addColumnIfMissing(db, 't', 'extra', 'extra TEXT')
    const columns = db.query<{ name: string }, []>('PRAGMA table_info(t)').all().map(row => row.name)
    expect(columns).toEqual(['id', 'extra'])
  })

  it('opens a database created before versioning and keeps its rows', () => {
    dir = mkdtempSync(join(tmpdir(), 'ra-migrations-'))
    const path = join(dir, 'bridge.db')
    const first = new Store(path)
    first.database.exec("INSERT INTO sessions (id, cwd, project, created_at) VALUES ('s1', '/x', 'x', 1)")
    expect(userVersion(first.database)).toBe(2)
    // Simulate a file from before versioning: same tables and columns, user_version never set.
    first.database.exec('PRAGMA user_version = 0')

    const reopened = new Store(path)
    expect(userVersion(reopened.database)).toBe(2)
    const row = reopened.database.query<{ cwd: string }, []>("SELECT cwd FROM sessions WHERE id = 's1'").get()
    expect(row?.cwd).toBe('/x')
  })
})
