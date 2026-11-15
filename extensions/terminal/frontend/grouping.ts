/** The part of a terminal session the sidebar needs. */
export type GroupableSession = { id: string; cwd: string; createdAt?: number }

export type FolderGroup<T extends GroupableSession> = {
  /** The launch folder: the key, since two folders can share a project name. */
  cwd: string
  project: string
  sessions: T[]
}

/**
 * Groups open sessions by launch folder. Groups are ordered by their newest session; sessions inside a group are newest
 * first. Sessions with no creation time sort last.
 */
export function groupByFolder<T extends GroupableSession>(sessions: T[]): Array<FolderGroup<T>> {
  const byFolder = new Map<string, T[]>()
  for (const session of sessions) {
    const list = byFolder.get(session.cwd) ?? []
    list.push(session)
    byFolder.set(session.cwd, list)
  }
  const newest = (list: T[]) => Math.max(...list.map(item => item.createdAt ?? 0))
  return [...byFolder.entries()]
    .map(([cwd, list]) => ({
      cwd,
      project: projectName(cwd),
      sessions: [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    }))
    .sort((a, b) => newest(b.sessions) - newest(a.sessions))
}

/** The last segment of a folder path, or the path itself for the root. */
export function projectName(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, '')
  const last = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return last === '' ? cwd : last
}
