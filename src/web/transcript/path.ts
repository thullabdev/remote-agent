import { join } from 'node:path'

/**
 * Where Claude Code writes a Session's transcript: ~/.claude/projects/<cwd with every "/" and "." made "-">/<sessionId>.jsonl.
 * The encoding is not reversible (a "-" in the cwd is kept), so the path is derived from the cwd the mod reports, never from the directory name.
 */
export function transcriptPath(home: string, cwd: string, sessionId: string): string {
  const directory = cwd.replace(/[/.]/g, '-')
  return join(home, '.claude', 'projects', directory, `${sessionId}.jsonl`)
}
