import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionRow } from './store.ts'

/** The first `"cwd"` a transcript records: the folder its Session was launched from. */
const RECORDED_CWD = /"cwd":"((?:[^"\\]|\\.)*)"/
const CWD_SEARCH_BYTES = 64 * 1024

/**
 * The folder a Session was launched from, which is where Claude keeps its transcript. The stored value comes first; a Session
 * from before it was stored is read from its transcript. Falls back to the Session's current folder.
 */
export async function launchFolderOf(home: string, session: Pick<SessionRow, 'id' | 'cwd' | 'launchCwd'>): Promise<string> {
  if (session.launchCwd !== null) {
    return session.launchCwd
  }
  const projects = join(home, '.claude', 'projects')
  let folders: string[] = []
  try {
    folders = await readdir(projects)
  } catch {
    return session.cwd
  }
  for (const folder of folders) {
    const file = Bun.file(join(projects, folder, `${session.id}.jsonl`))
    if (!(await file.exists())) {
      continue
    }
    const head = await file.slice(0, CWD_SEARCH_BYTES).text()
    const match = RECORDED_CWD.exec(head)
    if (match !== null) {
      return JSON.parse(`"${match[1]}"`) as string
    }
  }
  return session.cwd
}
