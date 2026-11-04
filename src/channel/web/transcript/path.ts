import { join } from 'node:path'

/**
 * Where Claude Code writes a Session's transcript: ~/.claude/projects/<cwd with every "/" and "." made "-">/<sessionId>.jsonl.
 * The encoding is not reversible (a "-" in the cwd is kept), so the path is derived from the cwd the mod reports, never from the directory name.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Throws for a session id that is not a plain id: it is joined into a path, so "../" or a leading dash must never reach it. */
export function transcriptPath(home: string, cwd: string, sessionId: string): string {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    throw new Error(`session id "${sessionId}" cannot name a transcript file`)
  }
  const directory = cwd.replace(/[/.]/g, '-')
  return join(home, '.claude', 'projects', directory, `${sessionId}.jsonl`)
}
