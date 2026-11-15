import type { Database } from 'bun:sqlite'

/**
 * One schema change. `version` is 1-based and strictly increasing. Steps must be idempotent, because a database
 * created before versioning exists is run through them once with `user_version` at 0.
 */
export type MigrationStep = {
  version: number
  up(db: Database): void
}

/**
 * Applies the steps newer than the database's `PRAGMA user_version`, in order. Each step and its version bump commit
 * together, so a failed step leaves the database at the last good version. Returns the version now in effect.
 */
export function runUserVersionMigrations(db: Database, steps: MigrationStep[]): number {
  assertSequential(steps)
  const latest = steps.at(-1)?.version ?? 0
  const current = userVersion(db)
  if (current > latest) {
    throw new Error(`database schema is version ${current}, newer than this build (${latest}); refusing to start`)
  }
  for (const step of steps) {
    if (step.version <= current) {
      continue
    }
    db.transaction(() => {
      step.up(db)
      db.exec(`PRAGMA user_version = ${step.version}`)
    })()
  }
  return latest
}

export function userVersion(db: Database): number {
  const row = db.query<{ user_version: number }, []>('PRAGMA user_version').get()
  return row?.user_version ?? 0
}

/** Adds a column to a table only when it is missing, so a step can run on a database that already has it. */
export function addColumnIfMissing(db: Database, table: string, column: string, definition: string): void {
  const columns = new Set(db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map(row => row.name))
  if (!columns.has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
  }
}

function assertSequential(steps: MigrationStep[]): void {
  steps.forEach((step, index) => {
    if (step.version !== index + 1) {
      throw new Error(`migration versions must be 1, 2, 3, ... in order; found ${step.version} at position ${index + 1}`)
    }
  })
}
