import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'

export type Project = { label: string; cwd: string }

/** `projects` are the REMOTE_AGENT_PROJECTS entries; they are checked like Claude Code's project keys. */
type Options = { home: string; configPath: string; projects: string[] }
type ClaudeConfig = { projects?: unknown }

const ENOENT = 'ENOENT'

export class TrustedFoldersUnavailable extends Error {}

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
    const path = await realpath(resolve(expanded))
    return (await stat(path)).isDirectory() ? path : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === ENOENT || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      return null
    }
    throw error
  }
}

/**
 * Folders the Bridge may start a Session in: the REMOTE_AGENT_PROJECTS entries plus every project key in
 * Claude Code's user config. Loose on purpose: a key counts even without a trust acceptance. Each entry must
 * still be an existing directory, and it matches exactly (no subfolders).
 */
export class TrustedFolders {
  constructor(private readonly options: Options) {}

  async isTrusted(path: string): Promise<string | null> {
    const cwd = await normalise(path, this.options.home)
    if (cwd === null) {
      return null
    }
    for (const entry of await this.listed()) {
      if ((await normalise(entry, this.options.home)) === cwd) {
        return cwd
      }
    }
    return null
  }

  async configuredProjects(): Promise<Project[]> {
    const projects: Project[] = []
    const seen = new Set<string>()
    for (const entry of await this.listed()) {
      const path = await normalise(entry, this.options.home)
      if (path !== null && !seen.has(path)) {
        seen.add(path)
        projects.push({ label: basename(path), cwd: path })
      }
    }
    return projects
  }

  /** Env entries first, in configured order, then Claude Code's project keys. */
  private async listed(): Promise<string[]> {
    return [...this.options.projects, ...(await this.claudeProjectKeys())]
  }

  private async claudeProjectKeys(): Promise<string[]> {
    let raw: string
    try {
      raw = await readFile(this.options.configPath, 'utf8')
    } catch (error) {
      throw new TrustedFoldersUnavailable(
        `Cannot read Claude Code config at ${this.options.configPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    let config: unknown
    try {
      config = JSON.parse(raw)
    } catch (error) {
      throw new TrustedFoldersUnavailable(
        `Cannot parse Claude Code config at ${this.options.configPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      throw new TrustedFoldersUnavailable(`Claude Code config at ${this.options.configPath} has an invalid shape`)
    }
    const projects = (config as ClaudeConfig).projects
    if (projects === undefined) {
      return []
    }
    if (projects === null || typeof projects !== 'object' || Array.isArray(projects)) {
      throw new TrustedFoldersUnavailable(`Claude Code config at ${this.options.configPath} has an invalid projects value`)
    }
    return Object.keys(projects)
  }
}
