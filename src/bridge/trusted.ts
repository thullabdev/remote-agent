import { readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'

/** Claude Code's config could not be read, so nothing can be checked. */
export class TrustedFoldersUnavailable extends Error {}

export type Project = { label: string; cwd: string }

type Options = { configPath: string; home: string; projects: string[] }

function expandHome(path: string, home: string): string {
  if (path === '~') {
    return home
  }
  if (path.startsWith('~/')) {
    return `${home}${path.slice(1)}`
  }
  return path
}

/** Absolute, symlink-free, no trailing slash; null for relative or missing paths. */
async function normalise(path: string, home: string): Promise<string | null> {
  const expanded = expandHome(path.trim(), home)
  if (!isAbsolute(expanded)) {
    return null
  }
  try {
    return await realpath(resolve(expanded))
  } catch {
    return null
  }
}

/** The folders where the user accepted Claude Code's trust dialog: the only places a Spawned Session may start. */
export class TrustedFolders {
  constructor(private readonly options: Options) {}

  async isTrusted(path: string): Promise<string | null> {
    return this.match(await this.load(), path)
  }

  async configuredProjects(): Promise<Project[]> {
    const trusted = await this.load()
    const projects: Project[] = []
    for (const entry of this.options.projects) {
      const cwd = await this.match(trusted, entry)
      if (cwd !== null) {
        projects.push({ label: basename(cwd), cwd })
      }
    }
    return projects
  }

  async untrustedProjects(): Promise<string[]> {
    const trusted = await this.load()
    const untrusted: string[] = []
    for (const entry of this.options.projects) {
      if ((await this.match(trusted, entry)) === null) {
        untrusted.push(entry)
      }
    }
    return untrusted
  }

  private async match(trusted: Set<string>, path: string): Promise<string | null> {
    const cwd = await normalise(path, this.options.home)
    if (cwd === null || !trusted.has(cwd)) {
      return null
    }
    return cwd
  }

  /** Read fresh every time: folders trusted since the Bridge started count immediately. */
  private async load(): Promise<Set<string>> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.options.configPath, 'utf8'))
    } catch (error) {
      throw new TrustedFoldersUnavailable(`Cannot read ${this.options.configPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const projects = typeof parsed === 'object' && parsed !== null ? (parsed as { projects?: unknown }).projects : undefined
    const trusted = new Set<string>()
    if (typeof projects !== 'object' || projects === null) {
      return trusted
    }
    for (const [path, entry] of Object.entries(projects)) {
      if (typeof entry !== 'object' || entry === null || (entry as { hasTrustDialogAccepted?: unknown }).hasTrustDialogAccepted !== true) {
        continue
      }
      const cwd = await normalise(path, this.options.home)
      if (cwd !== null) {
        trusted.add(cwd)
      }
    }
    return trusted
  }
}
