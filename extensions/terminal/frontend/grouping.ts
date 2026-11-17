/** The part of a terminal session the tab label needs. */
export type LabelledSession = { cwd: string; command?: string | null }

/**
 * A shell's tab label: its folder and what it is running, `api • vim`. The command is the shell's own name when it is idle,
 * so an idle shell reads `api • zsh`. With no command known, only the folder shows.
 */
export function tabLabel(session: LabelledSession): string {
  const folder = projectName(session.cwd)
  return session.command ? `${folder} • ${session.command}` : folder
}

/** What a shell is called to a person: when it started. The id is internal, so it is only the tooltip. */
export function terminalLabel(session: { createdAt?: number }): string {
  if (session.createdAt === undefined) {
    return 'Shell'
  }
  return `Shell · ${new Date(session.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

/** The last segment of a folder path, or the path itself for the root. */
export function projectName(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, '')
  const last = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return last === '' ? cwd : last
}

/** Whether two launch folders are the same one, ignoring a trailing slash: `/a/b/` and `/a/b` name one project. */
export function sameFolder(a: string, b: string): boolean {
  return trimTrailingSlashes(a) === trimTrailingSlashes(b)
}

/** The session to reuse for a folder: the newest open one started there, or none. Sessions are expected newest first. */
export function openSessionInFolder<T extends { cwd: string }>(sessions: T[], folder: string): T | undefined {
  return sessions.find(session => sameFolder(session.cwd, folder))
}

function trimTrailingSlashes(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}
